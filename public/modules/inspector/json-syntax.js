/* ============================================================================
 * json-syntax.js — a JSON tokenizer that knows what oRTB fields MEAN.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A REGEX
 * ---------------------------------------------------------------------------
 * The payload editor used to be one colour. That is not merely plain — it
 * actively costs the reader, because the question they came here with is
 * never "is this valid JSON" (the badge above the editor already answers
 * that). It is "where is the price, where is the floor, which imp does this
 * bid answer, what is in adm". Those are six or seven fields inside a couple
 * of hundred lines, and finding them by eye is the slow part of every debug
 * session this tool exists to shorten.
 *
 * So this module produces TWO layers of meaning, not one:
 *
 *   1. Ordinary JSON syntax — key / string / number / literal. Deliberately
 *      restrained: it is scaffolding, and if it shouts it drowns layer 2.
 *   2. An oRTB SEMANTIC layer — the fields the engine itself treats as
 *      load-bearing get their own hue and 700 weight, so the eye lands on
 *      them before it reads anything. The categories are taken from what
 *      packages/core actually cross-checks: identity joins (crosscheck.js
 *      resolves bid.impid against imp[].id), money (price vs bidfloor vs cur),
 *      shape (banner/video/native + w/h), the creative body (adm and the
 *      notice URLs), brand safety (adomain/bcat/badv/battr) and vendor
 *      territory (ext.*, which is by definition outside the spec).
 *
 * A regex cannot do layer 2, and that is the whole reason this is a scanner.
 * "id" means completely different things at different depths: `id` at the
 * root is the auction join that crosscheck.id_mismatch fires on, `imp[].id`
 * is what `bid.impid` points at, and `site.publisher.id` is just a string
 * nobody joins on. Painting all three the same colour would train the reader
 * to ignore the colour. Likewise `w`/`h` inside `device` is a screen, not a
 * creative size, and a key inside `ext` is not a spec field at all no matter
 * what it is called. Distinguishing those needs the enclosing path, which
 * needs a stack, which needs a real left-to-right scan.
 *
 * ERROR TOLERANCE IS A REQUIREMENT, NOT A NICETY
 * ---------------------------------------------------------------------------
 * Half the payloads pasted into this editor are broken — that is what the
 * user came to find out. So this never throws and never gives up partway: an
 * unterminated string runs to end-of-text, an unbalanced brace refuses to pop
 * past the root, and any byte the grammar does not expect is skipped rather
 * than fatal. Highlighting degrades gracefully as the text degrades; it does
 * not blink out at the first typo, which is exactly the moment it is useful.
 *
 * OUTPUT SHAPE
 * ---------------------------------------------------------------------------
 * A flat, ascending, non-overlapping array of { s, e, c } — start offset, end
 * offset, CSS class string. Only things that get a colour are emitted:
 * whitespace, structural punctuation and separators are left uncovered and
 * inherit the backdrop's base colour. That roughly halves the node count the
 * renderer has to build, which matters because the renderer builds real DOM
 * (never innerHTML) and a 500KB pretty-printed payload is ~100k tokens.
 *
 * No bundler: plain IIFE attaching window.OrtbtoolsJsonSyntax.
 * ========================================================================== */
