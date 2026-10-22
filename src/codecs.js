/*
 * MBX.Codecs — encoding registry, byte-exact codecs with byte-aligned segmentation,
 * and the "damaged relic" UTF-8 repair decoder.
 *
 * Design notes
 * ------------
 * - Legacy encodings are NOT hand-tabled. Forward/reverse tables are derived lazily from the
 *   host's TextDecoder, so the app always agrees with the platform it runs on. This matters:
 *   browsers follow the WHATWG Encoding Standard, while Node's TextDecoder uses stock ICU
 *   converters whose mappings *and* error handling differ (e.g. ICU's Shift_JIS maps 0x7F to
 *   U+001A, ICU's EUC-KR is not UHC, ICU's "gbk" has no GB18030 four-byte sequences).
 * - For multi-byte encodings even the error-handling policy (does an invalid trail byte get
 *   consumed or re-read?) is learned by probing TextDecoder with byte pairs and matching the
 *   result against "consume 1 byte" / "consume 2 bytes" hypotheses. Longer forms (EUC-JP 0x8F
 *   three-byte, GB18030 four-byte) are resolved on demand by the same hypothesis matching on a
 *   small window, with a cache. The property tests compare every decoder with TextDecoder.
 * - One stateful platform quirk is emulated when detected: Chromium's EUC-JP decoder keeps its
 *   JIS X 0212 flag after a malformed "8F xx" sequence (the spec and Firefox clear it).
 * - iso-8859-1 (true identity) and cp437 are implemented directly: WHATWG maps the
 *   "iso-8859-1" label to windows-1252 and has no cp437 at all.
 */
