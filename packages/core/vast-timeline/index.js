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
  const MAX_ENTITY_REFERENCE_LENGTH = 32;
  const MAX_EXCERPT_LENGTH = 160;
  const XML_SYNTAX = 'https://www.w3.org/TR/xml/#syntax';
  const XML_REFERENCES = 'https://www.w3.org/TR/xml/#sec-references';
  const XML_CHAR_REFERENCE = 'https://www.w3.org/TR/xml/#NT-CharRef';
  const XML_CDATA = 'https://www.w3.org/TR/xml/#sec-cdata-sect';
  const XML_COMMENTS = 'https://www.w3.org/TR/xml/#sec-comments';
  const XML_TAGS = 'https://www.w3.org/TR/xml/#sec-starttags';
  const XML_UNIQUE_ATTRIBUTES = 'https://www.w3.org/TR/xml/#uniqattspec';
  const XML_NAMES = 'https://www.w3.org/TR/xml/#NT-Name';
  const XML_DTD = 'https://www.w3.org/TR/xml/#sec-prolog-dtd';
  const VAST_SPEC = 'https://iabtechlab.com/standards/vast/';
  const TIMELINE_EVENTS = new Map([
    ['start', { event: 'start', ratio: 0, rank: 0 }],
    ['firstquartile', { event: 'firstQuartile', ratio: 0.25, rank: 1 }],
    ['midpoint', { event: 'midpoint', ratio: 0.5, rank: 2 }],
    ['thirdquartile', { event: 'thirdQuartile', ratio: 0.75, rank: 3 }],
    ['complete', { event: 'complete', ratio: 1, rank: 4 }],
  ]);

  const DIAGNOSTIC_DEFINITIONS = [
    {
      code: 'vast.input.not_string',
      message:
        'Found a VAST input that is not a string. The extractor reads XML text and cannot inspect values of another type. Pass the complete VAST XML as a JavaScript string.',
      expected: 'Pass the complete VAST XML as a string.',
      spec: VAST_SPEC,
    },
    {
      code: 'vast.input.size_limit',
      message:
        'Found VAST XML beyond the extractor size limit of 1,000,000 UTF-16 code units. Bounded input prevents an oversized payload from exhausting parser resources. Reduce the XML below the limit before parsing it.',
      expected: 'Reduce the XML to at most 1,000,000 UTF-16 code units.',
      spec: VAST_SPEC,
    },
    {
      code: 'vast.runtime.detector_unavailable',
      message:
        'Found that the VAST format-detection helpers are unavailable. The UMD build cannot classify the XML without those existing helpers. Load OrtbtoolsFormatDetect before OrtbtoolsVastTimeline, or use the Node module.',
      expected: 'Load the existing VAST format-detection helpers before calling the extractor.',
      spec: VAST_SPEC,
    },
    {
      code: 'vast.input.not_vast_shape',
      message:
        'Found input whose first XML element does not have the VAST root shape. A VAST payload must be rooted at a VAST element before its ads can be extracted. Supply XML beginning with <VAST>, optionally after an XML declaration.',
      expected: 'Supply XML whose root element is <VAST>.',
      spec: VAST_SPEC,
    },
    {
      code: 'vast.xml.bare_ampersand',
      message:
        'Found a bare & inside XML text or an attribute value. XML treats & as the start of an entity reference, so it must be escaped even inside a URL. Write &amp; — for example ?a=1&amp;b=2 — or wrap element text in <![CDATA[…]]>.',
      expected: 'Write &amp; for a literal ampersand, or wrap element text in CDATA.',
      spec: XML_REFERENCES,
    },
    {
      code: 'vast.xml.entity_unterminated',
      message:
        'Found an entity reference that starts with & but has no terminating semicolon. XML references are incomplete until the ; delimiter is present. Close the reference, for example write &amp; instead of &amp.',
      expected: 'Close the XML entity reference with a semicolon.',
      spec: XML_REFERENCES,
    },
    {
      code: 'vast.xml.entity_unknown',
      message:
        'Found an entity name that this safe XML parser does not recognize. VAST URL text normally needs a predefined XML entity rather than a custom entity declaration. Replace it with &amp;, &lt;, &gt;, &quot;, &apos;, or a numeric character reference.',
      expected: 'Use a predefined XML entity or a valid numeric character reference.',
      spec: XML_REFERENCES,
    },
    {
      code: 'vast.xml.char_reference_invalid',
      message:
        'Found a numeric character reference that does not identify an allowed XML character. Invalid code points cannot be represented in well-formed XML. Replace it with a decimal or hexadecimal reference to a legal XML character.',
      expected: 'Use a valid decimal or hexadecimal XML character reference.',
      spec: XML_CHAR_REFERENCE,
    },
    {
      code: 'vast.xml.cdata_end_in_text',
      message:
        'Found the reserved ]]> delimiter in ordinary element text. XML permits that sequence only to close a CDATA section. Replace the sequence with escaped text or place the surrounding content inside a correctly opened CDATA section.',
      expected: 'Remove ]]> from ordinary text or use a correctly delimited CDATA section.',
      spec: XML_CDATA,
    },
    {
      code: 'vast.xml.text_outside_root',
      message:
        'Found non-whitespace text outside the root element. XML allows one root element with only permitted prolog or trailing markup around it. Move the text inside <VAST> or remove it.',
      expected: 'Keep non-whitespace character data inside the single root element.',
      spec: XML_SYNTAX,
    },
    {
      code: 'vast.xml.name_invalid',
      message:
        'Found an element or attribute name that does not match XML name syntax. XML names must begin with a permitted name-start character and contain only permitted name characters. Replace it with a valid XML name such as Tracking or event.',
      expected: 'Use an XML Name with a valid starting character and valid name characters.',
      spec: XML_NAMES,
    },
    {
      code: 'vast.xml.multiple_roots',
      message:
        'Found more than one top-level element. Well-formed XML has exactly one root element, so sibling roots cannot form one VAST payload. Keep a single <VAST> root and move all Ads inside it.',
      expected: 'Keep exactly one root element, with all VAST content nested inside it.',
      spec: XML_SYNTAX,
    },
    {
      code: 'vast.xml.comment_unterminated',
      message:
        'Found an XML comment without a closing --> delimiter. The parser cannot know where the comment ends and markup resumes. Close the comment with --> or remove the opening <!-- marker.',
      expected: 'Close every XML comment with -->.',
      spec: XML_COMMENTS,
    },
    {
      code: 'vast.xml.comment_double_hyphen',
      message:
        'Found -- inside an XML comment. XML reserves the double-hyphen sequence for comment boundaries and forbids it in comment content. Replace the internal -- with text that does not contain two consecutive hyphens.',
      expected: 'Remove consecutive hyphens from inside the XML comment.',
      spec: XML_COMMENTS,
    },
    {
      code: 'vast.xml.cdata_unterminated',
      message:
        'Found a CDATA section without its closing ]]> delimiter. XML treats everything after <![CDATA[ as character data until that exact terminator appears. Close the section with ]]> before the enclosing element ends.',
      expected: 'Close every <![CDATA[ section with ]]>.',
      spec: XML_CDATA,
    },
    {
      code: 'vast.xml.processing_instruction_unterminated',
      message:
        'Found a processing instruction without a closing ?> delimiter. XML cannot determine where the instruction ends and element markup resumes. Close the instruction with ?>, as in <?xml version="1.0"?>.',
      expected: 'Close every XML processing instruction with ?>.',
      spec: XML_SYNTAX,
    },
    {
      code: 'vast.xml.doctype_unsupported',
      message:
        'Found a DOCTYPE declaration. This static extractor deliberately rejects DTD and entity declarations so external entities and expansion bombs cannot run. Remove the DOCTYPE and use only predefined or numeric XML references.',
      expected: 'Remove the DOCTYPE and inline safe VAST XML using predefined entities only.',
      spec: XML_DTD,
    },
    {
      code: 'vast.xml.declaration_unsupported',
      message:
        'Found an unsupported <!…> XML declaration. The static extractor accepts comments and CDATA but does not process other declarations. Remove the declaration or replace literal text with supported XML escaping.',
      expected:
        'Use only supported XML markup: elements, comments, CDATA, and processing instructions.',
      spec: XML_SYNTAX,
    },
    {
      code: 'vast.xml.closing_tag_expected_gt',
      message:
        'Found extra or missing syntax after a closing element name. An XML end-tag must finish with > after optional whitespace. Write the closing tag in the form </Element>.',
      expected: 'Write the end-tag as </Element> with a final > delimiter.',
      spec: XML_TAGS,
    },
    {
      code: 'vast.xml.closing_tag_unexpected',
      message:
        'Found a closing tag with no corresponding open element. XML elements must be properly nested, so an end-tag cannot appear on an empty element stack. Remove the stray end-tag or add its matching start-tag in the correct position.',
      expected: 'Match every closing tag with an earlier open tag at the same nesting level.',
      spec: XML_TAGS,
    },
    {
      code: 'vast.xml.closing_tag_mismatch',
      message:
        'Found a closing tag whose name does not match the currently open element. XML element names are case-sensitive and must close in reverse nesting order. Replace it with the exact matching end-tag for the open element.',
      expected:
        'Close the current element with an end-tag using the identical case-sensitive name.',
      spec: XML_TAGS,
    },
    {
      code: 'vast.xml.start_tag_unterminated',
      message:
        'Found a start-tag that reaches the end of the XML without > or />. The parser cannot determine where the element header ends. Close the tag with >, or use /> for an empty element.',
      expected: 'Close the start-tag with > or />.',
      spec: XML_TAGS,
    },
    {
      code: 'vast.xml.attribute_duplicate',
      message:
        'Found the same attribute name more than once on one element. XML requires attribute names to be unique within a start-tag. Keep one attribute value and remove the duplicate occurrence.',
      expected: 'Keep each attribute name at most once per element.',
      spec: XML_UNIQUE_ATTRIBUTES,
    },
    {
      code: 'vast.xml.attribute_expected_equals',
      message:
        'Found an attribute name without the required = delimiter before its value. XML attributes pair a name with a quoted value using equals syntax. Write name="value" instead.',
      expected: 'Write the attribute as name="value" or name=\'value\'.',
      spec: XML_TAGS,
    },
    {
      code: 'vast.xml.attribute_unquoted',
      message:
        'Found an XML attribute value without matching quote delimiters. XML does not permit unquoted attribute values even when they contain no spaces. Write the value between matching single or double quotes.',
      expected: 'Quote every XML attribute value with matching single or double quotes.',
      spec: XML_TAGS,
    },
    {
      code: 'vast.xml.attribute_unterminated',
      message:
        'Found an attribute value whose opening quote has no matching closing quote. XML cannot determine where the value ends and the rest of the tag begins. Close the value with the same quote character that opened it.',
      expected: 'Close the attribute value with its matching quote delimiter.',
      spec: XML_TAGS,
    },
    {
      code: 'vast.xml.attribute_lt',
      message:
        'Found a literal < inside an XML attribute value. XML reserves < for markup and forbids it unescaped in attributes. Write &lt; when the less-than character is part of the value.',
      expected: 'Replace a literal < in an attribute value with &lt;.',
      spec: XML_SYNTAX,
    },
    {
      code: 'vast.input.depth_limit',
      message:
        'Found XML beyond the extractor depth limit of 128 open elements. Bounded nesting prevents deeply recursive payloads from exhausting parser resources. Reduce the nesting to at most 128 simultaneously open elements.',
      expected: 'Reduce XML nesting to at most 128 open elements.',
      spec: XML_SYNTAX,
    },
    {
      code: 'vast.xml.element_unclosed',
      message:
        'Found an element that remains open at the end of the XML. Well-formed XML requires every non-empty start-tag to have a matching end-tag. Close the final open element with its exact case-sensitive name.',
      expected: 'Close every non-empty start-tag with its matching end-tag.',
      spec: XML_TAGS,
    },
    {
      code: 'vast.xml.root_missing',
      message:
        'Found XML with no root element. A well-formed XML payload needs exactly one element containing all other content. Add a single <VAST> root around the ad data.',
      expected: 'Add exactly one <VAST> root element.',
      spec: XML_SYNTAX,
    },
    {
      code: 'vast.input.root_not_vast',
      message:
        'Found well-formed XML whose root element is not VAST. The extractor only builds ad structure and timelines beneath a VAST root. Replace the root with <VAST> or pass the intended VAST payload.',
      expected: 'Use <VAST> as the XML root element.',
      spec: VAST_SPEC,
    },
    {
      code: 'vast.runtime.parse_failed',
      message:
        'Found an unexpected parser failure without a more specific XML diagnosis. The extractor cannot return trustworthy partial structure after an internal failure. Provide the smallest reproducing VAST XML so this parser path can be diagnosed.',
      expected: 'Provide well-formed VAST XML or report the smallest reproducing input.',
      spec: VAST_SPEC,
    },
    {
      code: 'vast.note.version_missing',
      message:
        'The result has version: null because no numeric version attribute was detected on <VAST>. Consumers cannot identify the declared VAST generation from this field. Add the intended version, for example <VAST version="4.2">.',
      expected: 'Add the intended numeric version attribute to <VAST>.',
      spec: VAST_SPEC,
    },
    {
      code: 'vast.note.timeline_empty',
      message:
        'The timeline is empty because no start, firstQuartile, midpoint, thirdQuartile, complete, or progress Tracking events were found. There are no playback milestones for this extractor to place. Add those Tracking elements when the source is expected to expose a timeline.',
      expected: 'Add supported playback Tracking events when timeline output is expected.',
      spec: VAST_SPEC,
    },
    {
      code: 'vast.note.duration_invalid',
      message:
        'The result contains durationSeconds: null because a present Duration string is not parseable as HH:MM:SS with optional fractional seconds. Absolute positions cannot be calculated from that text. Write a clock value such as 00:00:30 or treat offsets as relative.',
      expected: 'Use an HH:MM:SS duration, optionally with fractional seconds.',
      spec: VAST_SPEC,
    },
    {
      code: 'vast.note.ad_type_unknown',
      message:
        'The result contains an Ad with type: unknown because it has neither an InLine nor a Wrapper child. The extractor has no branch-specific container to read. Add the intended InLine or Wrapper structure before relying on its extracted fields.',
      expected: 'Add either an InLine or Wrapper child beneath the Ad.',
      spec: VAST_SPEC,
    },
    {
      code: 'vast.note.timeline_relative',
      message:
        'The timeline contains entries without absolute timeSeconds because their Ad has no valid Duration. Named milestones can only remain relative without a playback length. Provide a parseable HH:MM:SS Duration or use event and offset as relative positions.',
      expected: 'Provide a valid Duration to calculate absolute timeline seconds.',
      spec: VAST_SPEC,
    },
  ];

  /** @type {ReadonlyArray<Readonly<{code:string,message:string,expected:string,spec:string}>>} */
  const VAST_DIAGNOSTICS = Object.freeze(
    DIAGNOSTIC_DEFINITIONS.map((diagnostic) => Object.freeze(diagnostic)),
  );
  const VAST_DIAGNOSTIC_BY_CODE = new Map(
    VAST_DIAGNOSTICS.map((diagnostic) => [diagnostic.code, diagnostic]),
  );

  function sourceLocation(xml, rawOffset) {
    const offset = Math.max(0, Math.min(xml.length, Number.isFinite(rawOffset) ? rawOffset : 0));
    let line = 1;
    let column = 1;
    for (let index = 0; index < offset; index++) {
      if (xml[index] === '\r') {
        if (xml[index + 1] === '\n' && index + 1 < offset) index++;
        line++;
        column = 1;
      } else if (xml[index] === '\n') {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    return { offset, line, column };
  }

  function sourceExcerpt(xml, offset) {
    if (!xml) return '^';
    let lineStart = offset;
    while (lineStart > 0 && xml[lineStart - 1] !== '\n' && xml[lineStart - 1] !== '\r') lineStart--;
    let lineEnd = offset;
    while (lineEnd < xml.length && xml[lineEnd] !== '\n' && xml[lineEnd] !== '\r') lineEnd++;

    const availableBefore = offset - lineStart;
    const sliceStart = Math.max(lineStart, offset - 40);
    const sliceEnd = Math.min(lineEnd, sliceStart + 96);
    const prefix = sliceStart > lineStart ? '…' : '';
    const suffix = sliceEnd < lineEnd ? '…' : '';
    const source = `${prefix}${xml.slice(sliceStart, sliceEnd)}${suffix}`;
    const caretColumn = prefix.length + Math.min(availableBefore, offset - sliceStart);
    const excerpt = `${source}\n${' '.repeat(caretColumn)}^`;
    return excerpt.slice(0, MAX_EXCERPT_LENGTH);
  }

  function failure(code, xml, rawOffset) {
    const diagnostic =
      VAST_DIAGNOSTIC_BY_CODE.get(code) || VAST_DIAGNOSTIC_BY_CODE.get('vast.runtime.parse_failed');
    const source = typeof xml === 'string' ? xml : '';
    const location = sourceLocation(source, rawOffset);
    return {
      ok: false,
      error: {
        code: diagnostic.code,
        message: diagnostic.message,
        expected: diagnostic.expected,
        spec: diagnostic.spec,
        offset: location.offset,
        line: location.line,
        column: location.column,
        excerpt: sourceExcerpt(source, location.offset),
      },
    };
  }

  function makeNote(code) {
    const diagnostic = VAST_DIAGNOSTIC_BY_CODE.get(code);
    return { code: diagnostic.code, message: diagnostic.message, spec: diagnostic.spec };
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
      const next = text[amp + 1] || '';
      if (!/[A-Za-z_#]/.test(next)) fail('vast.xml.bare_ampersand', baseOffset + amp);
      const semi = text.indexOf(';', amp + 1);
      const tokenEnd = text.slice(amp + 1).search(/[\s&<=>]/);
      const end = tokenEnd < 0 ? text.length : amp + 1 + tokenEnd;
      const openToken = text.slice(amp + 1, end);
      const knownUnterminated =
        ['amp', 'lt', 'gt', 'quot', 'apos'].includes(openToken) ||
        /^#(?:\d+|x[0-9a-f]+)$/i.test(openToken);
      if (semi < 0 || semi - amp > MAX_ENTITY_REFERENCE_LENGTH || semi > end) {
        if (knownUnterminated) fail('vast.xml.entity_unterminated', baseOffset + amp);
        fail('vast.xml.bare_ampersand', baseOffset + amp);
      }
      const entity = text.slice(amp + 1, semi);
      let decoded;
      if (entity === 'amp') decoded = '&';
      else if (entity === 'lt') decoded = '<';
      else if (entity === 'gt') decoded = '>';
      else if (entity === 'quot') decoded = '"';
      else if (entity === 'apos') decoded = "'";
      else if (/^#\d+$/.test(entity)) decoded = decodeCodePoint(entity.slice(1), 10);
      else if (/^#x[0-9a-f]+$/i.test(entity)) decoded = decodeCodePoint(entity.slice(2), 16);
      else if (entity.startsWith('#')) fail('vast.xml.char_reference_invalid', baseOffset + amp);
      else if (/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(entity)) {
        fail('vast.xml.entity_unknown', baseOffset + amp);
      } else {
        fail('vast.xml.bare_ampersand', baseOffset + amp);
      }
      if (decoded === null) fail('vast.xml.char_reference_invalid', baseOffset + amp);
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

    function fail(code, offset) {
      throw Object.assign(new Error(code), {
        code,
        offset: typeof offset === 'number' ? offset : cursor,
      });
    }

    function currentNode() {
      return stack.length ? stack[stack.length - 1] : null;
    }

    function appendText(raw, offset, decode) {
      if (decode && raw.includes(']]>')) fail('vast.xml.cdata_end_in_text', offset);
      const text = decode ? decodeEntities(raw, offset, fail) : raw;
      const current = currentNode();
      if (current) current.text += text;
      else if (text.trim()) fail('vast.xml.text_outside_root', offset);
    }

    function skipWhitespace() {
      while (cursor < xml.length && /\s/.test(xml[cursor])) cursor++;
    }

    function parseName() {
      const start = cursor;
      while (cursor < xml.length && !/[\s=/>]/.test(xml[cursor])) cursor++;
      const name = xml.slice(start, cursor);
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) fail('vast.xml.name_invalid', start);
      return name;
    }

    function appendElement(node) {
      const parent = currentNode();
      if (parent) parent.children.push(node);
      else if (rootNode) fail('vast.xml.multiple_roots', node.offset);
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
        if (end < 0) fail('vast.xml.comment_unterminated', cursor);
        if (xml.slice(cursor + 4, end).includes('--')) {
          fail('vast.xml.comment_double_hyphen', cursor);
        }
        cursor = end + 3;
        continue;
      }
      if (xml.startsWith('<![CDATA[', cursor)) {
        const start = cursor + 9;
        const end = xml.indexOf(']]>', start);
        if (end < 0) fail('vast.xml.cdata_unterminated', cursor);
        appendText(xml.slice(start, end), start, false);
        cursor = end + 3;
        continue;
      }
      if (xml.startsWith('<?', cursor)) {
        const end = xml.indexOf('?>', cursor + 2);
        if (end < 0) fail('vast.xml.processing_instruction_unterminated', cursor);
        cursor = end + 2;
        continue;
      }
      if (/^<!DOCTYPE\b/i.test(xml.slice(cursor))) {
        fail('vast.xml.doctype_unsupported', cursor);
      }
      if (xml.startsWith('<!', cursor)) fail('vast.xml.declaration_unsupported', cursor);

      if (xml.startsWith('</', cursor)) {
        const closingOffset = cursor;
        cursor += 2;
        const name = parseName();
        skipWhitespace();
        if (xml[cursor] !== '>') fail('vast.xml.closing_tag_expected_gt', cursor);
        cursor++;
        const open = stack.pop();
        if (!open) fail('vast.xml.closing_tag_unexpected', closingOffset);
        if (open.name !== name) {
          fail('vast.xml.closing_tag_mismatch', closingOffset);
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
        if (cursor >= xml.length) fail('vast.xml.start_tag_unterminated', elementOffset);

        const attributeOffset = cursor;
        const attributeName = parseName();
        if (Object.hasOwn(attributes, attributeName)) {
          fail('vast.xml.attribute_duplicate', attributeOffset);
        }
        skipWhitespace();
        if (xml[cursor] !== '=') fail('vast.xml.attribute_expected_equals', cursor);
        cursor++;
        skipWhitespace();
        const quote = xml[cursor];
        if (quote !== '"' && quote !== "'") fail('vast.xml.attribute_unquoted', cursor);
        cursor++;
        const valueOffset = cursor;
        const end = xml.indexOf(quote, cursor);
        if (end < 0) fail('vast.xml.attribute_unterminated', valueOffset);
        const rawValue = xml.slice(cursor, end);
        if (rawValue.includes('<')) fail('vast.xml.attribute_lt', valueOffset);
        attributes[attributeName] = decodeEntities(rawValue, valueOffset, fail);
        cursor = end + 1;
      }

      const node = { name, attributes, children: [], text: '', offset: elementOffset };
      appendElement(node);
      if (!selfClosing) {
        if (stack.length + 1 > MAX_XML_DEPTH) {
          fail('vast.input.depth_limit', elementOffset);
        }
        stack.push(node);
      }
    }

    if (stack.length) {
      fail('vast.xml.element_unclosed', xml.length);
    }
    if (!rootNode) fail('vast.xml.root_missing', 0);
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

  function buildNotes(version, ads, timeline) {
    const notes = [];
    if (version === null) notes.push(makeNote('vast.note.version_missing'));
    if (ads.some((ad) => ad.type === 'unknown')) {
      notes.push(makeNote('vast.note.ad_type_unknown'));
    }
    if (ads.some((ad) => ad.duration !== null && ad.durationSeconds === null)) {
      notes.push(makeNote('vast.note.duration_invalid'));
    }
    if (!timeline.length) notes.push(makeNote('vast.note.timeline_empty'));
    else if (timeline.some((entry) => entry.timeSeconds === null)) {
      notes.push(makeNote('vast.note.timeline_relative'));
    }
    return notes;
  }

  /**
   * @param {unknown} xml
   * @returns {any}
   */
  function parseVastTimeline(xml) {
    if (typeof xml !== 'string') return failure('vast.input.not_string', '', 0);
    if (xml.length > MAX_DOCUMENT_LENGTH) {
      return failure('vast.input.size_limit', xml, MAX_DOCUMENT_LENGTH);
    }
    if (
      !formatDetect ||
      typeof formatDetect.isVastShape !== 'function' ||
      typeof formatDetect.detectVastVersion !== 'function'
    ) {
      return failure('vast.runtime.detector_unavailable', xml, 0);
    }
    if (!formatDetect.isVastShape(xml)) {
      const first = xml.search(/\S/);
      return failure('vast.input.not_vast_shape', xml, first < 0 ? 0 : first);
    }

    try {
      const rootNode = parseXml(xml);
      if (localName(rootNode) !== 'vast')
        return failure('vast.input.root_not_vast', xml, rootNode.offset);
      const ads = [];
      const timeline = [];
      for (const adNode of directChildren(rootNode, 'Ad')) {
        const extracted = extractAd(adNode, ads.length);
        ads.push(extracted.ad);
        timeline.push(...extracted.timeline);
      }
      const version = formatDetect.detectVastVersion(xml);
      return {
        ok: true,
        version,
        ads,
        timeline,
        notes: buildNotes(version, ads, timeline),
      };
    } catch (error) {
      if (error && typeof error.code === 'string' && VAST_DIAGNOSTIC_BY_CODE.has(error.code)) {
        return failure(error.code, xml, typeof error.offset === 'number' ? error.offset : 0);
      }
      return failure('vast.runtime.parse_failed', xml, 0);
    }
  }

  return { parseVastTimeline, VAST_DIAGNOSTICS, MAX_DOCUMENT_LENGTH, MAX_XML_DEPTH };
});
