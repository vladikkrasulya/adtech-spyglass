/**
 * Static VAST structure and timeline extractor.
 *
 * One canonical UMD-lite source runs in Node and a classic browser script.
 * It performs no I/O and never resolves Wrapper references. XML syntax and
 * resource-limit failures are returned as typed data instead of escaping.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    const { isVastShape, detectVastVersion } = require('../format-detect');
    module.exports = factory({ isVastShape, detectVastVersion });
  } else {
    root.OrtbtoolsVastTimeline = factory(root.OrtbtoolsFormatDetect);
  }
})(globalThis, function (formatDetect) {
  'use strict';

  const MAX_DOCUMENT_LENGTH = 1_000_000;
  const MAX_XML_DEPTH = 128;
  const TIMELINE_EVENTS = new Map([
    ['start', { event: 'start', ratio: 0, rank: 0 }],
    ['firstquartile', { event: 'firstQuartile', ratio: 0.25, rank: 1 }],
    ['midpoint', { event: 'midpoint', ratio: 0.5, rank: 2 }],
    ['thirdquartile', { event: 'thirdQuartile', ratio: 0.75, rank: 3 }],
    ['complete', { event: 'complete', ratio: 1, rank: 4 }],
  ]);

  function failure(message, offset) {
    return { ok: false, error: { message: String(message), offset: Math.max(0, offset || 0) } };
  }

  function compareText(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  function decodeEntities(text, baseOffset, fail) {
    let output = '';
    let cursor = 0;
    while (cursor < text.length) {
      const amp = text.indexOf('&', cursor);
      if (amp < 0) {
        output += text.slice(cursor);
        break;
      }
      output += text.slice(cursor, amp);
      const semi = text.indexOf(';', amp + 1);
      if (semi < 0) fail('unterminated XML entity', baseOffset + amp);
      const entity = text.slice(amp + 1, semi);
      let decoded;
      if (entity === 'amp') decoded = '&';
      else if (entity === 'lt') decoded = '<';
      else if (entity === 'gt') decoded = '>';
      else if (entity === 'quot') decoded = '"';
      else if (entity === 'apos') decoded = "'";
      else if (/^#\d+$/.test(entity)) decoded = decodeCodePoint(entity.slice(1), 10);
      else if (/^#x[0-9a-f]+$/i.test(entity)) decoded = decodeCodePoint(entity.slice(2), 16);
      else fail(`unknown XML entity &${entity};`, baseOffset + amp);
      if (decoded === null) fail('invalid numeric XML entity', baseOffset + amp);
      output += decoded;
      cursor = semi + 1;
    }
    return output;
  }

  function decodeCodePoint(raw, radix) {
    const value = Number.parseInt(raw, radix);
    if (
      !Number.isInteger(value) ||
      value <= 0 ||
      value > 0x10ffff ||
      (value >= 0xd800 && value <= 0xdfff)
    ) {
      return null;
    }
    return String.fromCodePoint(value);
  }

  function parseXml(xml) {
    let cursor = 0;
    const stack = [];
    let rootNode = null;

    function fail(message, offset) {
      throw Object.assign(new Error(message), {
        offset: typeof offset === 'number' ? offset : cursor,
      });
    }

    function currentNode() {
      return stack.length ? stack[stack.length - 1] : null;
    }

    function appendText(raw, offset, decode) {
      if (decode && raw.includes(']]>')) fail("']]>' is not allowed in XML text", offset);
      const text = decode ? decodeEntities(raw, offset, fail) : raw;
      const current = currentNode();
      if (current) current.text += text;
      else if (text.trim()) fail('text is not allowed outside the root element', offset);
    }

    function skipWhitespace() {
      while (cursor < xml.length && /\s/.test(xml[cursor])) cursor++;
    }

    function parseName() {
      const start = cursor;
      while (cursor < xml.length && !/[\s=/>]/.test(xml[cursor])) cursor++;
      const name = xml.slice(start, cursor);
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) fail('invalid XML name', start);
      return name;
    }

    function appendElement(node) {
      const parent = currentNode();
      if (parent) parent.children.push(node);
      else if (rootNode) fail('multiple root elements', node.offset);
      else rootNode = node;
    }

    while (cursor < xml.length) {
      if (xml[cursor] !== '<') {
        const next = xml.indexOf('<', cursor);
        const end = next < 0 ? xml.length : next;
        appendText(xml.slice(cursor, end), cursor, true);
        cursor = end;
        continue;
      }

      if (xml.startsWith('<!--', cursor)) {
        const end = xml.indexOf('-->', cursor + 4);
        if (end < 0) fail('unterminated XML comment', cursor);
        if (xml.slice(cursor + 4, end).includes('--')) {
          fail("'--' is not allowed inside an XML comment", cursor);
        }
        cursor = end + 3;
        continue;
      }
      if (xml.startsWith('<![CDATA[', cursor)) {
        const start = cursor + 9;
        const end = xml.indexOf(']]>', start);
        if (end < 0) fail('unterminated CDATA section', cursor);
        appendText(xml.slice(start, end), start, false);
        cursor = end + 3;
        continue;
      }
      if (xml.startsWith('<?', cursor)) {
        const end = xml.indexOf('?>', cursor + 2);
        if (end < 0) fail('unterminated processing instruction', cursor);
        cursor = end + 2;
        continue;
      }
      if (/^<!DOCTYPE\b/i.test(xml.slice(cursor))) {
        fail('XML declarations with external entities are not supported', cursor);
      }
      if (xml.startsWith('<!', cursor)) fail('unsupported XML declaration', cursor);

      if (xml.startsWith('</', cursor)) {
        const closingOffset = cursor;
        cursor += 2;
        const name = parseName();
        skipWhitespace();
        if (xml[cursor] !== '>') fail("expected '>' after closing tag", cursor);
        cursor++;
        const open = stack.pop();
        if (!open) fail(`unexpected closing tag </${name}>`, closingOffset);
        if (open.name !== name) {
          fail(`closing tag </${name}> does not match <${open.name}>`, closingOffset);
        }
        continue;
      }

      const elementOffset = cursor;
      cursor++;
      const name = parseName();
      const attributes = Object.create(null);
      let selfClosing = false;

      for (;;) {
        skipWhitespace();
        if (xml.startsWith('/>', cursor)) {
          selfClosing = true;
          cursor += 2;
          break;
        }
        if (xml[cursor] === '>') {
          cursor++;
          break;
        }
        if (cursor >= xml.length) fail('unterminated start tag', elementOffset);

        const attributeOffset = cursor;
        const attributeName = parseName();
        if (Object.hasOwn(attributes, attributeName)) {
          fail(`duplicate XML attribute ${attributeName}`, attributeOffset);
        }
        skipWhitespace();
        if (xml[cursor] !== '=') fail("expected '=' after XML attribute", cursor);
        cursor++;
        skipWhitespace();
        const quote = xml[cursor];
        if (quote !== '"' && quote !== "'") fail('XML attribute value must be quoted', cursor);
        cursor++;
        const valueOffset = cursor;
        const end = xml.indexOf(quote, cursor);
        if (end < 0) fail('unterminated XML attribute value', valueOffset);
        const rawValue = xml.slice(cursor, end);
        if (rawValue.includes('<')) fail("'<' is not allowed in an XML attribute", valueOffset);
        attributes[attributeName] = decodeEntities(rawValue, valueOffset, fail);
        cursor = end + 1;
      }

      const node = { name, attributes, children: [], text: '', offset: elementOffset };
      appendElement(node);
      if (!selfClosing) {
        if (stack.length + 1 > MAX_XML_DEPTH) {
          fail(`XML depth limit of ${MAX_XML_DEPTH} exceeded`, elementOffset);
        }
        stack.push(node);
      }
    }

    if (stack.length) {
      const open = stack[stack.length - 1];
      fail(`unclosed XML element <${open.name}>`, xml.length);
    }
    if (!rootNode) fail('XML root element is missing', 0);
    return rootNode;
  }

  function localName(node) {
    const parts = node.name.split(':');
    return parts[parts.length - 1].toLowerCase();
  }

  function attribute(node, wanted) {
    const lowerWanted = wanted.toLowerCase();
    for (const key of Object.keys(node.attributes)) {
      const parts = key.split(':');
      if (parts[parts.length - 1].toLowerCase() === lowerWanted) return node.attributes[key];
    }
    return null;
  }

  function directChildren(node, wanted) {
    const lowerWanted = wanted.toLowerCase();
    return node.children.filter((child) => localName(child) === lowerWanted);
  }

  function descendants(node, wanted) {
    const lowerWanted = wanted.toLowerCase();
    const matches = [];
    const pending = [...node.children].reverse();
    while (pending.length) {
      const current = pending.pop();
      if (localName(current) === lowerWanted) matches.push(current);
      for (let index = current.children.length - 1; index >= 0; index--) {
        pending.push(current.children[index]);
      }
    }
    return matches;
  }

  function nodeText(node) {
    return node.text.trim();
  }

  function sortedAttributes(node) {
    const output = {};
    for (const key of Object.keys(node.attributes).sort(compareText)) {
      Object.defineProperty(output, key, {
        value: node.attributes[key],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  }

  function parseClock(value) {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(/^(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)$/);
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }

  function normalizeTrackingEvent(raw) {
    const trimmed = String(raw || '').trim();
    const standard = TIMELINE_EVENTS.get(trimmed.toLowerCase());
    if (standard) return standard.event;
    if (trimmed.toLowerCase() === 'progress') return 'progress';
    return trimmed;
  }

  function trackingSortKey(group) {
    const standard = TIMELINE_EVENTS.get(group.event.toLowerCase());
    if (standard) return [0, standard.rank, ''];
    if (group.event === 'progress') return [1, 0, group.offset || ''];
    return [2, 0, `${group.event}\0${group.offset || ''}`];
  }

  function compareTrackingGroups(left, right) {
    const leftKey = trackingSortKey(left);
    const rightKey = trackingSortKey(right);
    return (
      leftKey[0] - rightKey[0] || leftKey[1] - rightKey[1] || compareText(leftKey[2], rightKey[2])
    );
  }

  function collectTrackingEvents(container) {
    const groups = new Map();
    for (const parent of descendants(container, 'TrackingEvents')) {
      for (const tracking of directChildren(parent, 'Tracking')) {
        const event = normalizeTrackingEvent(attribute(tracking, 'event'));
        const offset = attribute(tracking, 'offset');
        const key = JSON.stringify([event, offset]);
        let group = groups.get(key);
        if (!group) {
          group = { event, offset, urls: [] };
          groups.set(key, group);
        }
        group.urls.push(nodeText(tracking));
      }
    }
    return [...groups.values()].sort(compareTrackingGroups);
  }

  function collectClicks(container) {
    const result = { clickThrough: [], clickTracking: [], customClick: [] };
    const mappings = [
      ['ClickThrough', 'clickThrough'],
      ['ClickTracking', 'clickTracking'],
      ['CustomClick', 'customClick'],
    ];
    for (const clicks of descendants(container, 'VideoClicks')) {
      for (const [elementName, outputKey] of mappings) {
        for (const click of directChildren(clicks, elementName)) {
          result[outputKey].push({ id: attribute(click, 'id'), url: nodeText(click) });
        }
      }
    }
    return result;
  }

  function collectMediaFiles(container) {
    return descendants(container, 'MediaFile').map((mediaFile) => ({
      url: nodeText(mediaFile),
      attributes: sortedAttributes(mediaFile),
    }));
  }

  function firstLinearDuration(container) {
    for (const linear of descendants(container, 'Linear')) {
      const duration = directChildren(linear, 'Duration')[0];
      if (duration) return nodeText(duration);
    }
    return null;
  }

  function timelinePosition(group, durationSeconds, sourceIndex) {
    const standard = TIMELINE_EVENTS.get(group.event.toLowerCase());
    if (standard) {
      return {
        domain: 0,
        value: durationSeconds === null ? standard.ratio * 100 : standard.ratio * durationSeconds,
        tie: 0,
        rank: standard.rank,
        sourceIndex,
        timeSeconds: durationSeconds === null ? null : standard.ratio * durationSeconds,
      };
    }

    const offset = group.offset || '';
    const percent = offset.match(/^(\d+(?:\.\d+)?)%$/);
    if (percent) {
      const ratio = Number(percent[1]) / 100;
      return {
        domain: 0,
        value: durationSeconds === null ? ratio * 100 : ratio * durationSeconds,
        tie: 1,
        rank: 0,
        sourceIndex,
        timeSeconds: durationSeconds === null ? null : ratio * durationSeconds,
      };
    }
    const seconds = parseClock(offset);
    if (seconds !== null) {
      return {
        domain: durationSeconds === null ? 1 : 0,
        value: seconds,
        tie: 1,
        rank: 0,
        sourceIndex,
        timeSeconds: seconds,
      };
    }
    return {
      domain: 2,
      value: 0,
      tie: 1,
      rank: 0,
      sourceIndex,
      timeSeconds: null,
    };
  }

  function buildTimeline(ad, adIndex) {
    const entries = [];
    for (let sourceIndex = 0; sourceIndex < ad.trackingEvents.length; sourceIndex++) {
      const group = ad.trackingEvents[sourceIndex];
      if (!TIMELINE_EVENTS.has(group.event.toLowerCase()) && group.event !== 'progress') continue;
      const position = timelinePosition(group, ad.durationSeconds, sourceIndex);
      entries.push({
        adIndex,
        adId: ad.id,
        event: group.event,
        offset: group.offset,
        timeSeconds: position.timeSeconds,
        urls: [...group.urls],
        position,
      });
    }
    entries.sort((left, right) => {
      const a = left.position;
      const b = right.position;
      return (
        a.domain - b.domain ||
        a.value - b.value ||
        a.tie - b.tie ||
        a.rank - b.rank ||
        a.sourceIndex - b.sourceIndex
      );
    });
    return entries.map(({ position: _position, ...entry }) => entry);
  }

  function extractAd(adNode, adIndex) {
    const inline = directChildren(adNode, 'InLine')[0] || null;
    const wrapper = directChildren(adNode, 'Wrapper')[0] || null;
    const container = inline || wrapper || adNode;
    const type = inline ? 'inline' : wrapper ? 'wrapper' : 'unknown';
    const duration = firstLinearDuration(container);
    const parsedDuration = parseClock(duration);
    const uriNode = wrapper ? directChildren(wrapper, 'VASTAdTagURI')[0] || null : null;
    const ad = {
      id: attribute(adNode, 'id'),
      sequence: attribute(adNode, 'sequence'),
      type,
      impressions: directChildren(container, 'Impression').map((impression) => ({
        id: attribute(impression, 'id'),
        url: nodeText(impression),
      })),
      trackingEvents: collectTrackingEvents(container),
      videoClicks: collectClicks(container),
      mediaFiles: collectMediaFiles(container),
      vastAdTagUri: uriNode ? { url: nodeText(uriNode), unresolved: true } : null,
      duration,
      durationSeconds: parsedDuration,
    };
    return { ad, timeline: buildTimeline(ad, adIndex) };
  }

  /**
   * @param {unknown} xml
   * @returns {any}
   */
  function parseVastTimeline(xml) {
    if (typeof xml !== 'string') return failure('VAST XML input must be a string', 0);
    if (xml.length > MAX_DOCUMENT_LENGTH) {
      return failure(`VAST XML size limit of ${MAX_DOCUMENT_LENGTH} exceeded`, MAX_DOCUMENT_LENGTH);
    }
    if (
      !formatDetect ||
      typeof formatDetect.isVastShape !== 'function' ||
      typeof formatDetect.detectVastVersion !== 'function'
    ) {
      return failure('VAST format detection helpers are unavailable', 0);
    }
    if (!formatDetect.isVastShape(xml)) {
      const first = xml.search(/\S/);
      return failure('input does not have a VAST XML root shape', first < 0 ? 0 : first);
    }

    try {
      const rootNode = parseXml(xml);
      if (localName(rootNode) !== 'vast')
        return failure('XML root element is not VAST', rootNode.offset);
      const ads = [];
      const timeline = [];
      for (const adNode of directChildren(rootNode, 'Ad')) {
        const extracted = extractAd(adNode, ads.length);
        ads.push(extracted.ad);
        timeline.push(...extracted.timeline);
      }
      return {
        ok: true,
        version: formatDetect.detectVastVersion(xml),
        ads,
        timeline,
      };
    } catch (error) {
      return failure(
        error && error.message ? error.message : 'VAST XML parse error',
        error && typeof error.offset === 'number' ? error.offset : 0,
      );
    }
  }

  return { parseVastTimeline, MAX_DOCUMENT_LENGTH, MAX_XML_DEPTH };
});