(function (root) {
  'use strict';
  const MBX = (root.MBX = root.MBX || {});

  const FFFD = '\uFFFD';
  const TD = typeof TextDecoder === 'function' ? TextDecoder : null;

  /**
   * UI language for user-visible text (docs §11.2), by the one rule every module shares:
   * MBX.I18n.resolve(arg), where arg is a locale string or an options object with `locale`. A
   * supported tag wins ('en', ' en_US ', 'zh-TW'...); anything else follows the current UI
   * language. Without src/i18n.js the same tag rule applies and everything else is zh-CN. Read at
   * call time so a language switch applies to the next call.
   */
  function localeOf(arg) {
    const I18n = MBX.I18n;
    if (I18n && typeof I18n.resolve === 'function') {
      try {
        return I18n.resolve(arg) === 'en-US' ? 'en-US' : 'zh-CN';
      } catch (_) { /* fall through */ }
    }
    // Without I18n.resolve: the I18n.normalize tag rule, then the current language, then zh-CN.
    const tag = typeof arg === 'string' ? arg : arg && typeof arg === 'object' ? arg.locale : null;
    const s = typeof tag === 'string' ? tag.trim() : '';
    if (/^en(?:[-_]|$)/i.test(s)) return 'en-US';
    if (/^zh(?:[-_]|$)/i.test(s)) return 'zh-CN';
    if (I18n && typeof I18n.getLocale === 'function') {
      try {
        return /^en(?:[-_]|$)/i.test(String(I18n.getLocale()).trim()) ? 'en-US' : 'zh-CN';
      } catch (_) { /* fall through */ }
    }
    return 'zh-CN';
  }
  const isEn = (arg) => localeOf(arg) === 'en-US';

  // ---------------------------------------------------------------------------
  // Registry (order = search priority, see docs/ARCHITECTURE.md §2)
  // ---------------------------------------------------------------------------

  // [id, name, zh, en, type, region, whatwg label | null, year of birth]
  // zh / en: the short description shown next to the name (Codecs.describe picks one by locale).
  // Years are first standardisation or first shipping use, to the year (some are approximate:
  // Shift_JIS ~1982, EUC-JP ~1985, CP866 ~1987, Windows-125x with Windows 3.x ~1990–1993).
  const SPECS = [
    ['utf-8', 'UTF-8', '万国码 UTF-8', 'Universal Unicode (UTF-8)', 'utf8', 'universal', 'utf-8', 1992],
    ['gbk', 'GBK / GB18030', '简体中文（代码页 936）', 'Simplified Chinese (GBK / GB18030)', 'double', 'zh-Hans', 'gbk', 1995],
    ['big5', 'Big5', '繁体中文（代码页 950）', 'Traditional Chinese (Big5, code page 950)', 'double', 'zh-Hant', 'big5', 1984],
    ['shift_jis', 'Shift_JIS', '日文（代码页 932）', 'Japanese (Shift_JIS)', 'double', 'ja', 'shift_jis', 1982],
    ['euc-jp', 'EUC-JP', '日文 Unix', 'Japanese Unix (EUC-JP)', 'double', 'ja', 'euc-jp', 1985],
    ['euc-kr', 'EUC-KR', '韩文（代码页 949）', 'Korean (EUC-KR, code page 949)', 'double', 'ko', 'euc-kr', 1987],
    ['windows-1252', 'Windows-1252', '西欧（常被误称 Latin-1）', 'Western European (Windows-1252)', 'single', 'west', 'windows-1252', 1985],
    ['iso-8859-1', 'ISO-8859-1', '真·Latin-1（字节=码位）', 'True Latin-1 (bytes = code points)', 'single', 'west', null, 1987],
    ['windows-1251', 'Windows-1251', '西里尔/俄文', 'Cyrillic / Russian (Windows-1251)', 'single', 'cyrillic', 'windows-1251', 1990],
    ['koi8-r', 'KOI8-R', '俄文 Unix/邮件', 'Russian Unix / email (KOI8-R)', 'single', 'cyrillic', 'koi8-r', 1993],
    ['macintosh', 'Mac OS Roman', '经典 Mac 西欧', 'Classic Mac Western European (Mac OS Roman)', 'single', 'west', 'macintosh', 1984],
    ['cp437', 'CP437', 'IBM PC / DOS 美国；ZIP 文件名默认编码', 'IBM PC / DOS (US), the default for ZIP file names', 'single', 'dos', null, 1981],
    ['ibm866', 'CP866', 'DOS 西里尔', 'DOS Cyrillic (CP866)', 'single', 'cyrillic', 'ibm866', 1987],
    ['windows-1250', 'Windows-1250', '中欧', 'Central European (Windows-1250)', 'single', 'central-eu', 'windows-1250', 1992],
    ['windows-1253', 'Windows-1253', '希腊文', 'Greek (Windows-1253)', 'single', 'greek', 'windows-1253', 1992],
    ['windows-1254', 'Windows-1254', '土耳其文', 'Turkish (Windows-1254)', 'single', 'turkish', 'windows-1254', 1992],
    ['windows-1255', 'Windows-1255', '希伯来文', 'Hebrew (Windows-1255)', 'single', 'hebrew', 'windows-1255', 1992],
    ['windows-1256', 'Windows-1256', '阿拉伯文', 'Arabic (Windows-1256)', 'single', 'arabic', 'windows-1256', 1993],
    ['windows-874', 'Windows-874', '泰文', 'Thai (Windows-874)', 'single', 'thai', 'windows-874', 1993],
    ['utf-16le', 'UTF-16LE', 'Windows 所称的 "Unicode"', 'Windows "Unicode" (UTF-16LE)', 'utf16', 'universal', 'utf-16le', 1996],
    ['utf-16be', 'UTF-16BE', '大端 UTF-16', 'Big-endian UTF-16 (UTF-16BE)', 'utf16', 'universal', 'utf-16be', 1996],
  ];

  // CP437 0x80–0xFF, verbatim from docs/ARCHITECTURE.md §2.1 (0xFF is NO-BREAK SPACE).
  const CP437_HIGH =
    'ÇüéâäàåçêëèïîìÄÅ' +
    'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
    'áíóúñÑªº¿⌐¬½¼¡«»' +
    '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
    '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
    '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
    'αßΓπΣσµτΦΘΩδ∞φε∩' +
    '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00A0';

  function makeDecoder(label) {
    if (!TD || !label) return null;
    try {
      return new TD(label);
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  function toBytes(bytes) {
    if (bytes instanceof Uint8Array) return bytes;
    if (bytes == null) return new Uint8Array(0);
    if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    return Uint8Array.from(bytes);
  }

  const isSingleCp = (s) =>
    s.length === 1 || (s.length === 2 && s.charCodeAt(0) >= 0xd800 && s.charCodeAt(0) <= 0xdbff);

  function endsWithArr(arr, tail) {
    if (tail.length > arr.length) return false;
    const off = arr.length - tail.length;
    for (let k = 0; k < tail.length; k++) if (arr[off + k] !== tail[k]) return false;
    return true;
  }

  /**
   * A decode function that uses a fresh TextDecoder for every call. Some platform decoders
   * leak state from one decode() call into the next (Chromium's EUC-JP keeps its JIS X 0212
   * flag after an error), which would silently poison the probes below.
   */
  function freshDecode(label) {
    return (bytes) => new TD(label).decode(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
  }

  /**
   * Decodes many short byte chunks with one decoder call by joining them with LF.
   * LF is ASCII, and every decoder we use emits an ASCII byte that follows an unfinished
   * sequence as-is, so splitting on LF recovers one result per chunk. If the split count is
   * off (unexpected decoder behaviour) we fall back to decoding chunks one by one.
   */
  function probeBatch(dec, chunks) {
    const res = new Array(chunks.length);
    const batched = [];
    let size = 0;
    for (let k = 0; k < chunks.length; k++) {
      if (chunks[k].indexOf(0x0a) >= 0) res[k] = dec(chunks[k]);
      else {
        batched.push(k);
        size += chunks[k].length + 1;
      }
    }
    const buf = new Uint8Array(size);
    let p = 0;
    for (const k of batched) {
      buf.set(chunks[k], p);
      p += chunks[k].length;
      buf[p++] = 0x0a;
    }
    const parts = dec(buf).split('\n');
    if (parts.length === batched.length + 1) {
      for (let q = 0; q < batched.length; q++) res[batched[q]] = parts[q];
    } else {
      for (const k of batched) res[k] = dec(chunks[k]);
    }
    return res;
  }

  // Collects one Seg per output code point; segments are contiguous by construction.
  class Sink {
    constructor() {
      this.segs = [];
      this.pos = 0;
      this.errors = 0;
    }
    push(ch, end, error) {
      const seg = { ch, start: this.pos, end };
      if (error) {
        seg.error = true;
        this.errors++;
      }
      this.segs.push(seg);
      this.pos = end;
      return seg;
    }
    /**
     * Emits a decoder output that may hold several code points for one byte unit
     * (e.g. Big5 "Ê̄"). Code points are spread one byte each; extras become zero-width.
     */
    pushOut(str, end) {
      if (isSingleCp(str)) {
        this.push(str, end, str === FFFD);
        return;
      }
      const cps = Array.from(str);
      for (let k = 0; k < cps.length; k++) {
        const e = k === cps.length - 1 ? end : Math.min(this.pos + 1, end);
        this.push(cps[k], e, cps[k] === FFFD);
      }
    }
    text() {
      let s = '';
      for (const seg of this.segs) s += seg.ch;
      return s;
    }
  }

  // ---------------------------------------------------------------------------
  // UTF-8 (WHATWG decoder, maximal-subpart replacement; BOM stripped like TextDecoder)
  // ---------------------------------------------------------------------------

  function utf8SeqLen(b) {
    if (b >= 0xc2 && b <= 0xdf) return 2;
    if (b >= 0xe0 && b <= 0xef) return 3;
    if (b >= 0xf0 && b <= 0xf4) return 4;
    return 0;
  }

  // Allowed range for the second byte of a sequence, which carries the overlong/surrogate rules.
  function secondByteOk(lead, c) {
    if (lead === 0xe0) return c >= 0xa0 && c <= 0xbf;
    if (lead === 0xed) return c >= 0x80 && c <= 0x9f;
    if (lead === 0xf0) return c >= 0x90 && c <= 0xbf;
    if (lead === 0xf4) return c >= 0x80 && c <= 0x8f;
    return c >= 0x80 && c <= 0xbf;
  }

  /** Code point of a complete, well-formed UTF-8 sequence, or -1. */
  function utf8CodePoint(seq) {
    const L = utf8SeqLen(seq[0]);
    if (!L || seq.length !== L) return -1;
    if (!secondByteOk(seq[0], seq[1])) return -1;
    let cp = seq[0] & (L === 2 ? 0x1f : L === 3 ? 0x0f : 0x07);
    for (let k = 1; k < L; k++) {
      if (seq[k] < 0x80 || seq[k] > 0xbf) return -1;
      cp = (cp << 6) | (seq[k] & 0x3f);
    }
    return cp;
  }

  function hasUtf8Bom(bytes, end) {
    return end >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  }

  const utf8Codec = {
    decodeInto(bytes, start, end, sink) {
      let i = start;
      if (start === 0 && hasUtf8Bom(bytes, end)) i = 3; // bytes stay attached to the first Seg
      while (i < end) {
        const b = bytes[i];
        if (b < 0x80) {
          sink.push(String.fromCharCode(b), i + 1);
          i++;
          continue;
        }
        const L = utf8SeqLen(b);
        if (!L) {
          sink.push(FFFD, i + 1, true);
          i++;
          continue;
        }
        let cp = b & (L === 2 ? 0x1f : L === 3 ? 0x0f : 0x07);
        let j = i + 1;
        let ok = true;
        for (let k = 1; k < L; k++, j++) {
          if (j >= end) {
            ok = false;
            break;
          }
          const c = bytes[j];
          if (k === 1 ? !secondByteOk(b, c) : c < 0x80 || c > 0xbf) {
            ok = false;
            break;
          }
          cp = (cp << 6) | (c & 0x3f);
        }
        // On failure the offending byte is not consumed (WHATWG "prepend"), so i = j either way.
        if (ok) sink.push(String.fromCodePoint(cp), j);
        else sink.push(FFFD, j, true);
        i = j;
      }
    },
    encodeCp(cp, out, n) {
      if (cp < 0x80) {
        out[n] = cp;
        return n + 1;
      }
      if (cp < 0x800) {
        out[n] = 0xc0 | (cp >> 6);
        out[n + 1] = 0x80 | (cp & 0x3f);
        return n + 2;
      }
      if (cp >= 0xd800 && cp <= 0xdfff) return -1; // lone surrogate: not representable
      if (cp < 0x10000) {
        out[n] = 0xe0 | (cp >> 12);
        out[n + 1] = 0x80 | ((cp >> 6) & 0x3f);
        out[n + 2] = 0x80 | (cp & 0x3f);
        return n + 3;
      }
      out[n] = 0xf0 | (cp >> 18);
      out[n + 1] = 0x80 | ((cp >> 12) & 0x3f);
      out[n + 2] = 0x80 | ((cp >> 6) & 0x3f);
      out[n + 3] = 0x80 | (cp & 0x3f);
      return n + 4;
    },
    entries: null,
  };

  // ---------------------------------------------------------------------------
  // UTF-16LE / UTF-16BE (WHATWG: odd tail byte and lone surrogates -> U+FFFD)
  // ---------------------------------------------------------------------------

  function makeUtf16Codec(le) {
    const unit = le ? (b, i) => b[i] | (b[i + 1] << 8) : (b, i) => (b[i] << 8) | b[i + 1];
    return {
      decodeInto(bytes, start, end, sink) {
        let i = start;
        if (start === 0 && end >= 2 && bytes[0] === (le ? 0xff : 0xfe) && bytes[1] === (le ? 0xfe : 0xff)) i = 2;
        while (i + 1 < end) {
          const cu = unit(bytes, i);
          if (cu >= 0xd800 && cu <= 0xdbff) {
            if (i + 3 < end) {
              const cu2 = unit(bytes, i + 2);
              if (cu2 >= 0xdc00 && cu2 <= 0xdfff) {
                sink.push(String.fromCharCode(cu, cu2), i + 4);
                i += 4;
              } else {
                sink.push(FFFD, i + 2, true); // the following unit is decoded afresh
                i += 2;
              }
            } else {
              // Pending lead surrogate at EOF (possibly plus an odd byte): one error for all.
              sink.push(FFFD, end, true);
              i = end;
            }
            continue;
          }
          if (cu >= 0xdc00 && cu <= 0xdfff) sink.push(FFFD, i + 2, true);
          else sink.push(String.fromCharCode(cu), i + 2);
          i += 2;
        }
        if (i < end) sink.push(FFFD, end, true); // odd trailing byte
      },
      encodeCp(cp, out, n) {
        if (cp >= 0xd800 && cp <= 0xdfff) return -1;
        const put = (u) => {
          if (le) {
            out[n++] = u & 0xff;
            out[n++] = u >> 8;
          } else {
            out[n++] = u >> 8;
            out[n++] = u & 0xff;
          }
        };
        if (cp < 0x10000) put(cp);
        else {
          const v = cp - 0x10000;
          put(0xd800 | (v >> 10));
          put(0xdc00 | (v & 0x3ff));
        }
        return n;
      },
      entries: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Single-byte encodings
  // ---------------------------------------------------------------------------

  function singleByteTable(id, td) {
    if (id === 'iso-8859-1') return Array.from({ length: 256 }, (_, b) => String.fromCharCode(b));
    if (id === 'cp437') {
      const high = Array.from(CP437_HIGH);
      return Array.from({ length: 256 }, (_, b) => (b < 0x80 ? String.fromCharCode(b) : high[b - 0x80]));
    }
    const all = Array.from(td.decode(Uint8Array.from({ length: 256 }, (_, b) => b)));
    if (all.length === 256) return all;
    // Defensive: some byte produced zero or several code points; decode bytes one at a time.
    return Array.from({ length: 256 }, (_, b) => td.decode(Uint8Array.of(b)));
  }

  function makeSingleByteCodec(info) {
    const table = singleByteTable(info.id, makeDecoder(info.whatwg));
    const rev = new Map();
    for (let b = 0; b < 256; b++) {
      const ch = table[b];
      if (ch === FFFD || !isSingleCp(ch)) continue;
      const cp = ch.codePointAt(0);
      if (!rev.has(cp)) rev.set(cp, b); // lowest byte wins on duplicates
    }
    return {
      table,
      decodeInto(bytes, start, end, sink) {
        for (let i = start; i < end; i++) sink.pushOut(table[bytes[i]], i + 1);
      },
      encodeCp(cp, out, n) {
        const b = rev.get(cp);
        if (b === undefined) return -1;
        out[n] = b;
        return n + 1;
      },
      entries() {
        return Array.from(rev, ([cp, b]) => [String.fromCodePoint(cp), [b]]);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Multi-byte (double-byte family) encodings, learned from TextDecoder
  // ---------------------------------------------------------------------------

  const K_INDEP = 0; // emit the lead's own single-byte decoding, re-read the next byte
  const K_PAIR = 1; // the two bytes form one unit (a character or one consumed error)
  const K_CUSTOM = 2; // like K_INDEP but the lead's output differs from its EOF decoding
  const K_EXT = 3; // possible 3/4-byte form: resolve on a small window at decode time

  // Big5: the WHATWG encoder takes the *last* pointer for these code points.
  const BIG5_LAST_POINTER = new Set([0x2550, 0x255e, 0x2561, 0x256a, 0x5341, 0x5345]);

  // Reverse-table preferences that mimic the WHATWG encoders (deferred rows are only used
  // when a character exists nowhere else, so every decodable character still round-trips).
  const REVERSE_POLICY = {
    shift_jis: { defer: (l) => l === 0xed || l === 0xee }, // NEC-selected IBM extensions
    big5: { defer: (l) => l < 0xa1, lastWins: (cp) => BIG5_LAST_POINTER.has(cp) }, // HKSCS rows
  };

  function makeMultiByteCodec(info) {
    const decodeStr = freshDecode(info.whatwg);

    // 1) Every byte decoded on its own (what a lead byte yields when cut off by EOF).
    const singleChunks = [];
    for (let b = 0; b < 256; b++) singleChunks.push([b]);
    const single = probeBatch(decodeStr, singleChunks);

    // 2) Every (lead, next) pair for lead >= 0x80, classified by hypothesis matching.
    //    One batch per lead row, so a decoder quirk triggered in one row cannot leak into others.
    const kind = new Array(256).fill(null);
    const out = new Array(256).fill(null);
    const singleCps = single.map((s) => Array.from(s));
    for (let l = 0x80; l < 0x100; l++) {
      const rowChunks = [];
      for (let t = 0; t < 256; t++) rowChunks.push([l, t]);
      const rowRes = probeBatch(decodeStr, rowChunks);
      const kRow = new Uint8Array(256);
      const oRow = new Array(256).fill(null);
      let isLead = false;
      for (let t = 0; t < 256; t++) {
        const rStr = rowRes[t];
        if (isSingleCp(rStr)) {
          // Fast path for the common case: one code point for two bytes is always a unit.
          kRow[t] = K_PAIR;
          oRow[t] = rStr;
          isLead = true;
          continue;
        }
        const R = Array.from(rStr);
        const St = singleCps[t];
        if (R.length === St.length + 1 && endsWithArr(R, St)) {
          // Hypothesis "consume 1": the lead stands alone and the next byte is re-read.
          if (R[0] !== single[l]) {
            kRow[t] = K_CUSTOM;
            oRow[t] = R[0];
            isLead = true;
          }
        } else {
          kRow[t] = K_PAIR; // hypothesis "consume 2"
          oRow[t] = R.join('');
          isLead = true;
        }
      }
      if (isLead) {
        kind[l] = kRow;
        out[l] = oRow;
      }
    }

    // 3) Longer forms. Detected by behaviour rather than by encoding name.
    const isOneChar = (s) => isSingleCp(s) && s !== FFFD;
    const inA1FE = (x) => x >= 0xa1 && x <= 0xfe;
    let extLen = 0;
    const j0212 = new Map(); // (t << 8 | u) -> character of the three-byte form 8F t u
    let sticky0212 = false;
    if (isOneChar(decodeStr([0x8f, 0xa2, 0xaf]))) {
      extLen = 3; // EUC-JP: 0x8F + two bytes (JIS X 0212)
      if (!kind[0x8f]) {
        kind[0x8f] = new Uint8Array(256);
        out[0x8f] = new Array(256).fill(null);
      }
      for (let t = 0xa1; t <= 0xfe; t++) kind[0x8f][t] = K_EXT;
      const triples = [];
      for (let t = 0xa1; t <= 0xfe; t++) for (let u = 0xa1; u <= 0xfe; u++) triples.push([0x8f, t, u]);
      const res = probeBatch(decodeStr, triples);
      for (let k = 0; k < triples.length; k++) {
        if (isOneChar(res[k])) j0212.set((triples[k][1] << 8) | triples[k][2], res[k]);
      }
      // Chromium (unlike the WHATWG spec and Firefox) keeps the JIS X 0212 flag when "8F xx" is
      // followed by a bad byte, so the next in-range pair is looked up in JIS X 0212. Emulate
      // that only on platforms observed doing it.
      const spec = FFFD + 'A' + decodeStr([0xb0, 0xa1]);
      const leaky = FFFD + 'A' + decodeStr([0x8f, 0xb0, 0xa1]);
      sticky0212 = spec !== leaky && decodeStr([0x8f, 0xa1, 0x41, 0xb0, 0xa1]) === leaky;
    }
    if (isOneChar(decodeStr([0x81, 0x30, 0x81, 0x30]))) {
      extLen = 4; // GB18030 four-byte sequences (browsers' "gbk" decoder supports them)
      for (let l = 0x81; l <= 0xfe; l++) {
        if (!kind[l]) {
          kind[l] = new Uint8Array(256);
          out[l] = new Array(256).fill(null);
        }
        for (let t = 0x30; t <= 0x39; t++) kind[l][t] = K_EXT;
      }
    }

    const extCache = new Map();

    function decodeInto(bytes, start, end, sink) {
      let i = start;
      let flag0212 = false; // emulated leaked JIS X 0212 flag (sticky0212 platforms only)
      while (i < end) {
        const b = bytes[i];
        const row = kind[b];
        if (row === null || i + 1 >= end) {
          sink.pushOut(single[b], i + 1);
          i++;
          continue;
        }
        const t = bytes[i + 1];
        const k = row[t];
        if (flag0212 && inA1FE(b) && inA1FE(t)) {
          // Only an in-range lookup clears the leaked flag; ASCII and kana in between do not.
          flag0212 = false;
          sink.pushOut(j0212.get((b << 8) | t) || FFFD, i + 2);
          i += 2;
        } else if (k === K_INDEP) {
          sink.pushOut(single[b], i + 1);
          i++;
        } else if (k === K_PAIR) {
          sink.pushOut(out[b][t], i + 2);
          i += 2;
        } else if (k === K_CUSTOM) {
          sink.pushOut(out[b][t], i + 1);
          i++;
        } else {
          const r = resolveExt(bytes, i, end);
          if (sticky0212) {
            // "8F t" set the flag; it survives an error unless the third byte completed a lookup.
            flag0212 = r.out === FFFD && r.len >= 2 && !(r.len === 3 && inA1FE(bytes[i + 2]));
          }
          sink.pushOut(r.out, i + r.len);
          i += r.len;
        }
      }
    }

    function decodeCps(win, from) {
      const sink = new Sink();
      sink.pos = from;
      decodeInto(win, from, win.length, sink);
      return sink.segs.map((s) => s.ch);
    }

    /**
     * Resolves a possible 3/4-byte form starting at i. The platform decoder's output R for the
     * window is matched against "consume j bytes, emit one code point, then decode the rest
     * normally" for j = window length down to 1. Decisions of these decoders never look further
     * than the window, so the answer is exact and cacheable.
     */
    function resolveExt(bytes, i, end) {
      const len = Math.min(extLen, end - i);
      let key = len;
      for (let k = 0; k < len; k++) key = key * 256 + bytes[i + k];
      let hit = extCache.get(key);
      if (hit) return hit;
      const win = bytes.slice(i, i + len);
      const R = Array.from(decodeStr(win));
      for (let j = len; j >= 1 && !hit; j--) {
        const rest = j < len ? decodeCps(win, j) : [];
        if (R.length === rest.length + 1 && endsWithArr(R, rest)) hit = { len: j, out: R[0] };
      }
      if (!hit) hit = { len, out: R.join('') || FFFD }; // never observed; keeps partition intact
      if (extCache.size > 20000) extCache.clear();
      extCache.set(key, hit);
      return hit;
    }

    // 4) Reverse table: single bytes first, then pairs in pointer order (lowest pointer wins),
    //    then deferred rows, then three-byte forms.
    const rev = new Map();
    const policy = REVERSE_POLICY[info.id] || {};
    const add = (cp, code) => {
      if (!rev.has(cp)) rev.set(cp, code);
    };
    for (let b = 0; b < 256; b++) {
      if (kind[b] === null && isOneChar(single[b])) add(single[b].codePointAt(0), 0x1000000 | b);
    }
    const deferred = [];
    for (let l = 0x80; l < 0x100; l++) {
      if (!kind[l]) continue;
      for (let t = 0; t < 256; t++) {
        if (kind[l][t] !== K_PAIR || !isOneChar(out[l][t])) continue;
        const cp = out[l][t].codePointAt(0);
        const code = 0x2000000 | (l << 8) | t;
        if (policy.defer && policy.defer(l, t)) deferred.push([cp, code]);
        else if (policy.lastWins && policy.lastWins(cp)) rev.set(cp, code);
        else add(cp, code);
      }
    }
    // Deferred rows that duplicate a character of the main table (Shift_JIS NEC-selected IBM
    // extensions ED/EE vs IBM extensions FA/FB): the decoder reads both, the encoder writes
    // one. altRev keeps the other form for callers that must reproduce the bytes a decoder saw.
    const altRev = new Map();
    for (const [cp, code] of deferred) {
      if (rev.has(cp) && rev.get(cp) !== code) {
        if (!altRev.has(cp)) altRev.set(cp, code);
      } else add(cp, code);
    }
    for (const [tu, ch] of j0212) add(ch.codePointAt(0), 0x3000000 | (0x8f << 16) | tu); // ascending pointer order

    return {
      decodeInto,
      altCount: altRev.size,
      encodeCp(cp, outBuf, n, alt) {
        const code = (alt && altRev.get(cp)) || rev.get(cp);
        if (code === undefined) return -1;
        const len = code >>> 24;
        if (len === 3) outBuf[n++] = (code >> 16) & 0xff;
        if (len >= 2) outBuf[n++] = (code >> 8) & 0xff;
        outBuf[n++] = code & 0xff;
        return n;
      },
      entries() {
        return Array.from(rev, ([cp, code]) => {
          const len = code >>> 24;
          const bytes = [];
          for (let k = len - 1; k >= 0; k--) bytes.push((code >> (8 * k)) & 0xff);
          return [String.fromCodePoint(cp), bytes];
        });
      },
      extLen,
    };
  }

  // ---------------------------------------------------------------------------
  // Registry objects, lazy codec construction
  // ---------------------------------------------------------------------------

  /**
   * Bytes that this decoder turns into C1 controls (U+0080–U+009F) or leaves undefined.
   * Such characters are routinely lost on copy/paste, which is why the repair decoder
   * considers them as "swallowed bytes". Multi-byte decoders only report C1 results.
   */
  function deriveInvisible(id, type, whatwg) {
    if (id === 'iso-8859-1') return Array.from({ length: 32 }, (_, k) => 0x80 + k);
    if (type !== 'single' && type !== 'double') return [];
    let singles;
    if (id === 'cp437') singles = singleByteTable('cp437', null);
    else {
      const td = makeDecoder(whatwg);
      if (!td) return [];
      const chunks = [];
      for (let b = 0; b < 256; b++) chunks.push([b]);
      singles = type === 'single' ? singleByteTable(id, td) : probeBatch(freshDecode(whatwg), chunks);
    }
    const res = [];
    for (let b = 0x80; b < 0x100; b++) {
      const s = singles[b];
      const cp = s.codePointAt(0);
      const c1 = isSingleCp(s) && cp >= 0x80 && cp <= 0x9f;
      if (c1 || (type === 'single' && s === FFFD)) res.push(b);
    }
    return res;
  }

  const ENCODINGS = SPECS.map(([id, name, zh, en, type, region, whatwg, since]) => {
    const own = whatwg === null || type === 'utf8' || type === 'utf16';
    const available = whatwg === null ? true : own || makeDecoder(whatwg) !== null;
    const invisible = Object.freeze(available ? deriveInvisible(id, type, whatwg) : []);
    return Object.freeze({ id, name, zh, en, type, region, whatwg, since, invisible, available });
  });
  const BY_ID = new Map(ENCODINGS.map((e) => [e.id, e]));

  const codecCache = new Map();

  function buildCodec(info) {
    if (!info.available) {
      throw new Error(isEn(null) ? `This environment's TextDecoder does not support the ${info.name} encoding`
        : `当前环境的 TextDecoder 不支持 ${info.name} 编码`);
    }
    if (info.type === 'utf8') return utf8Codec;
    if (info.type === 'utf16') return makeUtf16Codec(info.id === 'utf-16le');
    if (info.type === 'single') return makeSingleByteCodec(info);
    return makeMultiByteCodec(info);
  }

  function codecFor(id) {
    let c = codecCache.get(id);
    if (c) return c;
    const info = BY_ID.get(String(id).toLowerCase());
    if (!info) throw new Error(isEn(null) ? `Unknown encoding: ${id}` : `未知编码：${id}`);
    c = codecCache.get(info.id) || buildCodec(info);
    codecCache.set(info.id, c);
    codecCache.set(id, c);
    return c;
  }

  // ---------------------------------------------------------------------------
  // Public encode / decode
  // ---------------------------------------------------------------------------

  /**
   * opts.gapChars: characters that become zero-width insertion points (gaps).
   * opts.preferDecodedBytes: where a decoder reads two byte forms as the same character (the
   * Shift_JIS NEC-selected rows ED/EE besides FA/FB), write the form the encoder otherwise
   * skips; result.altUsed counts such characters. Default output follows the WHATWG encoders.
   */
  function encode(id, text, opts) {
    const codec = codecFor(id);
    text = String(text);
    const gapSet = opts && opts.gapChars ? new Set(Array.from(String(opts.gapChars), (c) => c.codePointAt(0))) : null;
    const alt = !!(opts && opts.preferDecodedBytes && codec.altCount);
    let altUsed = 0;
    // Grown on demand so a failure near the start costs O(failIndex), not O(text).
    let out = new Uint8Array(Math.min(text.length * 3 + 4, 4096));
    let n = 0;
    let ci = 0;
    const segments = [];
    const gaps = [];
    for (let i = 0; i < text.length; ci++) {
      const cp = text.codePointAt(i);
      const w = cp > 0xffff ? 2 : 1;
      const ch = w === 1 ? text[i] : text.slice(i, i + 2);
      if (gapSet !== null && gapSet.has(cp)) {
        gaps.push({ charIndex: ci, byteOffset: n, ch });
        segments.push({ ch, start: n, end: n });
      } else {
        if (n + 4 > out.length) {
          const bigger = new Uint8Array(out.length * 2);
          bigger.set(out);
          out = bigger;
        }
        const m = codec.encodeCp(cp, out, n, alt);
        if (m < 0) return { ok: false, failIndex: ci, failChar: ch };
        if (alt && m - n === 2 && codec.encodeCp(cp, ALT_PROBE, 0) === 2 && (ALT_PROBE[0] !== out[n] || ALT_PROBE[1] !== out[n + 1])) altUsed++;
        segments.push({ ch, start: n, end: m });
        n = m;
      }
      i += w;
    }
    const res = { ok: true, bytes: out.slice(0, n), segments, gaps };
    if (alt) res.altUsed = altUsed;
    return res;
  }

  const ALT_PROBE = new Uint8Array(4);

  function decode(id, bytes) {
    const codec = codecFor(id);
    const u8 = toBytes(bytes);
    const sink = new Sink();
    codec.decodeInto(u8, 0, u8.length, sink);
    return { text: sink.text(), segments: sink.segs, errors: sink.errors };
  }

  function canEncodeChar(id, ch) {
    return encodeChar(id, ch) !== null;
  }

  function encodeChar(id, ch) {
    ch = String(ch);
    if (!ch) return null;
    const cp = ch.codePointAt(0);
    if (ch.length !== (cp > 0xffff ? 2 : 1)) return null; // exactly one code point expected
    const buf = new Uint8Array(4);
    const n = codecFor(id).encodeCp(cp, buf, 0);
    return n < 0 ? null : Array.from(buf.subarray(0, n));
  }

  function hex(bytes, start, end) {
    const u8 = toBytes(bytes);
    const s = start === undefined ? 0 : start;
    const e = end === undefined ? u8.length : end;
    const parts = [];
    for (let i = s; i < e; i++) parts.push((u8[i] < 16 ? '0' : '') + u8[i].toString(16).toUpperCase());
    return parts.join(' ');
  }

  // ---------------------------------------------------------------------------
  // decodeUtf8Repair — UTF-8 decoding of a "damaged relic"
  // ---------------------------------------------------------------------------

  // Used only when neither opts.charScore nor MBX.Scorer is available: a crude prior that
  // prefers letters and common scripts over symbols, controls and private use.
  function defaultCharScore(ch) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfffd) return -20;
    if ((cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13) || (cp >= 0x7f && cp <= 0x9f)) return -18;
    if ((cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000) return -16;
    if ((cp & 0xfffe) === 0xfffe || (cp >= 0xfdd0 && cp <= 0xfdef)) return -20;
    if (cp < 0x80) return /[A-Za-z0-9 ]/.test(ch) ? -3 : -5;
    if (cp >= 0x4e00 && cp <= 0x9fff) return -7;
    if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0xac00 && cp <= 0xd7a3)) return -7;
    if ((cp >= 0xc0 && cp <= 0x24f) || (cp >= 0x370 && cp <= 0x52f)) return -6;
    if ((cp >= 0x2018 && cp <= 0x201d) || cp === 0x2013 || cp === 0x2014 || cp === 0x2026) return -5;
    if ((cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff01 && cp <= 0xff5e)) return -6;
    if (cp >= 0x1f300 && cp <= 0x1faff) return -8;
    return -12;
  }

  function resolveCharScore(fn) {
    let base = typeof fn === 'function' ? fn : null;
    if (!base && MBX.Scorer && typeof MBX.Scorer.charScore === 'function') base = (ch) => MBX.Scorer.charScore(ch);
    if (!base) base = defaultCharScore;
    const memo = new Map();
    return (ch) => {
      let v = memo.get(ch);
      if (v === undefined) {
        try {
          v = Number(base(ch));
        } catch (_) {
          v = NaN;
        }
        if (!Number.isFinite(v)) v = -50;
        memo.set(ch, v);
      }
      return v;
    };
  }

  const MAX_CANDIDATES = 4096;
  const MAX_LISTED = 6;
  const LEAD_RANGES = { 2: [0xc2, 0xdf], 3: [0xe0, 0xef], 4: [0xf0, 0xf4] };

  /**
   * Enumerates every well-formed sequence matching `pattern` (numbers = known bytes, objects
   * {lo, hi} = unknown bytes) and ranks the resulting characters with `score`.
   * Returns { best, score, candidates } or null when nothing fits (or too many options).
   */
  function rankPattern(pattern, score, listed, memo) {
    // Long damaged texts repeat the same gap shapes ("E3, ?, ?") many times: rank each once.
    const key = memo ? pattern.map((p) => (typeof p === 'number' ? p : p.lo + '-' + p.hi)).join(',') : null;
    if (memo && memo.has(key)) return memo.get(key);
    let total = 1;
    for (const p of pattern) if (typeof p !== 'number') total *= p.hi - p.lo + 1;
    if (total > MAX_CANDIDATES) return null;
    const seq = pattern.map((p) => (typeof p === 'number' ? p : p.lo));
    const unknown = [];
    pattern.forEach((p, k) => typeof p !== 'number' && unknown.push(k));
    const found = new Map();
    for (let c = 0; c < total; c++) {
      let rem = c;
      for (const k of unknown) {
        const span = pattern[k].hi - pattern[k].lo + 1;
        seq[k] = pattern[k].lo + (rem % span);
        rem = Math.floor(rem / span);
      }
      const cp = utf8CodePoint(seq);
      if (cp < 0) continue;
      const ch = String.fromCodePoint(cp);
      if (!found.has(ch)) found.set(ch, score(ch));
    }
    const ranked = rankFound(found, listed);
    if (memo) memo.set(key, ranked);
    return ranked;
  }

  /**
   * Map(ch -> score) -> { best, score, candidates (top `listed`, default 6) } | null.
   * Ties go to the lower code point. Keeps a small sorted top list instead of sorting all
   * (up to 4096) candidates.
   */
  function rankFound(found, listed) {
    if (!found.size) return null;
    const k = listed || MAX_LISTED;
    const better = (a, b) => a[1] > b[1] || (a[1] === b[1] && a[0].codePointAt(0) < b[0].codePointAt(0));
    const top = [];
    for (const entry of found) {
      if (top.length === k && !better(entry, top[k - 1])) continue;
      let i = top.length < k ? top.length : k - 1;
      if (top.length < k) top.push(entry);
      else top[i] = entry;
      while (i > 0 && better(top[i], top[i - 1])) {
        const t = top[i];
        top[i] = top[i - 1];
        top[i - 1] = t;
        i--;
      }
    }
    return { best: top[0][0], score: top[0][1], candidates: top.map((r) => r[0]) };
  }

  const CONT = { lo: 0x80, hi: 0xbf };
  const isCont = (b) => b >= 0x80 && b <= 0xbf;

  function decodeUtf8Repair(bytesIn, gapsIn, opts) {
    const bytes = toBytes(bytesIn);
    const o = opts || {};
    const score = resolveCharScore(o.charScore);
    const nbsp = !!o.nbspFromSpace;
    // Candidates listed per repair: 6 by contract; callers that re-rank through further layers
    // (MBX.Engine) may ask for more and trim the list themselves.
    const listed = Math.max(1, Math.min(64, Math.floor(o.maxCandidates) || MAX_LISTED));
    const patternMemo = new Map();
    // Only continuation bytes can vanish from inside a UTF-8 sequence.
    const dropped = Array.from(new Set((o.droppedBytes || []).filter((b) => isCont(b)))).sort((a, b) => a - b);
    const n = bytes.length;
    const gaps = (gapsIn || [])
      .map((g) => (typeof g === 'number' ? { offset: g, ch: FFFD } : { offset: g.byteOffset, ch: g.ch || FFFD }))
      .filter((g) => g.offset >= 0 && g.offset <= n)
      .sort((a, b) => a.offset - b.offset);
    const errScore = Math.min(score(FFFD), -10);

    const sink = new Sink();
    const repairs = [];
    let g = 0;
    const gapAt = (pos) => g < gaps.length && gaps[g].offset === pos;

    const emitRepaired = (ranked, end, from, reason) => {
      const index = sink.segs.length;
      const seg = sink.push(ranked.best, end);
      seg.repaired = true;
      seg.candidates = ranked.candidates;
      repairs.push({ index, from, to: ranked.best, candidates: ranked.candidates, reason });
    };

    /**
     * Fills the gap at gaps[g] (1–2 unknown bytes). `P` holds the bytes of the unfinished
     * sequence before it (empty at a sequence start), whose bytes have not been emitted yet.
     * Returns the byte offset where normal decoding resumes.
     */
    function fillGap(P) {
      const gap = gaps[g];
      const at = gap.offset;
      const limit = g + 1 < gaps.length ? gaps[g + 1].offset : n; // known bytes K end here
      let cK = 0;
      while (at + cK < limit && cK < 4 && isCont(bytes[at + cK])) cK++;
      const K = (count) => Array.from(bytes.subarray(at, at + count));
      const hyps = [];
      const need = P.length ? utf8SeqLen(P[0]) - P.length : 0;
      const lead = (L) => ({ lo: LEAD_RANGES[L][0], hi: LEAD_RANGES[L][1] });
      if (need >= 1) {
        // One unknown byte continues P; the rest of P comes from K.
        if (cK >= need - 1) hyps.push({ g: 1, slots: [[...P, CONT, ...K(need - 1)]], used: need - 1 });
        // Two unknown bytes both continue P.
        if (need >= 2 && cK >= need - 2) hyps.push({ g: 2, slots: [[...P, CONT, CONT, ...K(need - 2)]], used: need - 2 });
        // Two unknown bytes: the last byte of P, then the lead of the next character.
        if (need === 1 && cK >= 1) {
          const m = Math.min(cK, 3);
          hyps.push({ g: 2, slots: [[...P, CONT], [lead(m + 1), ...K(m)]], used: m, split: true });
        }
      } else if (cK >= 1) {
        // The gap is the lead (plus maybe one continuation) of a character whose tail survived.
        const m1 = Math.min(cK, 3);
        hyps.push({ g: 1, slots: [[lead(m1 + 1), ...K(m1)]], used: m1 });
        const m2 = Math.min(cK, 2);
        hyps.push({ g: 2, slots: [[lead(m2 + 2), CONT, ...K(m2)]], used: m2 });
      }
      // A gap with no surviving neighbour bytes (a whole character lost) stays unresolved.

      let best = null;
      for (const h of hyps) {
        const ranked = h.slots.map((s) => rankPattern(s, score, listed, patternMemo));
        if (ranked.some((r) => r === null)) continue;
        const orphans = cK - h.used; // leftover continuation bytes decode as errors
        const total = ranked.reduce((acc, r) => acc + r.score, 0) + orphans * errScore - (h.g === 2 ? 1e-6 : 0);
        if (!best || total > best.total) best = { h, ranked, total };
      }
      g++;
      if (!best) {
        if (P.length) sink.push(FFFD, at, true);
        sink.push(FFFD, at, true);
        return at;
      }
      const { h, ranked } = best;
      if (h.split) {
        emitRepaired(ranked[0], at, gap.ch, 'gap');
        emitRepaired(ranked[1], at + h.used, gap.ch, 'gap');
      } else {
        emitRepaired(ranked[0], at + h.used, gap.ch, 'gap');
      }
      return at + h.used;
    }

    /** Re-inserts swallowed continuation bytes into the unfinished sequence P. */
    function fillDropped(P) {
      const L = utf8SeqLen(P[0]);
      const missing = L - P.length;
      const slots = L - 1; // continuation positions
      const found = new Map();
      // Every way to choose which continuation positions were lost, values from `dropped`.
      const combos = Math.pow(dropped.length, missing);
      const masks = [];
      for (let mask = 0; mask < 1 << slots; mask++) {
        let bits = 0;
        for (let k = 0; k < slots; k++) if (mask & (1 << k)) bits++;
        if (bits === missing) masks.push(mask);
      }
      if (combos * masks.length > MAX_CANDIDATES) return null;
      for (const mask of masks) {
        for (let c = 0; c < combos; c++) {
          const seq = [P[0]];
          let rem = c;
          let known = 1;
          for (let k = 0; k < slots; k++) {
            if (mask & (1 << k)) {
              seq.push(dropped[rem % dropped.length]);
              rem = Math.floor(rem / dropped.length);
            } else seq.push(P[known++]);
          }
          const cp = utf8CodePoint(seq);
          if (cp < 0) continue;
          const ch = String.fromCodePoint(cp);
          if (!found.has(ch)) found.set(ch, score(ch));
        }
      }
      return rankFound(found, listed);
    }

    let i = 0;
    if (hasUtf8Bom(bytes, n) && !(gaps.length && gaps[0].offset < 3)) i = 3; // like TextDecoder

    for (;;) {
      if (gapAt(i)) {
        i = fillGap([]);
        continue;
      }
      if (i >= n) break;
      const b = bytes[i];
      if (b < 0x80) {
        sink.push(String.fromCharCode(b), i + 1);
        i++;
        continue;
      }
      const L = utf8SeqLen(b);
      if (!L) {
        sink.push(FFFD, i + 1, true);
        i++;
        continue;
      }
      // Collect continuation bytes; a space where one is expected may be a degraded NBSP.
      const P = [b];
      let j = i + 1;
      let firstNbsp = -1;
      while (P.length < L && j < n && !gapAt(j)) {
        let c = bytes[j];
        const okAt = (v) => (P.length === 1 ? secondByteOk(b, v) : isCont(v));
        if (c === 0x20 && nbsp && okAt(0xa0)) {
          c = 0xa0;
          if (firstNbsp < 0) firstNbsp = j;
        }
        if (!okAt(c)) break;
        P.push(c);
        j++;
      }
      if (P.length === L) {
        const ch = String.fromCodePoint(utf8CodePoint(P));
        if (firstNbsp >= 0) emitRepaired({ best: ch, candidates: [ch] }, j, ' ', 'nbsp');
        else sink.push(ch, j);
        i = j;
        continue;
      }
      if (gapAt(j)) {
        i = fillGap(P);
        continue;
      }
      if (dropped.length && (j >= n || !isCont(bytes[j]))) {
        const ranked = fillDropped(P);
        if (ranked) {
          emitRepaired(ranked, j, '', 'dropped');
          i = j;
          continue;
        }
      }
      // Unrepairable: maximal-subpart error. A space we tentatively read as NBSP is given back.
      const stop = firstNbsp >= 0 ? firstNbsp : j;
      sink.push(FFFD, stop, true);
      i = stop;
    }
    return { text: sink.text(), segments: sink.segs, repairs, errors: sink.errors };
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------

  const Codecs = {
    ENCODINGS,
    REPLACEMENT: FFFD,
    get(id) {
      return id == null ? undefined : BY_ID.get(String(id).toLowerCase());
    },
    ids() {
      return ENCODINGS.filter((e) => e.available).map((e) => e.id);
    },
    /** Localized short description of an encoding (EncodingInfo.zh / .en); undefined if unknown. */
    describe(id, locale) {
      const info = id == null ? undefined : BY_ID.get(String(id).toLowerCase());
      if (!info) return undefined;
      return isEn(locale) ? info.en : info.zh;
    },
    canEncodeChar,
    encodeChar,
    encode,
    decode,
    decodeUtf8Repair,
    hex,
    /**
     * Every character the encoder can produce, with its bytes: [[ch, number[]], ...].
     * Single-byte and double-byte encodings only (null for UTF-8/UTF-16). Used by tests
     * and by the forge UI to sample encodable characters.
     */
    tableEntries(id) {
      const c = codecFor(id);
      return typeof c.entries === 'function' ? c.entries() : null;
    },
    // Test hook: a codec for an arbitrary TextDecoder label of the double-byte family
    // (e.g. 'gb18030' to exercise the four-byte path in Node). Not used by the app.
    _createMultiByteCodec(label) {
      const codec = makeMultiByteCodec({ id: label, whatwg: label });
      return {
        decode(bytes) {
          const u8 = toBytes(bytes);
          const sink = new Sink();
          codec.decodeInto(u8, 0, u8.length, sink);
          return { text: sink.text(), segments: sink.segs, errors: sink.errors };
        },
        extLen: codec.extLen,
      };
    },
  };

  MBX.Codecs = Codecs;
  if (typeof module === 'object' && module.exports) module.exports = Codecs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