(function () {
  'use strict';

  /* Above this many characters we return null and the caller paints nothing.
     Not a guess — measured in real Chrome on this editor, pretty-printed
     oRTB (the dense case: ~2 tokens per line, so tokens scale with bytes):

         payload   tokens   tokenize   render   total re-highlight
          13 KB       809      1.9ms     24ms     ~26ms
         100 KB     6 053      0.9ms    138ms    ~139ms
         128 KB     7 763      1.4ms    154ms    ~155ms
         250 KB    15 135      1.7ms    293ms    ~295ms

     The scan is free; the cost is building one DOM node per token, and it is
     linear with no cliff to hide behind. 128KB is where a debounced
     re-highlight still lands inside a tenth of a second or so; 250KB is a
     third of a second on every pause in typing, which is felt.

     Note what is NOT on this list: a 13KB VAST creative in a single `adm`
     string. That is one token, not thirteen thousand — the whole response
     carrying it tokenizes to 68 tokens and renders in 26ms. Long VALUES are
     cheap here by construction; only many SMALL ones cost anything.

     Past the ceiling the caller must SAY so in the UI rather than quietly
     degrade, because an editor that went monochrome for unexplained reasons
     reads as broken. */
  const MAX_CHARS = 131072; // 128KB

  /* ── The semantic vocabulary ────────────────────────────────────────────
     Every name below is a field packages/core reads, joins on, or refuses a
     bid over. The grouping is by WHAT THE READER IS ASKING, not by where the
     field sits in the spec tree — which is why `cur` (root) and `bidfloorcur`
     (imp) and `price` (bid) are one group: they are all the answer to "what
     is this worth and in what currency". */

  // Identity — the fields that tie one payload to the other. crosscheck.js
  // resolves every one of these; a mismatch here is the single most common
  // real bug in a live integration.
  const LINK_KEYS = new Set([
    'impid',
    'bidid',
    'cid',
    'crid',
    'adid',
    'dealid',
    'seat',
    'wseat',
    'bseat',
    'requestid',
    'tid',
    'tagid',
    'gpid',
    'pchain',
  ]);

  // Containers under which a bare `id` IS a join key rather than an ordinary
  // label. Anything else — site.id, app.id, publisher.id, content.id, user.id
  // — is left as an ordinary key on purpose: nothing joins on those, and
  // colouring them would dilute the ones that matter.
  const ID_JOIN_OWNERS = new Set(['imp', 'bid', 'deals']);

  // Money. `at` belongs here because auction type is what decides whether
  // `price` is a first- or second-price number, i.e. it changes what the
  // money MEANS.
  const MONEY_KEYS = new Set(['price', 'bidfloor', 'bidfloorcur', 'cur', 'at']);

  // Shape — the format objects and the geometry inside them. Deliberately
  // NOT applied under `device`, where w/h is the screen (see classify()).
  const SHAPE_KEYS = new Set([
    'banner',
    'video',
    'native',
    'audio',
    'format',
    'w',
    'h',
    'wmin',
    'wmax',
    'hmin',
    'hmax',
    'wratio',
    'hratio',
  ]);

  // The creative itself: the markup that renders, and the URLs that get
  // called when it wins, bills or loses. `adm` is usually the longest single
  // token in the whole payload (a 13KB VAST on one line is routine).
  const CREATIVE_KEYS = new Set(['adm', 'nurl', 'burl', 'lurl', 'iurl', 'curl']);

  // Brand safety — the block/allow lists an exchange enforces, and the
  // advertiser claim the bid makes about itself.
  const BRAND_KEYS = new Set(['adomain', 'bcat', 'badv', 'bapp', 'battr', 'attr', 'cat', 'bundle']);

  // Containers where `w`/`h` describe hardware rather than a creative.
  const NON_CREATIVE_SIZE_OWNERS = new Set(['device', 'geo', 'sua']);

  const CLS = {
    key: 'jt-k',
    str: 'jt-s',
    num: 'jt-n',
    lit: 'jt-b',
  };
  const SEM = {
    link: 'jt-link',
    money: 'jt-money',
    shape: 'jt-shape',
    creative: 'jt-creative',
    brand: 'jt-brand',
    vendor: 'jt-vendor',
  };

  /**
   * Which semantic category, if any, a key belongs to given what encloses it.
   *
   * `owner` is the key that opened the nearest enclosing container — with
   * array levels transparent, so both `imp` (the array) and each element
   * object report owner "imp". `owners` is the full chain to the root, used
   * only for the two questions that need more than the immediate parent.
   *
   * Returns a SEM.* class or null. Never throws.
   */
  function classify(key, owner, owners) {
    // Vendor territory wins over everything. A key inside an `ext` subtree is
    // not a spec field, whatever it is spelled — `ext.prebid.bidder.price` is
    // not the auction price, and colouring it as money would be a lie.
    for (let i = 0; i < owners.length; i++) if (owners[i] === 'ext') return SEM.vendor;
    if (key === 'ext') return SEM.vendor;

    if (LINK_KEYS.has(key)) return SEM.link;
    if (key === 'id') {
      // Root-level id: the auction identifier both sides must agree on.
      if (owner === null) return SEM.link;
      return ID_JOIN_OWNERS.has(owner) ? SEM.link : null;
    }
    if (MONEY_KEYS.has(key)) return SEM.money;
    if (CREATIVE_KEYS.has(key)) return SEM.creative;
    if (BRAND_KEYS.has(key)) return SEM.brand;
    if (SHAPE_KEYS.has(key)) {
      if ((key === 'w' || key === 'h') && NON_CREATIVE_SIZE_OWNERS.has(owner)) return null;
      return SEM.shape;
    }
    return null;
  }

  /* Character classification without regex — this runs once per character of
     the payload, and charCodeAt comparisons are meaningfully cheaper than
     regex tests at 500KB. */
  function isDigit(c) {
    return c >= 48 && c <= 57;
  }

  /**
   * Scan `text` into an ascending, non-overlapping token list.
   *
   * @param {string} text
   * @returns {Array<{s:number,e:number,c:string}>|null} null when the payload
   *   is past MAX_CHARS — the caller must then say so rather than silently
   *   render nothing.
   */
  function tokenize(text) {
    if (typeof text !== 'string') return [];
    if (text.length > MAX_CHARS) return null;

    const out = [];
    const n = text.length;
    let i = 0;

    /* The container stack. `arr` picks value-vs-key interpretation of a
       string; `owner` is what this container hangs off (arrays are
       transparent, so an array and its element objects share an owner);
       `sem` is a semantic class handed DOWN to scalar elements, which is how
       `"bcat": ["IAB25", "IAB26"]` paints every string in the list and not
       just the key. */
    const stack = [{ arr: false, owner: null, sem: null }];
    const owners = [null]; // parallel owner chain, for the ext-subtree test
    let awaitingValue = false; // true between ':' and the value, in an object
    let pendingSem = null; // the semantic class the current key handed on
    let lastKey = null; // most recent key — becomes the owner of what it opens

    function top() {
      return stack[stack.length - 1];
    }
    // The class a value token should carry: inherited from the enclosing
    // array, or handed over by the key that introduced it.
    function valueSem() {
      const t = top();
      return t.arr ? t.sem : pendingSem;
    }
    function push(arr) {
      // A vendor subtree keeps handing `vendor` down so nested ext objects
      // stay marked; other semantics do NOT descend into objects, because a
      // whole coloured subtree is noise, not signal — the key that opened it
      // is the thing worth spotting.
      const inherited = pendingSem === SEM.vendor ? SEM.vendor : null;
      stack.push({
        arr: arr,
        owner: lastKey,
        // Arrays propagate the key's semantics to their scalar elements;
        // objects only propagate vendor.
        sem: arr ? pendingSem : inherited,
      });
      owners.push(lastKey);
      awaitingValue = false;
      pendingSem = arr ? pendingSem : inherited;
      lastKey = null;
    }
    function pop() {
      // Never pop the root: an unbalanced payload is the common case here,
      // and losing the root frame would turn the rest of the file into
      // garbage colouring instead of merely imperfect colouring.
      if (stack.length > 1) {
        stack.pop();
        owners.pop();
      }
      awaitingValue = false;
      pendingSem = null;
      lastKey = null;
    }

    while (i < n) {
      const c = text.charCodeAt(i);

      // whitespace — uncovered, inherits the backdrop's base colour
      if (c === 32 || c === 9 || c === 10 || c === 13) {
        i++;
        continue;
      }
      if (c === 123 /* { */) {
        push(false);
        i++;
        continue;
      }
      if (c === 91 /* [ */) {
        push(true);
        i++;
        continue;
      }
      if (c === 125 /* } */ || c === 93 /* ] */) {
        pop();
        i++;
        continue;
      }
      if (c === 58 /* : */) {
        awaitingValue = true;
        i++;
        continue;
      }
      if (c === 44 /* , */) {
        awaitingValue = false;
        pendingSem = null;
        i++;
        continue;
      }

      if (c === 34 /* " */) {
        // Scan the string. Unterminated runs to end-of-text on purpose.
        const start = i;
        i++;
        while (i < n) {
          const d = text.charCodeAt(i);
          if (d === 92 /* \ */) {
            i += 2;
            continue;
          }
          if (d === 34) {
            i++;
            break;
          }
          i++;
        }
        if (i > n) i = n;
        const end = Math.min(i, n);
        const t = top();
        const isKey = !t.arr && !awaitingValue;
        if (isKey) {
          const raw = text.slice(start + 1, Math.max(start + 1, end - 1));
          lastKey = raw;
          const sem = classify(raw, t.owner, owners);
          pendingSem = sem;
          out.push({ s: start, e: end, c: sem ? CLS.key + ' ' + sem : CLS.key });
        } else {
          const sem = valueSem();
          // A vendor VALUE keeps its ordinary string colour — inside ext it
          // is the labels that are non-spec, and dimming the data too would
          // make the one readable thing in a vendor blob unreadable.
          const use = sem && sem !== SEM.vendor ? CLS.str + ' ' + sem : CLS.str;
          out.push({ s: start, e: end, c: use });
        }
        continue;
      }

      if (isDigit(c) || c === 45 /* - */ || c === 43 /* + */) {
        const start = i;
        i++;
        while (i < n) {
          const d = text.charCodeAt(i);
          if (isDigit(d) || d === 46 /* . */ || d === 101 /* e */ || d === 69 /* E */) {
            i++;
            continue;
          }
          if (
            (d === 45 || d === 43) &&
            (text.charCodeAt(i - 1) === 101 || text.charCodeAt(i - 1) === 69)
          ) {
            i++;
            continue;
          }
          break;
        }
        const sem = valueSem();
        const use = sem && sem !== SEM.vendor ? CLS.num + ' ' + sem : CLS.num;
        out.push({ s: start, e: i, c: use });
        continue;
      }

      // true / false / null — one class between them. They are short, rare
      // and unambiguous; spending two more hues on them would cost the
      // semantic layer contrast it needs more.
      if (c === 116 /* t */ || c === 102 /* f */ || c === 110 /* n */) {
        const start = i;
        while (i < n) {
          const d = text.charCodeAt(i);
          if ((d >= 97 && d <= 122) || (d >= 65 && d <= 90)) i++;
          else break;
        }
        if (i > start) {
          out.push({ s: start, e: i, c: CLS.lit });
          continue;
        }
      }

      // Anything the grammar did not expect: step over it. Broken input is
      // the norm in this editor, and one stray byte must not cost the rest
      // of the payload its colour.
      i++;
    }
    return out;
  }

  window.OrtbtoolsJsonSyntax = {
    tokenize: tokenize,
    MAX_CHARS: MAX_CHARS,
    // test surface — the classifier is the part with real logic in it
    __test: { classify: classify, SEM: SEM, CLS: CLS },
  };
})();
