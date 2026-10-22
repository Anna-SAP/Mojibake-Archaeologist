/*
 * 乱码考古学家 · Mojibake Archaeologist — UI controller (src/app.js)
 *
 * Binds the page in index.html to the MBX.* modules described in docs/ARCHITECTURE.md.
 * Every dependency is looked up at call time (never at load time) because the modules are
 * plain classic scripts that may be missing or broken; the UI degrades with a notice instead
 * of crashing.
 *
 * Interface language (docs/ARCHITECTURE.md §11): every visible string comes from the MBX.I18n
 * dictionaries through tr(); the pure helpers take an optional trailing `locale` (or
 * opts.locale) and otherwise use the current I18n locale, read at call time.
 *
 * Layout of this file:
 *   1. Pure helpers (no DOM)  — exported as MBX.App.util so Node can test them.
 *   2. DOM controller         — only runs when a document exists.
 */
(function (root) {
  'use strict';
  const MBX = (root.MBX = root.MBX || {});

  // ===========================================================================
  // 1. Pure helpers
  // ===========================================================================

  const mod = (name) => (root.MBX && root.MBX[name]) || null;

  // ---------- interface language ----------

  function normLocale(tag) {
    const I18n = mod('I18n');
    if (I18n && typeof I18n.normalize === 'function') return I18n.normalize(tag);
    const s = typeof tag === 'string' ? tag.trim() : '';
    if (/^zh(?:[-_]|$)/i.test(s)) return 'zh-CN';
    if (/^en(?:[-_]|$)/i.test(s)) return 'en-US';
    return null;
  }

  // An explicit locale wins; otherwise the current I18n locale; zh-CN when i18n.js is absent.
  function currentLocale(locale) {
    const given = locale == null ? null : normLocale(locale);
    if (given) return given;
    const I18n = mod('I18n');
    try {
      if (I18n && typeof I18n.getLocale === 'function') return normLocale(I18n.getLocale()) || 'zh-CN';
    } catch (_) { /* fall through */ }
    return 'zh-CN';
  }

  /*
   * UI dictionary lookup (src/i18n.js). Without i18n.js there is no dictionary: the Chinese tables
   * this file still carries answer for the verdict and escape-scheme names (the language is zh-CN
   * then, docs §11.2), and any other key comes back as itself.
   */
  function tr(key, params, locale) {
    const I18n = mod('I18n');
    if (!I18n || typeof I18n.t !== 'function') return builtinZh(key);
    return I18n.t(key, params, locale == null ? undefined : currentLocale(locale));
  }

  function builtinZh(key) {
    const m = /^status\.(\w+)\.(label|headline|desc)$/.exec(key) || /^scheme\.(.+)$/.exec(key);
    if (!m) return key;
    if (m[2]) {
      const table = m[1] === 'partialClean' ? PARTIAL_CLEAN_COPY : has(STATUS_COPY, m[1]) ? STATUS_COPY[m[1]] : null;
      return table ? table[m[2]] : key;
    }
    return has(SCHEME_NAMES, m[1]) ? SCHEME_NAMES[m[1]] : key;
  }

  const isEnglish = (locale) => currentLocale(locale) === 'en-US';

  const STATUSES = ['restored', 'clean', 'irrecoverable', 'partial', 'unknown'];

  // Chinese tables kept as exports for compatibility; the UI reads src/i18n.js (same zh text).
  const STATUS_COPY = {
    restored: {
      label: '已复原',
      headline: '鉴定完成：文物修复成功',
      desc: '我们在字节地层里找到了一条可信的误读链路，原文已经擦拭干净、重新上架。',
    },
    clean: {
      label: '原装真品',
      headline: '这不是乱码，是一件完好的文字',
      desc: '它的每个字节都待在正确的位置上——没有误读，也就没有考古价值，但它很健康。',
    },
    irrecoverable: {
      label: '不可逆损毁',
      headline: '信息已经永久遗失',
      desc: '在流转途中，原始字节被替换成了 � 或 ? 之类的占位符。字节一旦被抹去，任何考古学家都无力回天——我们只能为它立一块碑。',
    },
    partial: {
      label: '部分修复',
      headline: '只救回了一部分残片',
      desc: '有些片段可以可靠还原，另一些已经损毁或无法确认。下面是尽力拼合后的样子。',
    },
    unknown: {
      label: '未解之谜',
      headline: '像是乱码，但线索不足',
      desc: '我们没有找到足够可信的误读链路。它也许经历了更曲折的旅程，也许它本来就长这样。',
    },
  };

  // A "partial" verdict whose garbled part came back whole: only the clean text around it was
  // left as is, so "只救回了一部分残片" would undersell it.
  const PARTIAL_CLEAN_COPY = {
    label: '局部修复',
    headline: '乱码片段已修复，其余文字原样保留',
    desc: '这段文字里只有一部分是乱码：能确认的片段已经还原，正常的文字保持不动。',
  };

  // Below this confidence a visitor-adopted reading is still a guess, not a restoration.
  const PROMOTE_RESTORED_MIN = 0.3;
  // Share links longer than this fill the box but wait for a click (Engine.analyze is synchronous).
  const HASH_AUTORUN_MAX = 20000;
  // The address bar only mirrors inputs up to this length.
  const HASH_WRITE_MAX = 2000;
  const FFFD = '�';

  // Canonical scheme names (docs/ARCHITECTURE.md §6) plus a syntax hint for the UI.
  const SCHEME_NAMES = {
    percent: 'URL 百分号编码（%XX）',
    'hex-escape': '\\x 十六进制转义',
    'quoted-printable': 'Quoted-Printable 编码（=XX）',
    'hex-dump': '十六进制字节串',
    'unicode-escape': '\\u Unicode 转义',
    'html-entity': 'HTML 实体（&#…;）',
  };

  const REPAIR_REASONS = ['gap', 'nbsp', 'dropped'];

  // LLMError codes with their own fallback copy (ai.err.<code> in src/i18n.js).
  const AI_ERROR_CODES = ['config', 'auth', 'network', 'cors', 'rate_limit', 'overloaded', 'refusal', 'http', 'aborted', 'bad_response'];

  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  // Status copy in one locale: { label, headline, desc } (status 'partialClean' = PARTIAL_CLEAN_COPY).
  function copyFor(status, locale) {
    const s = status === 'partialClean' ? status : normalizeStatus(status);
    return {
      label: tr(`status.${s}.label`, null, locale),
      headline: tr(`status.${s}.headline`, null, locale),
      desc: tr(`status.${s}.desc`, null, locale),
    };
  }

  // Used only when MBX.Codecs is unavailable, so the forge selects and labels still make sense.
  const FALLBACK_ENCODINGS = [
    ['utf-8', 'UTF-8'], ['gbk', 'GBK / GB18030'], ['big5', 'Big5'], ['shift_jis', 'Shift_JIS'],
    ['euc-jp', 'EUC-JP'], ['euc-kr', 'EUC-KR'], ['windows-1252', 'Windows-1252'], ['iso-8859-1', 'ISO-8859-1'],
    ['windows-1251', 'Windows-1251'], ['koi8-r', 'KOI8-R'], ['macintosh', 'Mac OS Roman'], ['cp437', 'CP437'],
    ['ibm866', 'CP866'], ['windows-1250', 'Windows-1250'], ['windows-1253', 'Windows-1253'],
    ['windows-1254', 'Windows-1254'], ['windows-1255', 'Windows-1255'], ['windows-1256', 'Windows-1256'],
    ['windows-874', 'Windows-874'], ['utf-16le', 'UTF-16LE'], ['utf-16be', 'UTF-16BE'],
  ];
  const FALLBACK_ENC_NAMES = Object.fromEntries(FALLBACK_ENCODINGS.concat([['ascii', 'ASCII']]));

  const FALLBACK_STYLES = [
    { id: 'humor', avatar: '🧑‍🏫' },
    { id: 'academic', avatar: '👩‍🔬' },
    { id: 'snark', avatar: '🦉' },
  ];

  function fallbackStyles(locale) {
    return FALLBACK_STYLES.map((s) => Object.assign({}, s, { name: tr(`style.${s.id}`, null, locale) }));
  }

  // Two relics verified byte-for-byte with TextDecoder when this file was written; shown only if
  // MBX.Forge.GALLERY is missing so the page is never completely empty.
  const FALLBACK_GALLERY = [
    { id: 'fallback-utf8-1252', key: 'fb1', relic: 'å¤§å®¶å¥½', expect: '大家好' },
    { id: 'fallback-gbk-1252', key: 'fb2', relic: 'ÄãºÃ', expect: '你好' },
  ];

  function fallbackGallery(locale) {
    return FALLBACK_GALLERY.map((g) => ({
      id: g.id, relic: g.relic, expect: g.expect,
      title: tr(`gallery.${g.key}.title`, null, locale), blurb: tr(`gallery.${g.key}.blurb`, null, locale),
    }));
  }

  const DEFAULT_PREFS = {
    // lang: 'zh-CN' | 'en-US' — only present once the visitor picked a language.
    style: '',
    animation: true,
    voice: true,
    theme: 'auto',
    ai: false,
    engine: { maxDepth: 3, allowLossy: true, allowEscapes: true, allowPartial: true },
  };

  const BYTES_COLLAPSED = 48;
  const BYTES_EXPANDED = 4096;
  const HISTORY_LIMIT = 20;
  const HISTORY_INPUT_CAP = 10000;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  // Cuts by UTF-16 length but never splits a surrogate pair (emoji, CJK Ext-B).
  function safeSlice(s, n) {
    let cut = Math.max(0, n);
    if (cut > 0 && cut < s.length) {
      const c = s.charCodeAt(cut - 1);
      if (c >= 0xd800 && c <= 0xdbff) cut -= 1;
    }
    return s.slice(0, cut);
  }

  function truncate(value, n) {
    const s = String(value == null ? '' : value);
    return s.length <= n ? s : safeSlice(s, n) + '…';
  }

  function formatPercent(x) {
    const v = Number(x);
    return `${Math.round(clamp(Number.isFinite(v) ? v : 0, 0, 1) * 100)}%`;
  }

  function formatScore(x) {
    const v = Number(x);
    return Number.isFinite(v) ? v.toFixed(1) : '—';
  }

  function normalizeStatus(s) {
    return STATUSES.includes(s) ? s : 'unknown';
  }

  function hexByte(b) {
    return (b & 0xff).toString(16).toUpperCase().padStart(2, '0');
  }

  function toBytes(b) {
    if (!b) return null;
    if (b instanceof Uint8Array) return b;
    if (Array.isArray(b) || ArrayBuffer.isView(b)) return Uint8Array.from(b);
    return null;
  }

  function hexOf(bytes, start, end) {
    const Codecs = mod('Codecs');
    if (Codecs && typeof Codecs.hex === 'function') {
      try {
        const out = Codecs.hex(bytes, start, end);
        if (typeof out === 'string') return out;
      } catch (_) { /* fall through to local formatting */ }
    }
    const parts = [];
    for (let i = start; i < end; i++) parts.push(hexByte(bytes[i]));
    return parts.join(' ');
  }

  function codepointLabel(text) {
    return Array.from(String(text || ''))
      .map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'))
      .join(' ');
  }

  // FNV-1a: tiny, stable hash for exhibit numbers when the narrator is unavailable.
  function hashString(s) {
    let h = 0x811c9dc5;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).toUpperCase().padStart(8, '0');
  }

  // Shared with the narrator: 'MBX-2026-' + (fnv1a(input) & 0xffff) as four uppercase hex digits.
  function fallbackExhibitId(input) {
    return `MBX-2026-${hashString(input).slice(4)}`;
  }

  function encName(id, locale) {
    if (!id) return tr('enc.unknown', null, locale);
    const Codecs = mod('Codecs');
    try {
      const info = Codecs && typeof Codecs.get === 'function' ? Codecs.get(id) : null;
      if (info && info.name) return info.name;
    } catch (_) { /* ignore and use fallback */ }
    return FALLBACK_ENC_NAMES[id] || String(id);
  }

  function schemeName(scheme, locale) {
    if (scheme && has(SCHEME_NAMES, scheme)) return tr(`scheme.${scheme}`, null, locale);
    return scheme ? String(scheme) : tr('scheme.fallback', null, locale);
  }

  /*
   * Invisible or ambiguous characters get a visible stand-in in the byte grid; otherwise a
   * C1 control such as U+0081 (the byte that Windows-1252 cannot show) would be an empty box.
   */
  function displayChar(ch, locale) {
    const s = String(ch == null ? '' : ch);
    if (!s) return { text: '∅', kind: 'ctl', title: tr('char.empty', null, locale) };
    const cp = s.codePointAt(0);
    const u = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
    const title = (key) => tr(key, { u }, locale);
    if (cp === 0x20) return { text: '␠', kind: 'space', title: title('char.space') };
    if (cp === 0xa0) return { text: 'NBSP', kind: 'space', title: title('char.nbsp') };
    if (cp === 0x09) return { text: '⇥', kind: 'space', title: title('char.tab') };
    if (cp === 0x0a) return { text: '↵', kind: 'space', title: title('char.lf') };
    if (cp === 0x0d) return { text: '␍', kind: 'space', title: title('char.cr') };
    if (cp < 0x20 || cp === 0x7f) return { text: hexByte(cp), kind: 'ctl', title: title('char.ctl') };
    if (cp >= 0x80 && cp <= 0x9f) {
      return { text: hexByte(cp), kind: 'ctl', title: title('char.c1') };
    }
    if (cp === 0xad) return { text: 'SHY', kind: 'ctl', title: title('char.shy') };
    if (cp === 0xfeff) return { text: 'BOM', kind: 'ctl', title: title('char.bom') };
    if ((cp >= 0x200b && cp <= 0x200f) || cp === 0x2060) return { text: 'ZW', kind: 'ctl', title: title('char.zw') };
    if (/^\p{M}/u.test(s)) return { text: '◌' + s, kind: 'normal', title: title('char.mark') };
    return { text: s, kind: 'normal', title: u };
  }

  /*
   * Seg contract (shared with the engine, narrator and llm): characters that pass through a layer
   * untouched carry `kept: true` — zero-width when the wrong decoder could not encode them. Real
   * lost markers have error/lost and are never kept. Until every engine build sets the flag, a
   * zero-width seg in a partial transcode step with no error/lost/repaired mark (and not U+FFFD)
   * is treated as kept too.
   */
  function isKeptSeg(seg, partialFallback) {
    if (!seg || seg.error || seg.lost) return false;
    if (seg.kept === true) return true;
    if (!partialFallback || seg.repaired) return false;
    const zeroWidth = !(typeof seg.end === 'number' && seg.end > seg.start);
    return zeroWidth && String(seg.ch == null ? '' : seg.ch) !== FFFD;
  }

  /*
   * Turns Seg[] (one entry per code point, with [start,end) byte ranges) into grid items for the
   * first `shown` bytes. Overlapping ranges are merged so no two blocks fight over a grid cell.
   * In unescape layers, zero-width segments are escape syntax (`%`, `\x`, spaces between hex
   * pairs) and are folded into the next block; in transcode layers they are genuine gaps
   * (lost bytes) and become insertion markers. Zero-width kept characters become one
   * { kept: true } run per insertion point (never a gap), and consecutive gaps at the same
   * insertion point are merged so markers never stack on top of each other.
   */
  function buildRow(segs, shown, total, isUnescape, partial) {
    const items = [];
    if (!Array.isArray(segs)) return items;
    let prefix = '';
    let open = null; // the zero-width run (kept or gap) the next zero-width seg may join
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!seg || typeof seg.start !== 'number') continue;
      const start = seg.start;
      const end = typeof seg.end === 'number' ? Math.max(seg.end, start) : start;
      const ch = seg.ch == null ? '' : String(seg.ch);
      if (end === start) {
        const kept = isKeptSeg(seg, !!partial && !isUnescape);
        if (isUnescape && !kept) {
          if (!/^\s*$/.test(ch)) prefix += ch;
          continue;
        }
        if (start > shown || (start === shown && shown < total)) continue;
        if (open && open.start === start && !!open.kept === kept && !(open.gap && (seg.repaired || open.repaired))) {
          open.text += ch;
          open.error = open.error || !!seg.error;
          continue;
        }
        open = {
          text: ch, start, end: start, span: 0, gap: !kept, atEnd: start >= shown,
          error: !!seg.error, repaired: !!seg.repaired,
          candidates: Array.isArray(seg.candidates) ? seg.candidates.slice(0, 6) : [], segIndex: i,
        };
        if (kept) open.kept = true;
        items.push(open);
        continue;
      }
      open = null;
      if (start >= shown) {
        prefix = '';
        continue;
      }
      const prev = items[items.length - 1];
      if (prev && !prev.gap && !prev.kept && start < prev.end) {
        prev.text += prefix + ch;
        prev.end = Math.max(prev.end, end);
        prev.merged = true;
        prev.error = prev.error || !!seg.error;
        prev.repaired = prev.repaired || !!seg.repaired;
      } else {
        const item = {
          text: prefix + ch, start, end, gap: false, merged: !!prefix,
          error: !!seg.error, repaired: !!seg.repaired,
          candidates: Array.isArray(seg.candidates) ? seg.candidates.slice(0, 6) : [], segIndex: i,
        };
        if (seg.kept === true) item.unchanged = true;
        items.push(item);
      }
      prefix = '';
    }
    for (const it of items) {
      if (it.gap || it.kept) continue;
      const visibleEnd = Math.min(it.end, shown);
      it.span = Math.max(1, visibleEnd - it.start);
      it.clipped = it.end > shown;
    }
    return items;
  }

  function buildGridModel(step, limit) {
    if (!step) return null;
    const bytes = toBytes(step.bytes);
    if (!bytes || !bytes.length) return null;
    const total = bytes.length;
    const shown = Math.min(total, Math.max(1, limit || BYTES_COLLAPSED));
    const isUnescape = step.kind === 'unescape';
    const partial = step.partial === true;
    const hex = [];
    for (let i = 0; i < shown; i++) hex.push(hexByte(bytes[i]));
    return {
      total,
      shown,
      truncated: shown < total,
      bytes,
      hex,
      top: buildRow(step.segmentsBefore, shown, total, isUnescape, partial),
      bottom: buildRow(step.segmentsAfter, shown, total, false, partial),
    };
  }

  /*
   * Splits a grid model into display rows of about `perRow` bytes, cutting only at byte offsets
   * where no character (in either row) spans the cut. Items keep their indices into model.top /
   * model.bottom, so hover, pinning and arrow keys work across rows. Each kept run gets its own
   * auto-width column right before the byte it precedes.
   */
  function chunkGridModel(model, perRow) {
    if (!model || !model.shown) return [];
    const per = Math.max(1, Math.floor(perRow) || 16);
    const shown = model.shown;
    const all = [['top', model.top || []], ['bottom', model.bottom || []]];
    const blocked = new Uint8Array(shown + 1);
    for (const [, items] of all) {
      for (const it of items) {
        if (it.gap || it.kept) continue;
        for (let b = it.start + 1; b < Math.min(it.end, shown); b++) blocked[b] = 1;
      }
    }
    const bounds = [0];
    let s = 0;
    while (s < shown) {
      let e = Math.min(shown, s + per);
      if (e < shown && blocked[e]) {
        let back = e;
        while (back > s && blocked[back]) back--;
        if (back > s) e = back;
        else {
          e = s + per;
          while (e < shown && blocked[e]) e++;
        }
      }
      bounds.push(e);
      s = e;
    }
    const chunks = [];
    for (let c = 0; c + 1 < bounds.length; c++) {
      chunks.push({ start: bounds[c], end: bounds[c + 1], top: [], bottom: [], keptAt: [] });
    }
    const last = chunks.length - 1;
    const chunkFor = (pos) => {
      if (pos >= shown) return last;
      let lo = 0;
      let hi = last;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (chunks[mid].start <= pos) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    for (const [row, items] of all) {
      items.forEach((it, k) => {
        const ch = chunks[chunkFor(it.start)];
        ch[row].push(k);
        if (it.kept && !ch.keptAt.includes(it.start)) ch.keptAt.push(it.start);
      });
    }
    for (const ch of chunks) {
      ch.keptAt.sort((a, b) => a - b);
      ch.bytes = ch.end - ch.start;
      ch.cols = ch.bytes + ch.keptAt.length;
    }
    return chunks;
  }

  // 1-based grid column (after the label column) of byte `pos` inside a chunk.
  function chunkByteColumn(chunk, pos) {
    let before = 0;
    for (const k of chunk.keptAt) if (k <= pos) before++;
    return 2 + (pos - chunk.start) + before;
  }

  function chunkKeptColumn(chunk, pos) {
    let before = 0;
    for (const k of chunk.keptAt) if (k < pos) before++;
    return 2 + (pos - chunk.start) + before;
  }

  // grid-template-columns for one chunk: fixed byte cells, auto-width kept columns.
  function chunkTemplate(chunk) {
    const parts = ['var(--label)'];
    let run = 0;
    const flush = () => {
      if (run === 1) parts.push('var(--cell)');
      else if (run > 1) parts.push(`repeat(${run}, var(--cell))`);
      run = 0;
    };
    let ki = 0;
    for (let b = chunk.start; b <= chunk.end; b++) {
      while (ki < chunk.keptAt.length && chunk.keptAt[ki] === b) {
        flush();
        parts.push('auto');
        ki++;
      }
      if (b < chunk.end) run++;
    }
    flush();
    while (ki < chunk.keptAt.length) { parts.push('auto'); ki++; }
    return parts.join(' ');
  }

  function stepsOf(hyp) {
    return hyp && Array.isArray(hyp.steps) ? hyp.steps.filter(Boolean) : [];
  }

  // Steps are stored surface-first (steps[0] touches the input); history runs the other way.
  function forwardChain(steps) {
    const list = Array.isArray(steps) ? steps : [];
    const nodes = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (!s) continue;
      if (s.kind === 'unescape') {
        nodes.push({ kind: 'escape', from: s.trueEncoding || null, scheme: s.scheme || null, stepIndex: i });
      } else {
        nodes.push({ kind: 'misread', from: s.trueEncoding || null, to: s.wrongDecoder || null, lossy: !!s.lossy, stepIndex: i });
      }
    }
    return nodes;
  }

  function stepTitle(step, locale) {
    if (!step) return '';
    if (step.kind === 'unescape') {
      return step.trueEncoding
        ? tr('step.unescapeAs', { scheme: schemeName(step.scheme, locale), enc: encName(step.trueEncoding, locale) }, locale)
        : schemeName(step.scheme, locale);
    }
    return tr('step.misread', { from: encName(step.trueEncoding, locale), to: encName(step.wrongDecoder, locale) }, locale);
  }

  function chainSentence(steps, locale) {
    const nodes = forwardChain(steps);
    if (!nodes.length) return '';
    return nodes.map((n) => (n.kind === 'escape'
      ? tr('chain.escape', { scheme: schemeName(n.scheme, locale) }, locale)
      : tr('step.misread', { from: encName(n.from, locale), to: encName(n.to, locale) }, locale))).join(tr('chain.join', null, locale));
  }

  /*
   * Narration mini-markup: **bold**, `code`, \n. Parsed into tokens and rendered through
   * textContent, which is equivalent to "escape HTML first, then substitute the two marks".
   */
  /*
   * Linear-time scanner (the text may be untrusted AI output, re-parsed on every animation frame
   * while it streams, so a backtracking regex could freeze the tab). Code spans follow CommonMark:
   * a run of k backticks opens a span only if a later run of exactly k backticks closes it;
   * otherwise the run is literal text. `**…**` needs at least one character inside.
   */
  function parseInline(text) {
    const tokens = [];
    const s = String(text == null ? '' : text);
    const n = s.length;
    // Every maximal backtick run, grouped by length, so "next run of exactly k" is a pointer walk.
    const runsByLen = new Map();
    for (let i = 0; i < n;) {
      if (s.charCodeAt(i) !== 96) { i++; continue; }
      let j = i + 1;
      while (j < n && s.charCodeAt(j) === 96) j++;
      const len = j - i;
      if (!runsByLen.has(len)) runsByLen.set(len, { pos: [], ptr: 0 });
      runsByLen.get(len).pos.push(i);
      i = j;
    }
    const nextRun = (len, from) => {
      const r = runsByLen.get(len);
      if (!r) return -1;
      while (r.ptr < r.pos.length && r.pos[r.ptr] < from) r.ptr++;
      return r.ptr < r.pos.length ? r.pos[r.ptr] : -1;
    };
    let noBoldFrom = Infinity; // indexOf('**', p) is -1 for every p >= this
    let last = 0;
    let i = 0;
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 96) {
        let j = i + 1;
        while (j < n && s.charCodeAt(j) === 96) j++;
        const len = j - i;
        const close = nextRun(len, j);
        if (close < 0) { i = j; continue; }
        if (i > last) tokens.push({ t: 'text', v: s.slice(last, i) });
        const inner = s.slice(j, close);
        tokens.push({ t: 'code', v: inner.trim() || inner });
        i = close + len;
        last = i;
        continue;
      }
      if (c === 42 && s.charCodeAt(i + 1) === 42) {
        const from = i + 3;
        const close = from >= noBoldFrom ? -1 : s.indexOf('**', from);
        if (close < 0) {
          noBoldFrom = Math.min(noBoldFrom, from);
          i++;
          continue;
        }
        if (i > last) tokens.push({ t: 'text', v: s.slice(last, i) });
        tokens.push({ t: 'strong', v: s.slice(i + 2, close) });
        i = close + 2;
        last = i;
        continue;
      }
      i++;
    }
    if (last < n) tokens.push({ t: 'text', v: s.slice(last) });
    return tokens;
  }

  function parseMini(text) {
    return String(text == null ? '' : text)
      .replace(/\r\n?/g, '\n')
      .split(/\n{2,}/)
      .filter((p) => p.trim() !== '')
      .map((p) => p.split('\n').map(parseInline));
  }

  function miniLength(paras) {
    let n = 0;
    for (const para of paras) for (const line of para) for (const tok of line) n += tok.v.length;
    return n;
  }

  function stripMarkup(text) {
    return String(text == null ? '' : text)
      .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
      .replace(/`+([^`]*)`+/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*[-*•]\s+/gm, '· ');
  }

  function narrationPlainText(narration) {
    if (!narration) return '';
    if (typeof narration.plainText === 'string' && narration.plainText.trim()) return narration.plainText;
    const parts = [];
    if (narration.title) parts.push(narration.title);
    for (const sec of narration.sections || []) {
      if (sec.heading) parts.push(sec.heading);
      if (sec.text) parts.push(stripMarkup(sec.text));
    }
    return parts.join('\n\n');
  }

  /*
   * English pieces are joined with a space and cut at word boundaries. A sentence ends at . ! ? ;
   * followed by a space or the end of a line, so "PHP 5.4" and "s.encode(" stay whole. Every line
   * is spoken, including titles, headings and list items without final punctuation; those get a
   * full stop so the voice pauses instead of running them into the next line.
   */
  const EN_SENTENCE = /(?:[^.!?;\n]|[.!?;]+(?=[^\s.!?;]))+(?:[.!?;]+|$)|\n+/gm;
  const EN_ENDS_SENTENCE = /[.!?;:,…]["'”’)\]]*$/;

  function splitForSpeechEnglish(clean, limit) {
    const sentences = (clean.match(EN_SENTENCE) || [clean])
      .map((piece) => piece.trim())
      .filter(Boolean)
      .map((piece) => (EN_ENDS_SENTENCE.test(piece) ? piece : `${piece}.`));
    const chunks = [];
    let cur = '';
    const cut = (piece) => {
      const head = safeSlice(piece, limit);
      const space = head.lastIndexOf(' ');
      return space > limit / 2 ? head.slice(0, space) : head;
    };
    for (let piece of sentences) {
      piece = piece.trim();
      if (!piece) continue;
      while (piece.length > limit) {
        if (cur) { chunks.push(cur); cur = ''; }
        const head = cut(piece);
        chunks.push(head.trim());
        piece = piece.slice(head.length).trim();
      }
      if (!piece) continue;
      if (cur && (cur + ' ' + piece).length > limit) {
        chunks.push(cur);
        cur = piece;
      } else {
        cur = cur ? `${cur} ${piece}` : piece;
      }
    }
    if (cur) chunks.push(cur);
    return chunks;
  }

  // Splits long text at sentence boundaries; some engines stop speaking after ~15 s per utterance.
  function splitForSpeech(text, max, locale) {
    const limit = max || 160;
    const clean = stripMarkup(text).replace(/[ \t]+/g, ' ').trim();
    if (!clean) return [];
    if (isEnglish(locale)) return splitForSpeechEnglish(clean, limit);
    const sentences = clean.match(/[^。！？!?；;\n]+[。！？!?；;]*|\n+/g) || [clean];
    const chunks = [];
    let cur = '';
    for (let piece of sentences) {
      piece = piece.trim();
      if (!piece) continue;
      while (piece.length > limit) {
        if (cur) { chunks.push(cur); cur = ''; }
        chunks.push(safeSlice(piece, limit));
        piece = piece.slice(safeSlice(piece, limit).length);
      }
      if ((cur + piece).length > limit) {
        if (cur) chunks.push(cur);
        cur = piece;
      } else {
        cur += piece;
      }
    }
    if (cur) chunks.push(cur);
    return chunks;
  }

  function readHashQuery(hash) {
    const h = String(hash || '').replace(/^#/, '');
    if (!h) return null;
    for (const part of h.split('&')) {
      if (part.slice(0, 2) === 'q=') {
        const raw = part.slice(2);
        try {
          return decodeURIComponent(raw);
        } catch (_) {
          return raw;
        }
      }
    }
    return null;
  }

  // Removes the ?lang= parameter: a share link never imposes the sender's interface language.
  function stripLangParam(url) {
    const s = String(url || '');
    const q = s.indexOf('?');
    if (q < 0) return s;
    const hashAt = s.indexOf('#', q);
    const query = s.slice(q + 1, hashAt < 0 ? s.length : hashAt);
    const kept = query.split('&').filter((p) => p && !/^lang(?:=|$)/i.test(p));
    return s.slice(0, q) + (kept.length ? `?${kept.join('&')}` : '') + (hashAt < 0 ? '' : s.slice(hashAt));
  }

  function buildShareUrl(href, input) {
    const base = stripLangParam(String(href || '').split('#')[0]);
    return `${base}#q=${encodeURIComponent(String(input || ''))}`;
  }

  // Opening a share link must never hang the page: very long payloads wait for a click.
  function shouldAutoRunHash(text) {
    return String(text == null ? '' : text).length <= HASH_AUTORUN_MAX;
  }

  /*
   * LLMError messages from llm.js are already complete sentences in the current language, so they
   * are shown as is (trailing full stop and any "已改由馆内模板讲解员解说" / "the built-in docent
   * takes over" clause removed) instead of being wrapped in another sentence. The ai.err.<code>
   * copy is only the fallback for errors without a message.
   */
  function aiErrorCore(msg, english) {
    if (english) {
      return msg
        .replace(/(?:[\s,;:—–-]+|\.\s+)[^.;,—–]*\b(?:built-in|in-house|template)\b[^.;]*\bdocents?\b[^.;]*[.!]*\s*$/i, '')
        .replace(/[\s.!。]+$/, '')
        .replace(/[.。]+\s*(?=[)）])/g, '');
    }
    return msg
      .replace(/[，,；;]?\s*已?改由馆内(?:模板)?讲解员(?:解说|讲解)?[。．.！!]*\s*$/, '')
      .replace(/[\s。．.！!]+$/, '')
      // "（…。）" → "（…）", so the sentence does not end in "。）。".
      .replace(/[。．]+\s*(?=[）)])/g, '');
  }

  function aiErrorMessage(err, locale) {
    const loc = currentLocale(locale);
    const english = loc === 'en-US';
    const suffix = tr('ai.err.suffix', null, loc);
    const msg = err && err.message ? String(err.message).trim() : '';
    if (err && err.name === 'LLMError' && msg) {
      const core = aiErrorCore(msg, english);
      if (core) return tr('ai.err.withCore', { core: truncate(core, 200), suffix }, loc);
    }
    const code = err && err.code;
    const base = tr(AI_ERROR_CODES.includes(code) ? `ai.err.${code}` : 'ai.err.default', null, loc);
    const status = err && err.status ? tr('ai.err.status', { status: err.status }, loc) : '';
    const plain = msg.replace(english ? /[\s.!。]+$/ : /[\s。．.！!]+$/, '');
    const detail = plain && plain !== base ? tr('ai.err.detail', { detail: truncate(plain, 160) }, loc) : '';
    return tr('ai.err.compose', { base, status, detail, suffix }, loc);
  }

  // Failures that will repeat on every dig until the visitor changes something.
  function aiFailureBlocksRetry(err) {
    const code = err && err.code;
    return code === 'network' || code === 'cors' || code === 'auth' || code === 'config';
  }

  function isTruncatedStop(stopReason) {
    return stopReason === 'max_tokens' || stopReason === 'length';
  }

  function mergePrefs(raw) {
    const p = raw && typeof raw === 'object' ? raw : {};
    const e = p.engine && typeof p.engine === 'object' ? p.engine : {};
    const depth = Number(e.maxDepth);
    const lang = normLocale(p.lang);
    const out = {
      style: typeof p.style === 'string' ? p.style : DEFAULT_PREFS.style,
      animation: p.animation !== false,
      voice: p.voice !== false,
      theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : 'auto',
      ai: p.ai === true,
      engine: {
        maxDepth: Number.isInteger(depth) && depth >= 1 && depth <= 4 ? depth : DEFAULT_PREFS.engine.maxDepth,
        allowLossy: e.allowLossy !== false,
        allowEscapes: e.allowEscapes !== false,
        allowPartial: e.allowPartial !== false,
      },
    };
    if (lang) out.lang = lang;
    return out;
  }

  function normalizeResult(r, input) {
    const src = r && typeof r === 'object' ? r : {};
    return Object.assign({}, src, {
      input: typeof src.input === 'string' ? src.input : String(input || ''),
      status: normalizeStatus(src.status),
      best: src.best && typeof src.best === 'object' ? src.best : null,
      alternatives: Array.isArray(src.alternatives) ? src.alternatives.filter((x) => x && typeof x === 'object') : [],
      signatures: Array.isArray(src.signatures) ? src.signatures.filter(Boolean) : [],
      signals: Array.isArray(src.signals) ? src.signals.filter(Boolean) : [],
      stats: src.stats && typeof src.stats === 'object' ? src.stats : {},
    });
  }

  /*
   * The same analysis worded in another language, without searching again: the search is
   * language-independent (docs §11.3), only label / lang.name / signature title+note / signal
   * hint / locale change. Each old text is checked against what the engine would have written,
   * so a result this function cannot reproduce exactly returns null (the caller re-analyzes).
   */
  function relabelResult(result, locale) {
    const Engine = mod('Engine');
    const Scorer = mod('Scorer');
    if (!result || typeof result !== 'object') return null;
    const to = currentLocale(locale);
    const from = result.locale === 'en-US' || result.locale === 'zh-CN' ? result.locale : null;
    if (!from) return null;
    if (from === to) return result;
    if (!Engine || typeof Engine.chainLabel !== 'function' || typeof Engine.signatures !== 'function'
      || !Scorer || typeof Scorer.langName !== 'function' || typeof Scorer.signalHint !== 'function') return null;
    try {
      const fail = () => { throw new Error('relabel'); };
      const sigsFrom = new Map(Engine.signatures(from).map((s) => [s.id, s]));
      const sigsTo = new Map(Engine.signatures(to).map((s) => [s.id, s]));
      const hyp = (x) => {
        if (!x || typeof x !== 'object') return x;
        const steps = Array.isArray(x.steps) ? x.steps : [];
        const partial = [false, true].find((p) => Engine.chainLabel(steps, { partial: p, locale: from }) === x.label);
        if (partial === undefined) fail();
        const out = Object.assign({}, x, { label: Engine.chainLabel(steps, { partial, locale: to }) });
        if (x.lang && typeof x.lang === 'object') {
          if (Scorer.langName(x.lang.lang, from) !== x.lang.name) fail();
          out.lang = Object.assign({}, x.lang, { name: Scorer.langName(x.lang.lang, to) });
        }
        return out;
      };
      const signatures = (result.signatures || []).map((s) => {
        const a = sigsFrom.get(s && s.id);
        const b = sigsTo.get(s && s.id);
        if (!a || !b || a.title !== s.title || a.note !== s.note) fail();
        return Object.assign({}, s, { title: b.title, note: b.note });
      });
      const signals = (result.signals || []).map((s) => {
        if (!s || Scorer.signalHint(s.type, from) !== s.hint) fail();
        return Object.assign({}, s, { hint: Scorer.signalHint(s.type, to) });
      });
      return Object.assign({}, result, {
        best: hyp(result.best),
        alternatives: (result.alternatives || []).map(hyp),
        signatures,
        signals,
        locale: to,
      });
    } catch (_) {
      return null;
    }
  }

  function hypotheses(result) {
    if (!result) return [];
    return [result.best].concat(result.alternatives || []).filter(Boolean);
  }

  /*
   * The view is what the UI and the narrator see. index == null means "the engine's own verdict";
   * any other index promotes hypotheses(result)[index] to `best`, keeping the rest as alternatives.
   */
  function deriveView(result, index) {
    if (!result) return null;
    const list = hypotheses(result);
    const isEngineChoice = index == null || index < 0 || index >= list.length || (result.best && index === 0);
    if (isEngineChoice) return Object.assign({}, result, { promotedFrom: null });
    const chosen = list[index];
    const conf = Number(chosen.confidence) || 0;
    // An adopted low-confidence guess (or any reading of an unsolved relic) stays a mystery.
    const status = result.status === 'partial' || result.status === 'irrecoverable'
      ? result.status
      : (result.status === 'unknown' || conf < PROMOTE_RESTORED_MIN ? 'unknown' : 'restored');
    return Object.assign({}, result, {
      best: chosen,
      alternatives: list.filter((_, i) => i !== index),
      status,
      promotedFrom: index,
    });
  }

  function longestRun(s, ch) {
    let best = 0;
    let cur = 0;
    for (const c of String(s)) {
      cur = c === ch ? cur + 1 : 0;
      if (cur > best) best = cur;
    }
    return best;
  }

  function fenced(text) {
    const s = String(text == null ? '' : text);
    const fence = '`'.repeat(Math.max(3, longestRun(s, '`') + 1));
    return `${fence}text\n${s}\n${fence}`;
  }

  function reportChar(ch) {
    const d = displayChar(ch);
    return d.kind === 'ctl' ? codepointLabel(ch) : ch;
  }

  // Like reportChar, but spaces (U+0020, NBSP, tabs…) also become code-point labels, so a repair
  // such as "space → NBSP" is not printed as two blanks.
  function visibleText(text) {
    const chars = Array.from(String(text == null ? '' : text));
    if (!chars.length) return '';
    let special = false;
    const parts = chars.map((c) => {
      if (displayChar(c).kind === 'normal') return c;
      special = true;
      return codepointLabel(c);
    });
    return parts.join(special && parts.length > 1 ? ' ' : '');
  }

  function bestIsOnlyPlaceholders(best) {
    return !!best && typeof best.output === 'string' && /^[\s�?？]*$/u.test(best.output);
  }

  // The garbled part of a partial verdict came back whole when nothing in the output still looks
  // like mojibake (needs Scorer.mojibakeSignals; without it, stay conservative).
  function looksFullyRepaired(output) {
    const s = String(output == null ? '' : output);
    if (!s.trim() || s.includes(FFFD)) return false;
    const Scorer = mod('Scorer');
    if (!Scorer || typeof Scorer.mojibakeSignals !== 'function') return false;
    try {
      const sig = Scorer.mojibakeSignals(s);
      return Array.isArray(sig) && sig.length === 0;
    } catch (_) {
      return false;
    }
  }

  /*
   * Badge, headline and description for a view. engineBest is the engine's own best hypothesis
   * (state.result.best), used to name the chief verdict when the visitor adopted another one.
   */
  function statusCopy(view, engineBest, locale) {
    const v = view || {};
    const status = normalizeStatus(v.status);
    const best = v.best || null;
    let copy = copyFor(status, locale);
    if (status === 'partial' && best && looksFullyRepaired(best.output)) copy = copyFor('partialClean', locale);
    if (v.promotedFrom != null && best) {
      const chief = engineBest && typeof engineBest.output === 'string'
        ? tr('promoted.chief', { output: truncate(engineBest.output, 40) }, locale)
        : tr('promoted.noChief', null, locale);
      copy = {
        label: copy.label,
        headline: tr('promoted.headline', null, locale),
        desc: tr('promoted.desc', { pct: formatPercent(best.confidence), chief }, locale),
      };
    }
    return copy;
  }

  function detectLangName(text, locale) {
    const Scorer = mod('Scorer');
    try {
      if (Scorer && typeof Scorer.detectLang === 'function') {
        const r = Scorer.detectLang(String(text || ''), { locale: currentLocale(locale) });
        if (r && r.name) return r.name;
      }
    } catch (_) { /* language is a nice-to-have */ }
    return '—';
  }

  // Never guess a language from the mojibake itself: only from a reading, or from clean input.
  function languageFact(view, locale) {
    const v = view || {};
    const best = v.best;
    if (best && typeof best.output === 'string') {
      if (bestIsOnlyPlaceholders(best)) return tr('lang.undetermined', null, locale);
      return langNameOf(v) || detectLangName(best.output, locale);
    }
    return v.status === 'clean' ? detectLangName(v.input, locale) : tr('lang.undetermined', null, locale);
  }

  // Repair.step indexes best.steps (steps[0] surface … steps[n-1] deepest, whose `after` is the
  // final output). Repairs in shallower layers have no position in the final output.
  function repairLine(repair, steps, locale) {
    const r = repair || {};
    const n = Array.isArray(steps) ? steps.length : 0;
    const intermediate = Number.isInteger(r.step) && r.step >= 0 && r.step < n - 1;
    const where = intermediate ? tr('repair.intermediate', { n: r.step + 1 }, locale) : repairPosition(r, locale);
    const from = r.from ? visibleText(r.from) : tr('common.lost', null, locale);
    const to = r.to != null && r.to !== '' ? visibleText(r.to) : tr('common.empty', null, locale);
    const cands = Array.isArray(r.candidates) && r.candidates.length
      ? tr('common.cands', { list: r.candidates.slice(0, 6).map(visibleText).join(tr('common.listSep', null, locale)) }, locale)
      : '';
    const reason = tr(REPAIR_REASONS.includes(r.reason) ? `repair.reason.${r.reason}` : 'repair.reason.fallback', null, locale);
    return tr('repair.line', { where, from, to, reason, cands }, locale);
  }

  /*
   * The report is meant to be pasted elsewhere; AI text is untrusted, so raw HTML is neutralised
   * and links to javascript:/vbscript:/data: URLs lose their link syntax.
   */
  function isDangerousUrl(dest) {
    const cp = (n) => (Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '?');
    const norm = String(dest || '')
      .replace(/&#x([0-9a-f]{1,8});?/gi, (_, x) => cp(parseInt(x, 16)))
      .replace(/&#(\d{1,9});?/g, (_, d) => cp(Number(d)))
      .replace(/&colon;/gi, ':')
      .replace(/&(?:lt|gt|tab|newline|[a-z]+);/gi, '')
      .replace(/[\s\u0000-\u001f\u007f<>'"]/g, '')
      .toLowerCase();
    return /^(?:javascript|vbscript|data):/.test(norm);
  }

  function defangMarkdown(text) {
    return String(text == null ? '' : text)
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\]\(([^)]*)/g, (m, dest) => (isDangerousUrl(dest) ? `] (${dest}` : m))
      .replace(/^([ \t]{0,3}\[[^\]\n]+\]):([ \t]*)(\S+)/gm, (m, label, sp, dest) => (isDangerousUrl(dest) ? `${label} :${sp}${dest}` : m));
  }

  function inlineCode(text, locale) {
    const s = String(text == null ? '' : text).replace(/\r?\n/g, '↵');
    if (!s) return tr('common.empty', null, locale);
    const fence = '`'.repeat(longestRun(s, '`') + 1);
    const pad = s.startsWith('`') || s.endsWith('`') || s.startsWith(' ') ? ' ' : '';
    return `${fence}${pad}${s}${pad}${fence}`;
  }

  // Repair.index is -1 when the engine cannot trace a deeper-layer repair to the final output.
  function repairPosition(r, locale) {
    const i = r ? Number(r.index) : NaN;
    return Number.isInteger(i) && i >= 0 ? tr('repair.position', { n: i + 1 }, locale) : tr('repair.somewhere', null, locale);
  }

  function mdCell(text, locale) {
    return inlineCode(text, locale).replace(/\|/g, '\\|');
  }

  // One row per output character: which garbled characters shared its bytes.
  function charMapRows(step, max) {
    const bytes = toBytes(step && step.bytes);
    const after = step && Array.isArray(step.segmentsAfter) ? step.segmentsAfter : null;
    const before = step && Array.isArray(step.segmentsBefore) ? step.segmentsBefore : [];
    if (!bytes || !after) return [];
    const rows = [];
    const partial = !!(step && step.partial === true && step.kind !== 'unescape');
    for (const seg of after) {
      if (rows.length >= max) break;
      if (!seg || typeof seg.start !== 'number' || !(seg.end > seg.start)) continue;
      // Characters that passed through the layer untouched are not part of the misreading.
      if (seg.kept === true) continue;
      const s = seg.start;
      const e = Math.min(seg.end, bytes.length);
      const shared = before
        .filter((b) => b && typeof b.start === 'number' && !isKeptSeg(b, partial)
          && (b.end > b.start ? b.start < e && b.end > s : b.start > s && b.start < e))
        .map((b) => reportChar(b.ch))
        .join('');
      rows.push({ before: shared, hex: hexOf(bytes, s, e), after: reportChar(seg.ch), repaired: !!seg.repaired });
    }
    return rows;
  }

  function formatDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function langNameOf(view) {
    const lang = view && view.best && view.best.lang;
    if (lang && lang.name) return lang.name;
    return '';
  }

  // opts: { view, engineBest?, exhibitId?, date?, narrationText?, locale? } — the report follows
  // opts.locale (default: the current interface language).
  function buildMarkdownReport(opts) {
    const o = opts || {};
    const loc = currentLocale(o.locale);
    const T = (key, params) => tr(key, params, loc);
    const view = o.view || {};
    const status = normalizeStatus(view.status);
    const copy = statusCopy(view, o.engineBest, loc);
    const best = view.best || null;
    const steps = stepsOf(best);
    const exhibitId = o.exhibitId || fallbackExhibitId(view.input);
    // For an irrecoverable relic, `best` explains how it formed; it is not a rescue.
    const lost = status === 'irrecoverable';
    const lines = [];

    lines.push(T('report.title', { id: exhibitId }), '');
    lines.push(T('report.generated', { date: formatDate(o.date || new Date()) }), '');
    lines.push(T('report.tableHead'), '|---|---|');
    lines.push(T('report.status', { label: copy.label, status, promoted: view.promotedFrom != null ? T('report.promoted') : '' }));
    if (best) {
      lines.push(`| ${T(lost ? 'facts.diagnosis' : 'facts.confidence')} | ${formatPercent(best.confidence)} |`);
      const lang = bestIsOnlyPlaceholders(best) ? '' : langNameOf(view);
      if (lang) lines.push(`| ${T('facts.lang')} | ${lang} |`);
      if (best.label) lines.push(`| ${T('facts.verdict')} | ${String(best.label).replace(/\|/g, '\\|')} |`);
      lines.push(`| ${T('facts.strata')} | ${steps.length} |`);
    }
    lines.push('', T('report.relic'), '', fenced(view.input), '');
    if (best) lines.push(T(lost ? 'report.remains' : 'report.restored'), '', fenced(best.output), '');

    if (steps.length) {
      lines.push(T('report.chain'), '');
      forwardChain(steps).forEach((n, i) => {
        const text = n.kind === 'escape'
          ? (n.from
            ? T('report.chainEscapeFrom', { enc: encName(n.from, loc), scheme: schemeName(n.scheme, loc) })
            : T('report.chainEscapeChars', { scheme: schemeName(n.scheme, loc) }))
          : T('report.chainMisread', { from: encName(n.from, loc), to: encName(n.to, loc), lossy: n.lossy ? T('report.chainLossy') : '' });
        lines.push(`${i + 1}. ${text}`);
      });
      lines.push('', T('report.strata'), '');
      steps.forEach((step, i) => {
        lines.push(T('report.layer', { n: i + 1, title: stepTitle(step, loc) }), '');
        lines.push(T('report.layerInput', { value: inlineCode(truncate(step.before, 200), loc) }));
        const bytes = toBytes(step.bytes);
        if (bytes && bytes.length) {
          const n = Math.min(64, bytes.length);
          lines.push(T('report.layerBytes', {
            n: bytes.length,
            more: bytes.length > n ? T('report.layerBytesMore', { n }) : '',
            hex: inlineCode(hexOf(bytes, 0, n), loc),
          }));
        }
        lines.push(T('report.layerOutput', { value: inlineCode(truncate(step.after, 200), loc) }));
        if (step.lossy) lines.push(T('report.layerLossy'));
        const repairs = Array.isArray(step.repairs) ? step.repairs : [];
        repairs.slice(0, 10).forEach((r) => {
          const rr = r && Number.isInteger(r.step) ? r : Object.assign({}, r, { step: i });
          lines.push(T('report.repair', { line: repairLine(rr, steps, loc) }));
        });
        const rows = charMapRows(step, 16);
        if (rows.length) {
          lines.push('', T('report.mapHead'), '|---|---|---|');
          rows.forEach((r) => lines.push(`| ${mdCell(r.before, loc)} | ${r.hex} | ${mdCell(r.after, loc)}${r.repaired ? T('report.mapRepaired') : ''} |`));
        }
        lines.push('');
      });
    }

    const sigs = Array.isArray(view.signatures) ? view.signatures : [];
    if (sigs.length) {
      lines.push(T('report.sigs'), '');
      sigs.forEach((s) => lines.push(T('report.sig', {
        title: s.title || s.id, match: inlineCode(s.match, loc), note: s.note ? T('report.sigNote', { note: s.note }) : '',
      })));
      lines.push('');
    }

    if (o.narrationText && String(o.narrationText).trim()) {
      lines.push(T('report.narration'), '', defangMarkdown(String(o.narrationText).trim()), '');
    }
    lines.push('---', '', T('report.footer'));
    return lines.join('\n');
  }

  function digLines(input, locale) {
    const T = (key, params) => tr(key, params, locale);
    const s = String(input || '');
    const n = Array.from(s).length;
    const lines = [T('dig.line.topsoil'), T('dig.line.measure', { n })];
    if (/%[0-9A-Fa-f]{2}|\\x[0-9A-Fa-f]{2}|&#x?[0-9A-Fa-f]+;|\\u[0-9A-Fa-f]{4}|=[0-9A-F]{2}/.test(s)) lines.push(T('dig.line.escape'));
    if (/[锟斤拷烫屯]/.test(s)) lines.push(T('dig.line.famous'));
    lines.push(T('dig.line.cp1252'), T('dig.line.gbk'), T('dig.line.sjis'), T('dig.line.koi8'));
    lines.push(T('dig.line.brush'), T('dig.line.dating'), T('dig.line.label'));
    return lines;
  }

  /*
   * Which hypotheses get a full card: the engine's choice plus anything at least
   * max(3%, 5% of the top confidence). The rest are folded away as low-confidence guesses.
   */
  function partitionAlternatives(hyps, engineHasBest) {
    const list = Array.isArray(hyps) ? hyps : [];
    const confs = list.map((x) => {
      const c = Number(x && x.confidence);
      return Number.isFinite(c) ? c : 0;
    });
    const top = engineHasBest && list.length ? confs[0] : Math.max(0, ...confs);
    const threshold = Math.max(0.03, top * 0.05);
    const main = [];
    const more = [];
    list.forEach((_, i) => ((engineHasBest && i === 0) || confs[i] >= threshold ? main : more).push(i));
    if (!main.length && more.length) {
      // Every guess is weak: still show the strongest one as a card rather than an empty list.
      const topIndex = more.reduce((b, i) => (confs[i] > confs[b] ? i : b), more[0]);
      main.push(topIndex);
      more.splice(more.indexOf(topIndex), 1);
    }
    return { main, more, threshold };
  }

  // One entry per distinct hint, with its (deduplicated) matches and how many times it fired.
  function groupSignals(signals, locale) {
    const groups = new Map();
    for (const s of Array.isArray(signals) ? signals : []) {
      if (!s) continue;
      const key = String(s.hint || s.type || tr('signals.default', null, locale));
      if (!groups.has(key)) groups.set(key, { hint: key, matches: [], count: 0 });
      const g = groups.get(key);
      g.count += 1;
      const m = String(s.match == null ? '' : s.match);
      if (m && !g.matches.includes(m)) g.matches.push(m);
    }
    return [...groups.values()];
  }

  function urlHost(url) {
    const s = String(url == null ? '' : url).trim();
    if (!s) return '';
    try {
      return new URL(s).host.toLowerCase();
    } catch (_) {
      return s.toLowerCase();
    }
  }

  function findProvider(providers, id) {
    return (Array.isArray(providers) ? providers : []).find((p) => p && p.id === id) || null;
  }

  function effectiveHost(baseUrl, provider) {
    return urlHost(baseUrl || (provider && provider.defaultBaseUrl) || '');
  }

  /*
   * Settings form after the provider select changes. A key typed for one provider never follows
   * the form to another provider; Base URL / model are replaced only when the visitor had not
   * customised them. `saved` (the stored config) lets the key come back when the visitor returns
   * to the provider and host it was saved for.
   */
  function providerSwitchForm(prevForm, nextProviderId, providers, saved) {
    const prev = prevForm || {};
    const prevId = prev.provider || 'none';
    const nextId = nextProviderId || 'none';
    const out = {
      provider: nextId,
      apiKey: String(prev.apiKey || ''),
      baseUrl: String(prev.baseUrl || ''),
      model: String(prev.model || ''),
      keyCleared: false,
      keyRestored: false,
    };
    if (prevId === nextId) return out;
    const prevP = findProvider(providers, prevId);
    const nextP = findProvider(providers, nextId);
    const urlUntouched = !out.baseUrl || (!!prevP && out.baseUrl === prevP.defaultBaseUrl);
    const modelUntouched = !out.model || (!!prevP && out.model === prevP.defaultModel);
    if (nextP) {
      if (urlUntouched) out.baseUrl = nextP.defaultBaseUrl || '';
      if (modelUntouched) out.model = nextP.defaultModel || '';
    }
    const hadKey = !!out.apiKey.trim();
    out.apiKey = '';
    const s = saved && typeof saved === 'object' ? saved : null;
    if (s && s.apiKey && s.provider === nextId && effectiveHost(out.baseUrl, nextP) === effectiveHost(s.baseUrl, nextP)) {
      out.apiKey = String(s.apiKey);
      out.keyRestored = true;
    }
    out.keyCleared = hadKey && !out.keyRestored;
    return out;
  }

  // True when the key field still holds the saved key but the form now points somewhere else.
  function keyNeedsReentry(form, saved, providers) {
    const f = form || {};
    const s = saved || {};
    const key = String(f.apiKey || '').trim();
    if (!key || !s.apiKey || key !== String(s.apiKey).trim()) return false;
    if ((f.provider || 'none') !== (s.provider || 'none')) return true;
    const p = findProvider(providers, f.provider);
    return effectiveHost(f.baseUrl, p) !== effectiveHost(s.baseUrl, p);
  }

  function relativeTime(ts, now, locale) {
    const diff = Math.max(0, (now || Date.now()) - ts);
    const min = Math.floor(diff / 60000);
    if (min < 1) return tr('time.justNow', null, locale);
    if (min < 60) return tr('time.minutes', { n: min }, locale);
    const hours = Math.floor(min / 60);
    if (hours < 24) return tr('time.hours', { n: hours }, locale);
    const days = Math.floor(hours / 24);
    if (days < 30) return tr('time.days', { n: days }, locale);
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const LANG_ATTR = {
    'zh-Hans': 'zh-Hans', 'zh-Hant': 'zh-Hant', ja: 'ja', ko: 'ko', ru: 'ru', uk: 'uk', el: 'el', he: 'he',
    ar: 'ar', th: 'th', tr: 'tr', pl: 'pl', cs: 'cs', en: 'en', fr: 'fr', de: 'de', es: 'es', pt: 'pt', it: 'it',
  };

  const App = {
    util: {
      escapeHtml, truncate, safeSlice, formatPercent, normalizeStatus, hexByte, toBytes, codepointLabel, hashString,
      fallbackExhibitId, encName, schemeName, displayChar, buildRow, buildGridModel, forwardChain, stepTitle,
      chainSentence, parseInline, parseMini, miniLength, stripMarkup, narrationPlainText, splitForSpeech,
      readHashQuery, buildShareUrl, aiErrorMessage, mergePrefs, normalizeResult, hypotheses, deriveView,
      fenced, inlineCode, charMapRows, buildMarkdownReport, digLines, relativeTime, repairPosition,
      // Additive helpers (UI fix round).
      isKeptSeg, chunkGridModel, chunkByteColumn, chunkKeptColumn, chunkTemplate, shouldAutoRunHash,
      aiFailureBlocksRetry, isTruncatedStop, visibleText, statusCopy, languageFact, detectLangName,
      repairLine, defangMarkdown, partitionAlternatives, groupSignals, providerSwitchForm,
      keyNeedsReentry, urlHost,
      // Additive helpers (i18n, docs/ARCHITECTURE.md §11).
      currentLocale, tr, copyFor, stripLangParam, aiErrorCore, fallbackStyles, fallbackGallery,
      relabelResult,
    },
    STATUS_COPY,
    PARTIAL_CLEAN_COPY,
    SCHEME_NAMES,
  };
  MBX.App = App;
  if (typeof module === 'object' && module.exports) module.exports = App;

  // ===========================================================================
  // 2. DOM controller
  // ===========================================================================

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const MIN_DIG_MS = 700;
  const PREFS_KEY = 'mbx.prefs';
  const HISTORY_KEY = 'mbx.history';

  const els = {};
  const gridCtx = new WeakMap();
  const reducedMotion = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const darkScheme = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };

  const state = {
    prefs: mergePrefs(null),
    style: 'humor',
    seed: 0,
    result: null,
    viewIndex: null,
    view: null,
    narration: null,
    narrMode: 'template', // 'template' | 'ai'
    narrBody: null,
    runToken: 0,
    dig: null,
    expanded: new Set(),
    typer: null,
    // failedKey: provider|baseUrl|model of a config that just failed in a way retrying will not fix.
    ai: { runId: 0, controller: null, text: '', userStopped: false, failedKey: '' },
    aiAuto: true,
    gridPerRow: 16,
    gridBand: 0,
    longHashNoted: false,
    speechId: 0,
    speaking: false,
    galleryExpanded: false,
    forgeLayers: [],
    settingsProvider: 'none',
    keyFromStore: false, // the key field holds the stored key (not typed in this drawer session)
    narrExpanded: false,
    fontsHooked: false,
    lastInput: '',
    toastTimer: 0,
    clearArmed: 0,
    // i18n: what is needed to redraw everything in another language.
    resultOpts: null, // engine options the current result was computed with
    hasError: false, // the results panel shows an analysis error
    lastError: null,
    docentStatus: null, // status line: a string, or a function re-evaluated on a language switch
    forgeStoryKey: null, // dictionary key of the recipe story when no preset is selected
    forgeLast: null, // last forge action, replayed on a language switch
    testMsg: null, // { key, params, cls } of a settings test line written from the dictionary
    testRaw: null, // { ok, cls } when that line quotes llm.js's message (in the test's language)
  };

  // ---------- small DOM utilities ----------

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const key of Object.keys(props)) {
        const v = props[key];
        if (v == null || v === false) continue;
        if (key === 'class') el.className = v;
        else if (key === 'text') el.textContent = v;
        else if (key === 'dataset') Object.assign(el.dataset, v);
        else if (key.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(key.slice(2), v);
        else if (v === true) el.setAttribute(key, '');
        else el.setAttribute(key, String(v));
      }
    }
    appendKids(el, kids);
    return el;
  }

  function appendKids(el, kids) {
    for (const kid of kids) {
      if (kid == null || kid === false) continue;
      if (Array.isArray(kid)) appendKids(el, kid);
      else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
  }

  function renderInline(parent, text) {
    for (const tok of parseInline(text)) {
      if (tok.t === 'text') parent.append(document.createTextNode(tok.v));
      else parent.append(h(tok.t === 'code' ? 'code' : 'strong', null, tok.v));
    }
    return parent;
  }

  // Renders parsed mini-markup, optionally stopping after `limit` characters (typewriter).
  function renderMini(container, paras, limit) {
    container.textContent = '';
    let left = limit == null ? Infinity : limit;
    for (const para of paras) {
      if (left <= 0) break;
      const p = document.createElement('p');
      para.forEach((line, li) => {
        if (left <= 0) return;
        if (li > 0) p.append(document.createElement('br'));
        for (const tok of line) {
          if (left <= 0) break;
          const v = tok.v.length > left ? safeSlice(tok.v, left) : tok.v;
          left -= tok.v.length > left ? left : tok.v.length;
          if (tok.t === 'text') p.append(document.createTextNode(v));
          else p.append(h(tok.t === 'code' ? 'code' : 'strong', null, v));
        }
      });
      container.append(p);
    }
  }

  // Lightweight Markdown for LLM output: ### headings, bullet lists, paragraphs, **bold**, `code`.
  function renderMarkdownLite(container, text) {
    container.textContent = '';
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    let para = null;
    let list = null;
    const flush = () => { para = null; list = null; };
    for (const raw of lines) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { flush(); continue; }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); continue; }
      if ((m = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line))) {
        flush();
        container.append(renderInline(h('h4'), m[1].replace(/\s*#+\s*$/, '')));
        continue;
      }
      if ((m = /^\s*(?:[-*•]|\d+[.)、])\s+(.*)$/.exec(line))) {
        para = null;
        if (!list) { list = h('ul'); container.append(list); }
        list.append(renderInline(h('li'), m[1]));
        continue;
      }
      list = null;
      if (!para) { para = h('p'); container.append(para); } else para.append(document.createElement('br'));
      renderInline(para, line.trim());
    }
  }

  function motionOn() {
    return state.prefs.animation !== false && !reducedMotion.matches;
  }

  function storage() {
    try {
      return window.localStorage || null;
    } catch (_) {
      return null;
    }
  }

  function readJson(key, fallback) {
    try {
      const s = storage();
      const raw = s ? s.getItem(key) : null;
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      const s = storage();
      if (s) s.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function savePrefs() {
    writeJson(PREFS_KEY, state.prefs);
  }

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.hidden = false;
    // Restart the entrance animation for consecutive toasts.
    els.toast.style.animation = 'none';
    void els.toast.offsetWidth;
    els.toast.style.animation = '';
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
  }

  function announce(message) {
    if (!els.srAnnounce) return;
    els.srAnnounce.textContent = '';
    setTimeout(() => { els.srAnnounce.textContent = message; }, 40);
  }

  async function copyText(text) {
    const value = String(text == null ? '' : text);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) { /* fall back to execCommand below */ }
    try {
      const ta = h('textarea', { readonly: true, 'aria-hidden': 'true' });
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.left = '-9999px';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  async function copyWithToast(text, okMessage) {
    const ok = await copyText(text);
    toast(ok ? okMessage : tr('copy.failed'));
  }

  // Docent styles in the current language (Narrator.styles(locale), §11.3). A narrator without
  // it still provides ids/avatars; the names then come from the UI dictionary.
  function stylesList() {
    const Narrator = mod('Narrator');
    const loc = currentLocale();
    let list = [];
    let localized = false;
    if (Narrator && typeof Narrator.styles === 'function') {
      try {
        const out = Narrator.styles(loc);
        if (Array.isArray(out)) {
          list = out.filter((s) => s && s.id);
          localized = true;
        }
      } catch (_) { list = []; }
    }
    if (!list.length && Narrator && Array.isArray(Narrator.STYLES)) {
      list = Narrator.STYLES.filter((s) => s && s.id);
      localized = loc === 'zh-CN';
    }
    if (!list.length) return fallbackStyles(loc);
    if (loc === 'zh-CN') return list;
    // Without its language pack the narrator still answers in Chinese: name the styles from the
    // UI dictionary and drop Chinese taglines.
    const I18n = mod('I18n');
    const han = /\p{Script=Han}/u;
    return list.map((s) => {
      const nameOk = localized && typeof s.name === 'string' && s.name && !han.test(s.name);
      const taglineOk = localized && typeof s.tagline === 'string' && !han.test(s.tagline);
      if (nameOk && (taglineOk || !s.tagline)) return s;
      return Object.assign({}, s, {
        name: nameOk ? s.name : (I18n && I18n.has(`style.${s.id}`, loc) ? tr(`style.${s.id}`, null, loc) : s.name),
        tagline: taglineOk ? s.tagline : undefined,
      });
    });
  }

  function styleInfo(id) {
    const list = stylesList();
    return list.find((s) => s.id === id) || list[0];
  }

  // ---------- boot ----------

  function cacheEls() {
    const ids = [
      'moduleNotice', 'themeToggle', 'openSettings', 'digForm', 'relicInput', 'digShortcut', 'clearInput',
      'copyShare', 'relicCount', 'optDepth', 'optLossy', 'optEscapes', 'optPartial', 'galleryList', 'galleryMore',
      'excavation', 'digRelic', 'digLog', 'skipDig', 'results', 'verdict', 'docent', 'docentExhibit', 'docentAvatar',
      'docentName', 'docentStatus', 'styleSwitch', 'newDocent', 'aiToggleWrap', 'aiToggle', 'skipType', 'stopAi',
      'aiNotice', 'narration', 'speakBtn', 'copyNarration', 'copyReport', 'strataBody', 'altsList', 'signatures',
      'sigList', 'forgeForm', 'forgePreset', 'forgeStory', 'forgeText', 'forgeLayers', 'forgeAddLayer', 'forgeDrop',
      'forgeNbsp', 'forgeError', 'forgeOutputWrap', 'forgeOutput', 'forgeTrace', 'forgeCopy', 'forgeSend',
      'historyList', 'historyEmpty', 'historyClear', 'settingsDialog', 'settingsForm', 'closeSettings', 'setProvider',
      'llmFields', 'setKey', 'toggleKey', 'setRemember', 'setBaseUrl', 'setModel', 'modelList', 'setEffort',
      'testConn', 'testResult', 'setStyle', 'setAnimation', 'setVoice', 'clearKey', 'toast', 'srAnnounce',
      'alternatives', 'altsTitle', 'effortHint', 'galleryTitle', 'strata', 'narrMore', 'langSwitch',
    ];
    for (const id of ids) els[id] = document.getElementById(id);
  }

  function boot() {
    cacheEls();
    state.prefs = mergePrefs(readJson(PREFS_KEY, null));
    try {
      // The <head> script hid the page for a non-default language; translate before revealing it.
      applyLocaleToPage();
      state.style = styleInfo(state.prefs.style).id;
      applyTheme();
      applyMotionClass();
      checkModules();
      setupShortcutHint();
      syncEngineParams();
      renderStyleSwitch();
      updateDocentIdentity(() => tr('docent.status.waiting'));
      renderGallery();
      setupForge();
      renderHistory();
      setupSettings();
      updateAiToggle();
      updateVoiceButton();
      bindEvents();
      bindLocale();
      updateCount();
    } finally {
      document.documentElement.removeAttribute('data-i18n-pending');
    }

    const q = readHashQuery(window.location.hash);
    if (q) openFromHash(q);
  }

  // ---------- interface language (docs/ARCHITECTURE.md §11) ----------

  function localeInfo(loc) {
    const I18n = mod('I18n');
    const list = I18n && Array.isArray(I18n.LOCALES) ? I18n.LOCALES : [];
    return list.find((l) => l && l.id === loc) || { id: loc, htmlLang: loc, speech: loc };
  }

  /*
   * Static text in index.html: data-i18n (textContent), data-i18n-html (markup from the trusted
   * dictionary only, never user data) and data-i18n-attr="attr:key;attr:key".
   */
  function applyStaticText(scope) {
    if (!mod('I18n')) return;
    const base = scope || document;
    for (const el of base.querySelectorAll('[data-i18n]')) el.textContent = tr(el.getAttribute('data-i18n'));
    for (const el of base.querySelectorAll('[data-i18n-html]')) el.innerHTML = tr(el.getAttribute('data-i18n-html'));
    for (const el of base.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of el.getAttribute('data-i18n-attr').split(';')) {
        const i = pair.indexOf(':');
        const attr = i > 0 ? pair.slice(0, i).trim() : '';
        const key = i > 0 ? pair.slice(i + 1).trim() : '';
        if (attr && key) el.setAttribute(attr, tr(key));
      }
    }
  }

  function applyLocaleToPage() {
    const loc = currentLocale();
    document.documentElement.lang = localeInfo(loc).htmlLang || loc;
    if (!mod('I18n')) return;
    applyStaticText();
    document.title = tr('meta.title');
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', tr('meta.description'));
    updateLangSwitch(loc);
  }

  // The masthead switch (els.langSwitch) and its twin in the settings drawer, which is modal.
  function langSwitches() {
    return Array.from(document.querySelectorAll('.lang-switch'));
  }

  function updateLangSwitch(loc) {
    for (const group of langSwitches()) {
      for (const btn of group.querySelectorAll('[data-locale]')) {
        btn.setAttribute('aria-pressed', String(btn.getAttribute('data-locale') === loc));
      }
    }
  }

  function bindLocale() {
    const I18n = mod('I18n');
    for (const group of langSwitches()) {
      // Without i18n.js there is nothing to switch to: hide the control (and its drawer row).
      (group.closest('.lang-pick') || group).hidden = !I18n;
      group.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-locale]') : null;
        if (btn) chooseLocale(btn.getAttribute('data-locale'));
      });
    }
    if (I18n && typeof I18n.onChange === 'function') I18n.onChange(onLocaleChanged);
  }

  // A visitor's explicit choice is remembered (mbx.prefs.lang) and replaces any ?lang= in the URL.
  function chooseLocale(id) {
    const I18n = mod('I18n');
    const loc = normLocale(id);
    if (!I18n || !loc) return;
    state.prefs.lang = loc;
    savePrefs();
    dropLangParam();
    if (loc === currentLocale()) updateLangSwitch(loc);
    else I18n.setLocale(loc);
  }

  function dropLangParam() {
    try {
      const href = window.location.href;
      const next = stripLangParam(href);
      if (next !== href && window.history && typeof window.history.replaceState === 'function') {
        window.history.replaceState(window.history.state, '', next);
      }
    } catch (_) { /* some file:// setups refuse; the saved preference still applies */ }
  }

  // Labels whose text depends on UI state; data-i18n just reset them to their idle wording.
  function syncDynamicLabels() {
    updateThemeButton();
    updateCount();
    setSpeaking(state.speaking);
    updateNarrMore(!els.narrMore.hidden);
    els.toggleKey.textContent = tr(els.setKey.type === 'password' ? 'settings.show' : 'settings.hide');
    els.historyClear.textContent = tr(state.clearArmed ? 'cabinet.clearConfirm' : 'cabinet.clear');
    if (els.altsTitle && state.result) els.altsTitle.textContent = tr(state.result.status === 'unknown' ? 'alts.titleGuesses' : 'alts.title');
    updateDocentIdentity();
  }

  function onLocaleChanged() {
    stopSpeech();
    applyLocaleToPage();
    syncDynamicLabels();
    if (!els.moduleNotice.hidden) checkModules();
    renderStyleSwitch();
    renderGallery();
    relocalizeForge();
    renderHistory();
    if (els.settingsDialog.open) relabelSettings();
    else state.testMsg = state.testRaw = null;
    relocalizeResults();
    announce(tr('lang.switched'));
  }

  /*
   * Rewords the relic on display in the new language. The search is language-independent, so the
   * result is relabeled rather than searched again (Engine.analyze only when that is impossible),
   * and the adopted alternative, style, seed, expanded strata, pinned byte, open disclosures and
   * the expanded docent all stay. An AI narration in progress starts over in the new language; a
   * finished or stopped one is not requested again (every request spends the visitor's quota).
   */
  function relocalizeResults() {
    // A dig in progress analyzes in the new language when it finishes; only its log is reworded.
    if (state.dig && !state.dig.done && !state.dig.cancelled) {
      relabelDigLog(state.dig);
      return;
    }
    if (state.result) {
      const keep = captureViewState();
      const aiWasRunning = !!state.ai.controller;
      state.result = localizedResult(state.result, state.resultOpts);
      state.view = deriveView(state.result, state.viewIndex);
      state.viewIndex = state.view.promotedFrom;
      state.narration = computeNarration(state.view);
      renderResults();
      startNarration({ animate: false, ai: aiWasRunning });
      restoreViewState(keep);
      return;
    }
    if (state.hasError && !els.results.hidden) renderAnalysisError(state.lastError);
    else if (!state.view) updateDocentIdentity(() => tr('docent.status.waiting'));
  }

  // `result` in the current language: relabeled, or analyzed again when it cannot be relabeled.
  function localizedResult(result, opts) {
    const loc = currentLocale();
    if (!result || result.locale === loc) return result;
    const relabeled = relabelResult(result, loc);
    if (relabeled) return relabeled;
    const Engine = mod('Engine');
    try {
      if (Engine && typeof Engine.analyze === 'function') {
        const fresh = Engine.analyze(result.input, Object.assign({}, opts || engineOptions(), { locale: loc }));
        if (fresh) return normalizeResult(fresh, result.input);
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.error('[MBX] Engine.analyze failed while switching language', err);
    }
    return result;
  }

  /*
   * What the visitor opened by hand in the results, which a re-render would reset: <details>
   * (low-confidence guesses, the era's evidence), the pinned byte of each stratum, and the
   * "read the full text" docent.
   */
  function captureViewState() {
    const open = new Set();
    for (const d of els.results.querySelectorAll('details[open]')) if (d.className) open.add(d.className);
    const pins = [];
    for (const grid of els.strataBody.querySelectorAll('.bytegrid')) {
      const ctx = gridCtx.get(grid);
      const el = ctx && ctx.pinned;
      if (!el || pins.some((p) => p.index === ctx.index)) continue;
      const row = el.dataset.row === 'top' ? 'top' : 'bottom';
      const k = (row === 'top' ? ctx.topEls : ctx.bottomEls).indexOf(el);
      if (k >= 0) pins.push({ index: ctx.index, row, k });
    }
    return { open, pins, narrExpanded: !!state.narrExpanded };
  }

  function restoreViewState(keep) {
    if (!keep) return;
    for (const d of els.results.querySelectorAll('details')) if (keep.open.has(d.className)) d.open = true;
    for (const pin of keep.pins) {
      for (const grid of els.strataBody.querySelectorAll('.bytegrid')) {
        const ctx = gridCtx.get(grid);
        if (!ctx || ctx.index !== pin.index) continue;
        const el = (pin.row === 'top' ? ctx.topEls : ctx.bottomEls)[pin.k];
        if (el) {
          activateChar(ctx, el);
          ctx.pinned = el;
        }
        break;
      }
    }
    if (keep.narrExpanded) {
      state.narrExpanded = true;
      setNarrClamp(0);
      updateDocentSticky();
    }
  }

  function openFromHash(q) {
    els.relicInput.value = q;
    updateCount();
    if (shouldAutoRunHash(q)) {
      startExcavation(q, { source: 'hash' });
      return;
    }
    // Engine.analyze is synchronous: a crafted multi-megabyte link must not freeze the tab.
    state.lastInput = q;
    toast(tr('dig.longHash', { n: Array.from(q).length }));
  }

  function checkModules() {
    if (!mod('I18n')) {
      // No dictionary to translate this one: say it in both languages.
      els.moduleNotice.textContent = '界面语言模块（src/i18n.js）未加载，请确认 src 目录完整后刷新页面。 · The interface language module (src/i18n.js) did not load; make sure the src folder is complete and reload the page.';
      els.moduleNotice.hidden = false;
      return;
    }
    const files = { Codecs: 'codecs.js', Scorer: 'scorer.js', Forge: 'forge.js', Engine: 'engine.js', Narrator: 'narrator.js', LLM: 'llm.js' };
    const missing = Object.keys(files).filter((name) => !mod(name));
    if (!missing.length) return;
    const critical = missing.filter((n) => n === 'Engine' || n === 'Codecs');
    const list = missing.map((n) => tr('modules.item', { name: n, file: files[n] })).join(tr('common.listSep'));
    els.moduleNotice.textContent = tr(critical.length ? 'modules.critical' : 'modules.partial', { list });
    els.moduleNotice.hidden = false;
  }

  function setupShortcutHint() {
    const ua = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '';
    if (/Mac|iPhone|iPad|iPod/i.test(ua)) els.digShortcut.textContent = '⌘+Enter';
  }

  function bindEvents() {
    els.digForm.addEventListener('submit', (e) => {
      e.preventDefault();
      startExcavation(els.relicInput.value, { source: 'manual' });
    });
    els.relicInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        startExcavation(els.relicInput.value, { source: 'manual' });
      }
    });
    els.relicInput.addEventListener('input', updateCount);
    els.clearInput.addEventListener('click', () => {
      els.relicInput.value = '';
      updateCount();
      els.relicInput.focus();
    });
    els.copyShare.addEventListener('click', onCopyShare);
    [els.optDepth, els.optLossy, els.optEscapes, els.optPartial].forEach((el) => el.addEventListener('change', onEngineParamChange));
    els.galleryMore.addEventListener('click', () => {
      state.galleryExpanded = !state.galleryExpanded;
      renderGallery();
      // Collapsing removes the cards above the button; bring the section back instead of leaving
      // the (still focused) button far above the viewport.
      if (!state.galleryExpanded && els.galleryTitle) {
        els.galleryTitle.scrollIntoView({ block: 'start', behavior: motionOn() ? 'smooth' : 'auto' });
      }
    });
    els.skipDig.addEventListener('click', skipDig);

    els.themeToggle.addEventListener('click', () => {
      state.prefs.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
      savePrefs();
      applyTheme();
      toast(tr(state.prefs.theme === 'dark' ? 'theme.nowDark' : 'theme.nowLight'));
    });
    if (typeof darkScheme.addEventListener === 'function') darkScheme.addEventListener('change', updateThemeButton);

    els.newDocent.addEventListener('click', () => {
      state.seed = 1 + Math.floor(Math.random() * 0x7ffffffe);
      if (!state.view) return;
      state.narration = computeNarration(state.view);
      startNarration();
      const name = currentDocent().shortName;
      updateDocentIdentity(() => tr('docent.status.newShift', { name }));
    });
    els.styleSwitch.addEventListener('change', (e) => {
      if (e.target && e.target.name === 'docentStyle') setStyle(e.target.value);
    });
    els.aiToggle.addEventListener('change', onAiToggle);
    els.skipType.addEventListener('click', () => {
      if (!state.typer) return;
      state.typer.finish();
      // The button hides itself; keep keyboard focus at the narration it just completed.
      els.narration.tabIndex = -1;
      els.narration.focus({ preventScroll: true });
    });
    els.stopAi.addEventListener('click', () => {
      if (!state.ai.controller) return;
      state.ai.userStopped = true;
      try { state.ai.controller.abort(); } catch (_) { /* ignore */ }
    });
    els.speakBtn.addEventListener('click', () => (state.speaking ? stopSpeech() : speakText(currentNarrationText())));
    els.copyNarration.addEventListener('click', () => copyWithToast(currentNarrationText(), tr('docent.copied')));
    els.narrMore.addEventListener('click', onNarrMore);
    els.copyReport.addEventListener('click', () => copyWithToast(currentReport(), tr('docent.reportCopied')));

    // Byte-grid interactions are delegated so re-rendering a stratum needs no rebinding.
    els.strataBody.addEventListener('mouseover', onGridPointer);
    els.strataBody.addEventListener('mouseout', onGridLeave);
    els.strataBody.addEventListener('focusin', onGridFocus);
    els.strataBody.addEventListener('click', onGridClick);
    els.strataBody.addEventListener('keydown', onGridKeydown);

    els.historyClear.addEventListener('click', onHistoryClear);
    window.addEventListener('hashchange', () => {
      const q = readHashQuery(window.location.hash);
      if (q && q !== state.lastInput) openFromHash(q);
    });
    let resizeTimer = 0;
    const scheduleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(onResize, 150);
    };
    window.addEventListener('resize', scheduleResize);
    // Layout breakpoints can flip without a resize event (device emulation, zoom).
    if (typeof window.matchMedia === 'function') {
      for (const q of ['(max-width: 599px)', '(min-width: 1100px)']) {
        const mq = window.matchMedia(q);
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', scheduleResize);
      }
    }
  }

  function onResize() {
    if (!state.view || els.results.hidden) return;
    // Byte-grid rows hold 16 bytes on wide screens and 8 on narrow ones; rows with kept-text
    // columns are sized from the band's width, so they follow it too.
    const band = els.strataBody.clientWidth;
    const keptRows = !!els.strataBody.querySelector('.bg-kept');
    if (bytesPerRow() !== state.gridPerRow || (keptRows && Math.abs(band - state.gridBand) > 24)) renderStrata();
    fitScrollers(els.results);
    updateDocentSticky();
  }

  function updateCount() {
    const n = Array.from(els.relicInput.value).length;
    els.relicCount.textContent = tr('dig.count', { n });
  }

  async function onCopyShare() {
    const input = els.relicInput.value;
    if (!input.trim()) {
      toast(tr('share.empty'));
      return;
    }
    const url = buildShareUrl(window.location.href, input);
    const ok = await copyText(url);
    if (!ok) toast(tr('share.failed'));
    else if (url.length > 8000) toast(tr('share.long'));
    else toast(tr('share.ok'));
  }

  // ---------- theme & motion ----------

  function effectiveTheme() {
    if (state.prefs.theme === 'light' || state.prefs.theme === 'dark') return state.prefs.theme;
    return darkScheme.matches ? 'dark' : 'light';
  }

  function applyTheme() {
    const t = state.prefs.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    syncThemeColor(t);
    updateThemeButton();
  }

  // Mobile browser chrome follows <meta name="theme-color">; its media queries only know the OS
  // scheme, so an explicit in-app choice overrides them (and 'auto' restores them).
  function syncThemeColor(theme) {
    const colors = { light: '#f4ecda', dark: '#100f0c' };
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      if (meta.dataset.media == null) {
        meta.dataset.media = meta.getAttribute('media') || '';
        meta.dataset.content = meta.getAttribute('content') || '';
      }
      if (theme === 'light' || theme === 'dark') {
        meta.setAttribute('media', 'all');
        meta.setAttribute('content', colors[theme]);
      } else {
        if (meta.dataset.media) meta.setAttribute('media', meta.dataset.media);
        else meta.removeAttribute('media');
        meta.setAttribute('content', meta.dataset.content);
      }
    }
  }

  function updateThemeButton() {
    const label = tr(effectiveTheme() === 'dark' ? 'theme.toLight' : 'theme.toDark');
    els.themeToggle.setAttribute('aria-label', label);
    els.themeToggle.title = label;
  }

  function applyMotionClass() {
    document.documentElement.classList.toggle('no-motion', state.prefs.animation === false);
  }

  // ---------- engine params ----------

  function syncEngineParams() {
    const e = state.prefs.engine;
    els.optDepth.value = String(e.maxDepth);
    els.optLossy.checked = e.allowLossy;
    els.optEscapes.checked = e.allowEscapes;
    els.optPartial.checked = e.allowPartial;
  }

  function onEngineParamChange() {
    state.prefs.engine = {
      maxDepth: Number(els.optDepth.value) || 3,
      allowLossy: els.optLossy.checked,
      allowEscapes: els.optEscapes.checked,
      allowPartial: els.optPartial.checked,
    };
    savePrefs();
  }

  function engineOptions() {
    return Object.assign({}, state.prefs.engine);
  }

  // Content records with optional `en: { … }` texts (§11.3), for modules without a locale accessor.
  function localizeRecords(list, fields, loc) {
    if (loc === 'zh-CN') return list;
    return list.map((it) => {
      const tx = it && it.en && typeof it.en === 'object' ? it.en : null;
      if (!tx) return it;
      const out = Object.assign({}, it);
      for (const f of fields) if (typeof tx[f] === 'string') out[f] = tx[f];
      return out;
    });
  }

  // ---------- gallery ----------

  function galleryItems() {
    const Forge = mod('Forge');
    const loc = currentLocale();
    let list = null;
    if (Forge && typeof Forge.gallery === 'function') {
      try { list = Forge.gallery(loc); } catch (_) { list = null; }
    }
    if (!Array.isArray(list)) list = Forge && Array.isArray(Forge.GALLERY) ? localizeRecords(Forge.GALLERY, ['title', 'blurb'], loc) : null;
    const valid = (list || []).filter((it) => it && typeof it.relic === 'string' && it.relic);
    return valid.length ? valid : fallbackGallery(loc);
  }

  function renderGallery() {
    const items = galleryItems();
    const limit = state.galleryExpanded ? items.length : 6;
    els.galleryList.textContent = '';
    items.slice(0, limit).forEach((it, i) => {
      const card = h('button', {
        type: 'button',
        class: 'relic-card',
        onclick: () => {
          els.relicInput.value = it.relic;
          updateCount();
          startExcavation(it.relic, { source: 'gallery' });
        },
      },
      h('span', { class: 'relic-card__no' }, tr('gallery.no', { no: String(i + 1).padStart(2, '0') })),
      h('span', { class: 'relic-card__title' }, it.title || tr('gallery.untitled')),
      h('code', { class: 'relic-card__relic' }, truncate(it.relic, 80)),
      it.blurb ? h('span', { class: 'relic-card__blurb' }, it.blurb) : null);
      els.galleryList.append(h('li', { class: 'gallery__item' }, card));
    });
    if (items.length > 6) {
      els.galleryMore.hidden = false;
      els.galleryMore.textContent = state.galleryExpanded ? tr('gallery.less') : tr('gallery.all', { n: items.length });
      els.galleryMore.setAttribute('aria-expanded', String(state.galleryExpanded));
    } else {
      els.galleryMore.hidden = true;
    }
    // The full collection gets the whole hall width instead of one long column.
    const grid = els.galleryList.closest('.dig-grid');
    if (grid) grid.classList.toggle('is-gallery-open', state.galleryExpanded && items.length > 6);
  }

  // ---------- excavation ----------

  function cancelRun() {
    const dig = state.dig;
    if (dig) {
      dig.timers.forEach(clearTimeout);
      dig.timers = [];
      dig.cancelled = true;
    }
    hideDigPanel();
    stopTypewriter();
    abortAi();
    stopSpeech();
  }

  function hideDigPanel() {
    if (!els.excavation) return;
    els.excavation.hidden = true;
    // The log is rebuilt by the next dig; old lines would only linger in the old language.
    if (els.digLog) els.digLog.textContent = '';
    els.excavation.classList.remove('is-overlay');
    els.excavation.style.top = '';
    if (els.results) els.results.classList.remove('is-stale');
  }

  function startExcavation(input, options) {
    const source = (options && options.source) || 'manual';
    const text = String(input == null ? '' : input);
    if (!text.trim()) {
      toast(tr('dig.empty'));
      els.relicInput.focus();
      return;
    }
    const Engine = mod('Engine');
    if (!Engine || typeof Engine.analyze !== 'function') {
      toast(tr('dig.noEngine'));
      checkModules();
      return;
    }

    cancelRun();
    updateCount();
    const token = ++state.runToken;
    const animate = motionOn();
    const dig = {
      token, input: text, source, t0: now(), skip: !animate, timers: [], outcome: null, done: false,
      opts: engineOptions(), locale: currentLocale(),
    };
    state.dig = dig;
    state.aiAuto = source !== 'hash';
    state.lastInput = text;

    if (animate) showDigPanel(dig);

    // Give the browser a frame to paint the dig animation before the synchronous search blocks it.
    dig.timers.push(setTimeout(() => {
      if (state.runToken !== token) return;
      let result = null;
      let error = null;
      // The language may have changed since the click: analyze in the one on screen now.
      dig.locale = currentLocale();
      try {
        result = Engine.analyze(text, Object.assign({}, dig.opts, { locale: dig.locale }));
      } catch (err) {
        error = err;
      }
      dig.outcome = { result, error };
      const wait = dig.skip ? 0 : Math.max(0, MIN_DIG_MS - (now() - dig.t0));
      dig.timers.push(setTimeout(() => finishExcavation(token), wait));
    }, animate ? 60 : 0));
  }

  function now() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function showDigPanel(dig) {
    // With results already on screen, the dig panel floats over their top edge (and the stale
    // results dim) instead of being inserted above them and shoving the page down and back.
    const overlay = !els.results.hidden;
    els.excavation.classList.toggle('is-overlay', overlay);
    els.excavation.style.top = overlay ? `${els.results.offsetTop}px` : '';
    els.results.classList.toggle('is-stale', overlay);
    els.excavation.hidden = false;
    els.digRelic.textContent = truncate(dig.input.replace(/\s+/g, ' '), 64);
    els.digLog.textContent = '';
    const lines = digLines(dig.input);
    const step = Math.max(60, Math.floor(MIN_DIG_MS / lines.length));
    lines.forEach((_, i) => {
      dig.timers.push(setTimeout(() => {
        if (state.runToken !== dig.token) return;
        const prev = els.digLog.querySelector('.is-current');
        if (prev) {
          prev.classList.remove('is-current');
          prev.classList.add('is-done');
        }
        // Worded when shown (the visitor may switch language mid-dig; relabelDigLog fixes the rest).
        els.digLog.append(h('li', { class: 'dig-log__line is-current', dataset: { line: String(i) } }, digLines(dig.input)[i]));
        // Keep the log short so it never pushes the layout around.
        while (els.digLog.children.length > 5) els.digLog.firstElementChild.remove();
      }, i * step));
    });
    const rect = els.excavation.getBoundingClientRect();
    if (rect.bottom > window.innerHeight || rect.top < 0) {
      els.excavation.scrollIntoView({ block: 'center', behavior: motionOn() ? 'smooth' : 'auto' });
    }
  }

  // The dig log lines already on screen, reworded in the current language.
  function relabelDigLog(dig) {
    if (!els.digLog || !dig) return;
    const lines = digLines(dig.input);
    for (const li of els.digLog.children) {
      const i = Number(li.dataset && li.dataset.line);
      if (Number.isInteger(i) && lines[i] != null) li.textContent = lines[i];
    }
  }

  function skipDig() {
    const dig = state.dig;
    if (!dig || dig.done) return;
    dig.skip = true;
    if (dig.outcome) finishExcavation(dig.token);
  }

  function finishExcavation(token) {
    const dig = state.dig;
    if (!dig || dig.token !== token || dig.done || !dig.outcome) return;
    dig.done = true;
    dig.timers.forEach(clearTimeout);
    dig.timers = [];
    const hadFocusInInput = document.activeElement === els.relicInput;
    hideDigPanel();

    let { result, error } = dig.outcome;
    if (result && !error && dig.locale !== currentLocale()) {
      // The language changed during the dig animation: word the result in the language on screen.
      const relabeled = relabelResult(result, currentLocale());
      if (relabeled) result = relabeled;
      else {
        const Engine = mod('Engine');
        try {
          result = Engine.analyze(dig.input, Object.assign({}, dig.opts, { locale: currentLocale() }));
        } catch (err) {
          error = err;
          result = null;
        }
      }
    }
    els.results.hidden = false;
    if (error || !result) {
      renderAnalysisError(error);
      revealResults(hadFocusInInput);
      return;
    }

    state.hasError = false;
    state.resultOpts = dig.opts;
    state.result = normalizeResult(result, dig.input);
    state.viewIndex = null;
    state.view = deriveView(state.result, null);
    state.expanded.clear();
    state.narration = computeNarration(state.view);
    renderResults();
    startNarration();
    pushHistory(state.result);
    updateUrlHash(dig.input);
    const copy = statusCopy(state.view, state.result.best);
    const best = state.view.best;
    const lost = state.view.status === 'irrecoverable';
    announce(tr('verdict.announce', {
      label: copy.label,
      detail: best && !lost
        ? tr('verdict.announceDetail', { pct: formatPercent(best.confidence), output: truncate(best.output, 60) })
        : copy.headline,
    }));
    revealResults(hadFocusInInput);
  }

  function revealResults(keepFocus) {
    const head = document.getElementById('verdictTitle');
    if (head && !keepFocus) head.focus({ preventScroll: true });
    els.results.scrollIntoView({ behavior: motionOn() ? 'smooth' : 'auto', block: 'start' });
  }

  function updateUrlHash(input) {
    if (!input || !window.history || typeof window.history.replaceState !== 'function') return;
    try {
      // Opened from a share link that already says exactly this: leave the address bar alone.
      if (readHashQuery(window.location.hash) === input) return;
      if (input.length > HASH_WRITE_MAX) {
        // Too long to mirror, but never leave the previous relic's link behind.
        if (window.location.hash) {
          window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
          if (!state.longHashNoted) {
            state.longHashNoted = true;
            toast(tr('share.tooLongForHash'));
          }
        }
        return;
      }
      // The address bar keeps its own ?lang= (a reload stays in this language); copied share links drop it.
      const base = String(window.location.href).split('#')[0];
      window.history.replaceState(window.history.state, '', `${base}#q=${encodeURIComponent(input)}`);
    } catch (_) { /* some file:// setups refuse; sharing still works via the button */ }
  }

  function renderAnalysisError(error) {
    state.result = null;
    state.view = null;
    state.narration = null;
    state.hasError = true;
    state.lastError = error || null;
    const message = error && error.message ? error.message : tr('error.noResult');
    els.verdict.textContent = '';
    els.verdict.append(
      h('div', { class: 'verdict__top' }, h('span', { class: 'badge badge--irrecoverable' }, tr('error.badge'))),
      h('h2', { class: 'verdict__headline', id: 'verdictTitle', tabindex: '-1' }, tr('error.headline')),
      h('p', { class: 'verdict__desc' }, tr('error.desc', { message: truncate(message, 200) })),
    );
    els.strataBody.textContent = '';
    els.strataBody.append(h('p', { class: 'strata__empty' }, tr('error.noStrata')));
    els.narration.textContent = '';
    els.narration.append(h('p', null, tr('error.docentWaiting')));
    setNarrClamp(0);
    updateNarrMore(false);
    els.docent.classList.remove('is-sticky');
    els.altsList.textContent = '';
    els.altsList.append(h('li', { class: 'alts__empty' }, tr('error.noAlts')));
    const oldMore = els.alternatives.querySelector('.alts__more');
    if (oldMore) oldMore.remove();
    els.alternatives.hidden = false;
    els.signatures.hidden = true;
    announce(tr('error.announce'));
  }

  // ---------- results rendering ----------

  function renderResults() {
    renderVerdict();
    renderStrata();
    renderAlternatives();
    renderSignatures();
    els.docentExhibit.textContent = currentExhibitId();
    afterLayout();
  }

  // Measurements that depend on rendered sizes; web fonts can change them once they arrive.
  function afterLayout() {
    fitScrollers(els.results);
    updateDocentSticky();
    if (!state.fontsHooked && document.fonts && document.fonts.ready) {
      state.fontsHooked = true;
      document.fonts.ready.then(() => {
        if (els.results.hidden) return;
        fitScrollers(els.results);
        updateDocentSticky();
      }).catch(() => {});
    }
  }

  /*
   * Boxes with a max-height only become scrollable (and a deliberate Tab stop) when their text
   * really overflows; otherwise a sub-pixel glyph overflow would show a 15px scrollbar.
   */
  const SCROLLER_SELECTOR = '.restored__text, .stratum__fossil, .stratum__text';

  function fitScrollers(root) {
    const scope = root || document;
    for (const el of scope.querySelectorAll(SCROLLER_SELECTOR)) {
      const long = el.scrollHeight - el.clientHeight > 4;
      el.classList.toggle('is-long', long);
      if (long) {
        el.tabIndex = 0;
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', tr('scroll.label', { label: el.dataset.scrollLabel || tr('scroll.text') }));
      } else {
        el.removeAttribute('tabindex');
        el.removeAttribute('role');
        el.removeAttribute('aria-label');
      }
    }
  }

  const wideLayout = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 1100px)') : { matches: false };
  const NARR_MIN_PX = 448;

  function setNarrClamp(px) {
    const narr = els.narration;
    if (px > 0) {
      narr.style.setProperty('--narr-max', `${Math.round(px)}px`);
      narr.classList.add('is-clamped');
    } else {
      narr.style.removeProperty('--narr-max');
      narr.classList.remove('is-clamped');
    }
  }

  function updateNarrMore(visible) {
    if (!els.narrMore) return;
    els.narrMore.hidden = !visible;
    els.narrMore.textContent = tr(state.narrExpanded ? 'docent.less' : 'docent.more');
    els.narrMore.setAttribute('aria-expanded', String(!!state.narrExpanded));
  }

  /*
   * Desktop two-column hall: a docent shorter than the viewport stays in view (sticky) while the
   * visitor reads the strata; a docent much taller than the left column is capped with a
   * "展开全文" toggle so the left column does not end in a big empty space.
   */
  function updateDocentSticky(userToggle) {
    const docent = els.docent;
    const narr = els.narration;
    if (!docent || !narr) return;
    docent.classList.remove('is-sticky');
    if (els.results.hidden || !wideLayout.matches || !state.view) {
      setNarrClamp(0);
      updateNarrMore(false);
      return;
    }
    const left = [els.verdict, els.strata, document.querySelector('.results__extra')]
      .filter((el) => el && !el.hidden && el.offsetParent !== null);
    const top = els.verdict.getBoundingClientRect().top;
    const leftH = Math.max(0, ...left.map((el) => el.getBoundingClientRect().bottom)) - top;
    const busy = !!state.typer || !!state.ai.controller;
    let chrome = docent.offsetHeight - narr.clientHeight; // the docent panel minus its narration box
    const natural = chrome + narr.scrollHeight;
    const clampedNow = narr.classList.contains('is-clamped');
    let clampTo = 0;
    if (!busy && !state.narrExpanded && natural > leftH + 160) {
      if (els.narrMore && els.narrMore.hidden) {
        // The toggle button is part of the docent's height once it shows.
        updateNarrMore(true);
        chrome = docent.offsetHeight - narr.clientHeight;
      }
      clampTo = Math.max(NARR_MIN_PX, leftH - chrome);
      if (narr.scrollHeight < clampTo + 120) clampTo = 0;
      // Never collapse text the visitor is looking at: only cut below the viewport.
      if (clampTo && !clampedNow && userToggle !== true && narr.getBoundingClientRect().top + clampTo < window.innerHeight) clampTo = 0;
    }
    setNarrClamp(clampTo);
    updateNarrMore(clampTo > 0 || (!!state.narrExpanded && natural > leftH + 160));
    if (docent.offsetHeight + 32 <= window.innerHeight && docent.offsetHeight < leftH - 40) {
      docent.classList.add('is-sticky');
    }
  }

  function onNarrMore() {
    state.narrExpanded = !state.narrExpanded;
    if (state.narrExpanded) setNarrClamp(0);
    updateDocentSticky(true);
    // Collapsing pulls the button up; keep it (and the focus on it) in view.
    if (!state.narrExpanded) els.narrMore.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    els.narrMore.focus({ preventScroll: true });
  }

  function currentExhibitId() {
    return (state.narration && state.narration.exhibitId) || fallbackExhibitId(state.view ? state.view.input : '');
  }

  function renderVerdict() {
    const view = state.view;
    const status = view.status;
    const copy = statusCopy(view, state.result && state.result.best);
    const best = view.best;
    const sec = els.verdict;
    sec.textContent = '';

    // appendKids skips the null blocks (no chain, no repairs…); Element.append would print "null".
    appendKids(sec, [
      h('div', { class: 'verdict__top' },
        h('span', { class: 'plaque' }, currentExhibitId()),
        h('span', { class: `badge badge--${status}` }, copy.label),
        view.promotedFrom != null ? h('span', { class: 'badge badge--promoted' }, tr('verdict.promotedBadge')) : null),
      h('h2', { class: 'verdict__headline', id: 'verdictTitle', tabindex: '-1' }, copy.headline),
      h('p', { class: 'verdict__desc' }, copy.desc),
      renderRestoredFigure(view),
      renderFacts(view),
      renderChainBlock(view),
      renderRepairs(best),
      renderSignals(view.signals),
      renderStats(view),
    ]);
  }

  function langAttrs(view) {
    const code = view.best && view.best.lang && view.best.lang.lang;
    const lang = LANG_ATTR[code];
    if (!lang) return {};
    return { lang, dir: lang === 'ar' || lang === 'he' ? 'auto' : null };
  }

  function renderRestoredFigure(view) {
    const best = view.best;
    let caption;
    let text;
    let relicStyle = false;
    let copyLabel = tr(best ? 'verdict.copyOriginal' : 'verdict.copyText');
    if (best && typeof best.output === 'string' && view.status === 'irrecoverable') {
      // For an irrecoverable relic, best explains how it formed; it is not a rescue.
      caption = tr('verdict.capRemains');
      text = best.output;
      copyLabel = tr('verdict.copyRemains');
    } else if (best && typeof best.output === 'string') {
      caption = tr('verdict.capRestored');
      text = best.output;
    } else if (view.status === 'clean') {
      caption = tr('verdict.capIntact');
      text = view.input;
    } else {
      caption = tr('verdict.capAsFound');
      text = view.input;
      relicStyle = true;
    }
    const attrs = best ? langAttrs(view) : {};
    return h('figure', { class: 'restored' },
      h('figcaption', { class: 'restored__cap' },
        h('span', null, caption),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => copyWithToast(text, tr('copy.done')) }, copyLabel)),
      h('p', Object.assign({
        class: relicStyle ? 'restored__text restored__text--relic' : 'restored__text',
        'data-scroll-label': caption.split(' · ')[0],
      }, attrs), text));
  }

  function gaugeMarkup(pct) {
    // Only numbers are interpolated here, so building SVG from a string is safe.
    const angle = -90 + pct * 1.8;
    const ticks = [0, 25, 50, 75, 100].map((t) => {
      const a = (Math.PI * (180 - t * 1.8)) / 180;
      const x1 = (75 + Math.cos(a) * 67).toFixed(1);
      const y1 = (80 - Math.sin(a) * 67).toFixed(1);
      const x2 = (75 + Math.cos(a) * 72).toFixed(1);
      const y2 = (80 - Math.sin(a) * 72).toFixed(1);
      return `<line class="gauge__tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`;
    }).join('');
    return `<svg viewBox="0 0 150 92" aria-hidden="true" focusable="false">
      <path class="gauge__track" d="M15 80 A60 60 0 0 1 135 80" pathLength="100"></path>
      <path class="gauge__value" d="M15 80 A60 60 0 0 1 135 80" pathLength="100" stroke-dasharray="${pct} 100"></path>
      ${ticks}
      <line class="gauge__needle" x1="75" y1="80" x2="75" y2="34" style="transform: rotate(${angle}deg)"></line>
      <circle class="gauge__hub" cx="75" cy="80" r="5"></circle>
    </svg>`;
  }

  function renderFacts(view) {
    const best = view.best;
    // For an irrecoverable relic the number is how sure we are about the diagnosis, not a rescue.
    const lost = view.status === 'irrecoverable';
    const wrap = h('div', { class: 'verdict__facts' });
    if (best) {
      const conf = Number(best.confidence);
      const pct = Math.round(clamp(Number.isFinite(conf) ? conf : 0, 0, 1) * 100);
      const color = lost || pct < 45 ? 'var(--danger)' : pct < 75 ? 'var(--warn)' : 'var(--verdigris)';
      const name = tr(lost ? 'facts.diagnosis' : 'facts.confidence');
      const gauge = h('div', {
        class: 'gauge', role: 'meter', 'aria-label': name, 'aria-valuemin': '0', 'aria-valuemax': '100',
        'aria-valuenow': String(pct), 'aria-valuetext': `${name} ${pct}%`,
      });
      gauge.style.setProperty('--gauge-color', color);
      gauge.innerHTML = gaugeMarkup(pct);
      gauge.append(h('span', { class: 'gauge__text' }, `${pct}%`), h('span', { class: 'gauge__label' }, tr(lost ? 'facts.gaugeDiagnosis' : 'facts.gaugeConfidence')));
      wrap.append(gauge);
    }
    const dl = h('dl', { class: 'facts' });
    const add = (k, v) => { if (v !== '' && v != null) dl.append(h('dt', null, k), h('dd', null, v)); };
    add(tr('facts.lang'), languageFact(view));
    const steps = stepsOf(best);
    add(tr('facts.strata'), best ? tr('facts.layers', { n: steps.length }) : '—');
    const repairs = best && Array.isArray(best.repairs) ? best.repairs.length : 0;
    if (best && !lost) add(tr('facts.repairs'), repairs ? tr('facts.repairsN', { n: repairs }) : tr('facts.noRepairs'));
    if (best && best.label) add(tr('facts.verdict'), best.label);
    if (best && !lost && best.score && Number.isFinite(Number(best.score.value))) {
      add(tr('facts.readability'), `${formatScore(view.inputScore && view.inputScore.value)} → ${formatScore(best.score.value)}`);
    }
    wrap.append(dl);
    return wrap;
  }

  function renderChainBlock(view) {
    const best = view.best;
    const steps = stepsOf(best);
    if (!steps.length) return null;
    const ol = h('ol', { class: 'chain', 'aria-label': tr('chain.aria') });
    ol.append(h('li', { class: 'chain__node chain__node--origin' }, tr('chain.origin'), h('small', null, truncate(best.output, 10))));
    for (const node of forwardChain(steps)) {
      if (node.kind === 'escape') {
        if (node.from) {
          ol.append(h('li', { class: 'chain__arrow' }, tr('chain.encodedAs')));
          ol.append(h('li', { class: 'chain__node' }, tr('chain.bytes', { enc: encName(node.from) })));
        }
        ol.append(h('li', { class: 'chain__arrow' }, tr('chain.escapedAs')));
        ol.append(h('li', { class: 'chain__node chain__node--wrong' }, schemeName(node.scheme)));
      } else {
        ol.append(h('li', { class: 'chain__arrow' }, tr('chain.encodedAs')));
        ol.append(h('li', { class: 'chain__node', title: encDesc(node.from) }, encName(node.from)));
        ol.append(h('li', { class: 'chain__arrow' }, tr(node.lossy ? 'chain.misreadLossy' : 'chain.misreadAs')));
        ol.append(h('li', { class: 'chain__node chain__node--wrong', title: encDesc(node.to) }, encName(node.to)));
      }
    }
    ol.append(h('li', { class: 'chain__arrow' }, tr('chain.unearthed')));
    ol.append(h('li', { class: 'chain__node chain__node--relic' }, truncate(view.input, 14)));
    return h('div', { class: 'chain-wrap' }, h('h3', { class: 'mini-title' }, tr('chain.title')), ol);
  }

  // Encoding description in the current language (Codecs.describe(id, locale), §11.3).
  function encDesc(id) {
    const Codecs = mod('Codecs');
    const loc = currentLocale();
    try {
      if (Codecs && typeof Codecs.describe === 'function') {
        const d = Codecs.describe(id, loc);
        if (typeof d === 'string' && d) return d;
      }
      const info = Codecs && Codecs.get ? Codecs.get(id) : null;
      const d = info ? info[loc === 'en-US' ? 'en' : 'zh'] : null;
      return typeof d === 'string' && d ? d : null;
    } catch (_) {
      return null;
    }
  }

  function renderRepairs(best) {
    const repairs = best && Array.isArray(best.repairs) ? best.repairs : [];
    if (!repairs.length) return null;
    const steps = stepsOf(best);
    const ul = h('ul', { class: 'repairs__list' });
    repairs.slice(0, 12).forEach((r) => ul.append(h('li', { class: 'repair' }, repairLine(r, steps))));
    if (repairs.length > 12) ul.append(h('li', { class: 'repair' }, tr('repairs.more', { n: repairs.length - 12 })));
    return h('div', { class: 'verdict__block' }, h('h3', { class: 'mini-title' }, tr('repairs.title')), ul);
  }

  // One entry per distinct hint (the same long hint used to repeat once per match).
  const SIGNAL_MATCHES_MAX = 6;

  function renderSignals(signals) {
    const groups = groupSignals(signals);
    if (!groups.length) return null;
    const ul = h('ul', { class: 'signals__list' });
    groups.slice(0, 6).forEach((g) => {
      const shown = g.matches.slice(0, SIGNAL_MATCHES_MAX);
      const more = g.count - shown.length;
      ul.append(h('li', { class: 'signal' },
        shown.length
          ? h('span', { class: 'signal__matches' },
            shown.map((m) => h('code', null, truncate(m, 16))),
            more > 0 ? h('span', { class: 'signal__more' }, tr('signals.more', { n: g.count })) : null)
          : null,
        h('span', { class: 'signal__hint' }, g.hint)));
    });
    return h('div', { class: 'verdict__block' }, h('h3', { class: 'mini-title' }, tr('signals.title')), ul);
  }

  function renderStats(view) {
    const st = view.stats || {};
    const parts = [];
    const explored = Number(st.explored);
    if (Number.isFinite(explored) && st.explored != null) {
      if (explored > 0) parts.push(tr('stats.explored', { n: explored }));
      else if (view.status === 'irrecoverable') parts.push(tr('stats.signature'));
      else if (view.status === 'clean') parts.push(tr('stats.clean'));
      else parts.push(tr('stats.none'));
    }
    if (Number.isFinite(Number(st.ms))) parts.push(tr('stats.ms', { ms: Math.round(st.ms) }));
    if (st.truncated) parts.push(tr('stats.truncated'));
    return parts.length ? h('p', { class: 'verdict__stats' }, parts.join(' · ')) : null;
  }

  // ---------- stratigraphy ----------

  function renderStrata() {
    const body = els.strataBody;
    body.textContent = '';
    state.gridBand = body.clientWidth;
    const view = state.view;
    const best = view.best;
    const steps = stepsOf(best);
    if (!steps.length) {
      body.append(h('p', { class: 'strata__empty' }, tr(view.status === 'clean' ? 'strata.emptyClean' : 'strata.emptyUnknown')));
      body.append(surfaceBand(view.input));
      return;
    }
    body.append(surfaceBand(view.input));
    steps.forEach((step, i) => body.append(renderStratum(step, i)));
    body.append(bedrockBand(best.output));
  }

  function surfaceBand(input) {
    return h('article', { class: 'stratum stratum--surface', 'aria-label': tr('strata.surfaceAria') },
      h('div', { class: 'stratum__head' },
        h('span', { class: 'stratum__no' }, tr('strata.surface')),
        h('h3', { class: 'stratum__title' }, tr('strata.surfaceTitle'))),
      h('div', { class: 'stratum__text', 'data-scroll-label': tr('strata.surfaceLabel') }, truncate(input, 600)));
  }

  function bedrockBand(output) {
    const lost = state.view && state.view.status === 'irrecoverable';
    const title = tr(lost ? 'strata.bedrockLost' : 'strata.bedrockTitle');
    return h('article', { class: 'stratum stratum--bedrock', 'aria-label': tr(lost ? 'strata.bedrockAriaLost' : 'strata.bedrockAria') },
      h('div', { class: 'stratum__head' },
        h('span', { class: 'stratum__no' }, tr('strata.bedrock')),
        h('h3', { class: 'stratum__title' }, title)),
      h('p', Object.assign({ class: 'stratum__fossil', 'data-scroll-label': title }, langAttrs(state.view)), truncate(output, 600)));
  }

  function renderStratum(step, index) {
    const titleId = `stratum-title-${index}`;
    const art = h('article', { class: 'stratum', 'data-depth': String(Math.min(4, index + 1)), 'aria-labelledby': titleId });
    art.dataset.index = String(index);
    const isUnescape = step.kind === 'unescape';
    const repairs = Array.isArray(step.repairs) ? step.repairs : [];

    const meta = h('span', { class: 'stratum__meta' },
      step.lossy ? h('span', { class: 'tag tag--lossy' }, tr('stratum.lossy')) : null,
      repairs.length ? h('span', { class: 'tag' }, tr('stratum.repairs', { n: repairs.length })) : null,
      // Escape syntax (%XX, \xNN, hex pairs) is plain ASCII and scores deceptively well, so a
      // before/after readability comparison would only mislead on unescape layers.
      !isUnescape && Number.isFinite(Number(step.scoreBefore)) && Number.isFinite(Number(step.scoreAfter))
        ? h('span', { class: 'tag', title: tr('stratum.readTitle') }, tr('stratum.read', { before: formatScore(step.scoreBefore), after: formatScore(step.scoreAfter) }))
        : null,
      Number.isFinite(Number(step.prior)) && step.prior > 0 && !isUnescape
        ? h('span', { class: 'tag', title: tr('stratum.priorTitle') }, tr('stratum.prior', { pct: formatPercent(step.prior) }))
        : null);

    art.append(h('div', { class: 'stratum__head' },
      h('span', { class: 'stratum__no' }, `L${index + 1}`),
      h('h3', { class: 'stratum__title', id: titleId }, tr('stratum.title', { n: index + 1, title: stepTitle(step) })),
      meta));

    const model = buildGridModel(step, state.expanded.has(index) ? BYTES_EXPANDED : BYTES_COLLAPSED);
    let explain;
    if (isUnescape) {
      explain = model
        ? tr('stratum.explainUnescape', { scheme: schemeName(step.scheme), enc: encName(step.trueEncoding) })
        : tr('stratum.explainUnescapeDirect', { scheme: schemeName(step.scheme) });
    } else {
      explain = tr('stratum.explain', { wrong: encName(step.wrongDecoder), right: encName(step.trueEncoding) });
    }
    art.append(h('p', { class: 'stratum__explain' }, explain));

    if (model) {
      art.append(renderByteGrid(model, step, index));
      art.append(h('p', { class: 'stratum__readout' }, tr('stratum.readout')));
      const foot = h('div', { class: 'stratum__foot' });
      foot.append(h('span', null, tr('stratum.total', {
        n: model.total,
        more: model.truncated ? tr('stratum.totalShown', { n: model.shown }) : '',
      })));
      if (model.truncated || state.expanded.has(index)) {
        const expanded = state.expanded.has(index);
        foot.append(h('button', {
          type: 'button',
          class: 'btn btn--ghost btn--small stratum__expand',
          'aria-expanded': String(expanded),
          onclick: () => toggleStratum(index),
        }, expanded
          ? tr('stratum.collapse', { n: BYTES_COLLAPSED })
          : (model.total > BYTES_EXPANDED ? tr('stratum.expandFirst', { n: BYTES_EXPANDED }) : tr('stratum.expandAll', { n: model.total }))));
      }
      art.append(foot);
    } else {
      const inLabel = tr('stratum.input');
      const outLabel = tr('stratum.output');
      art.append(h('div', { class: 'stratum__pair' },
        h('div', null, h('span', { class: 'stratum__pair-label' }, inLabel), h('div', { class: 'stratum__text', 'data-scroll-label': inLabel }, truncate(step.before, 400))),
        h('div', null, h('span', { class: 'stratum__pair-label' }, outLabel), h('div', { class: 'stratum__text', 'data-scroll-label': outLabel }, truncate(step.after, 400)))));
    }
    return art;
  }

  function toggleStratum(index) {
    if (state.expanded.has(index)) state.expanded.delete(index);
    else state.expanded.add(index);
    const steps = stepsOf(state.view && state.view.best);
    const old = els.strataBody.querySelector(`.stratum[data-index="${index}"]`);
    if (!old || !steps[index]) return;
    const fresh = renderStratum(steps[index], index);
    old.replaceWith(fresh);
    fitScrollers(fresh);
    updateDocentSticky();
    const btn = fresh.querySelector('.stratum__expand');
    if (btn) btn.focus();
  }

  // Byte-grid rows hold 16 bytes, or 8 on narrow screens.
  function bytesPerRow() {
    const narrow = typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 599px)').matches
      : window.innerWidth < 600;
    return narrow ? 8 : 16;
  }

  /*
   * One .bytegrid per chunk of ~16 bytes (cut only at character boundaries), stacked. All chunks
   * of a layer share one context, so hover, pinning and arrow keys work across rows.
   */
  // Estimated width (rem, px) of the kept-text columns in the widest row of a chunking.
  function keptWidth(model, chunks) {
    let best = { rem: 0, px: 0 };
    const kept = model.top.concat(model.bottom).filter((it) => it.kept);
    if (!kept.length) return best;
    for (const chunk of chunks) {
      let rem = 0;
      for (const pos of chunk.keptAt) {
        let widest = 0;
        for (const it of kept) {
          if (it.start !== pos) continue;
          const chars = Array.from(it.text).slice(0, KEPT_DISPLAY_MAX + 1);
          widest = Math.max(widest, chars.reduce((w, c) => w + (c.codePointAt(0) >= 0x1100 ? 1 : 0.62), 0));
        }
        rem += widest * 0.85 + 0.7;
      }
      const px = chunk.keptAt.length * 8;
      if (rem * 16 + px > best.rem * 16 + best.px) best = { rem, px };
    }
    return best;
  }

  function renderByteGrid(model, step, index) {
    const isUnescape = step.kind === 'unescape';
    let per = bytesPerRow();
    state.gridPerRow = per;
    let chunks = chunkGridModel(model, per);
    // Byte cells share the band's width with any kept-text columns: reserve an estimate of the
    // widest row's kept text, and use shorter rows when the cells would otherwise not fit.
    let kw = keptWidth(model, chunks);
    if (kw.rem) {
      const band = Math.max(200, (els.strataBody.clientWidth || 600) - 44);
      const labelRem = currentLocale() === 'en-US' ? 3.9 : 3.2; // .bytegrid --label (styles.css)
      const fit = Math.floor((band - labelRem * 16 - 6 - kw.rem * 16 - kw.px) / (1.7 * 16));
      const shorter = clamp(fit, 3, per);
      if (shorter < per) {
        per = shorter;
        chunks = chunkGridModel(model, per);
        kw = keptWidth(model, chunks);
      }
    }
    const wrap = h('div', {
      class: 'bytegrid-scroll',
      role: 'group',
      'aria-label': tr('grid.aria', { n: index + 1, top: tr(isUnescape ? 'grid.ariaTopEscape' : 'grid.ariaTopMisread') }),
    });
    wrap.style.setProperty('--per', String(per));
    if (kw.rem) wrap.style.setProperty('--kept-w', `calc(${kw.rem.toFixed(2)}rem + ${kw.px}px)`);

    const topName = tr(isUnescape ? 'grid.labelEscape' : 'grid.labelMisread');
    const label = (row, text, title, extra) => {
      const el = h('span', { class: 'bytegrid__label', title, 'aria-hidden': 'true' }, text, extra || null);
      el.style.gridRow = String(row);
      return el;
    };

    const ctx = { model, step, index, byteEls: [], topEls: [], bottomEls: [], pinned: null, chunks };
    const rowNames = {
      top: isUnescape ? tr('grid.rowEscape') : tr('grid.rowMisread', { enc: encName(step.wrongDecoder) }),
      bottom: tr('grid.rowRestored', { enc: encName(step.trueEncoding) }),
    };
    const keptCodec = encName(isUnescape ? step.trueEncoding : step.wrongDecoder);
    const pending = { top: [], bottom: [] };

    chunks.forEach((chunk) => {
      const grid = h('div', { class: 'bytegrid' });
      grid.style.gridTemplateColumns = chunkTemplate(chunk);
      const off = chunk.start.toString(16).toUpperCase();
      grid.append(
        label(1, topName, isUnescape ? schemeName(step.scheme) : tr('grid.titleMisread', { enc: encName(step.wrongDecoder) })),
        label(2, tr('grid.labelBytes'), tr('grid.titleBytes', { n: chunk.start, off }),
          chunks.length > 1 ? h('span', { class: 'bytegrid__off' }, `0x${off.padStart(2, '0')}`) : null),
        label(3, tr('grid.labelRestored'), tr('grid.titleRestored', { enc: encName(step.trueEncoding) })));
      for (let b = chunk.start; b < chunk.end; b++) {
        const cell = h('span', { class: model.bytes[b] >= 0x80 ? 'bg-byte is-high' : 'bg-byte', 'aria-hidden': 'true' }, model.hex[b]);
        cell.style.gridColumn = String(chunkByteColumn(chunk, b));
        ctx.byteEls[b] = cell;
        grid.append(cell);
      }
      ['top', 'bottom'].forEach((row) => {
        const items = row === 'top' ? model.top : model.bottom;
        for (const k of chunk[row]) {
          const el = charElement(items[k], row, k, model, rowNames[row], chunk, keptCodec);
          pending[row].push([k, el]);
          grid.append(el);
        }
      });
      gridCtx.set(grid, ctx);
      wrap.append(grid);
    });
    for (const row of ['top', 'bottom']) {
      const list = row === 'top' ? ctx.topEls : ctx.bottomEls;
      for (const [k, el] of pending[row]) list[k] = el;
    }
    const first = ctx.topEls[0] || ctx.bottomEls[0];
    if (first) first.tabIndex = 0;
    return wrap;
  }

  const KEPT_DISPLAY_MAX = 12;

  function charElement(it, row, k, model, rowName, chunk, keptCodec) {
    let el;
    if (it.kept) {
      // Characters the wrong decoder could not encode: they passed through this layer untouched.
      const chars = Array.from(it.text);
      const shown = chars.length > KEPT_DISPLAY_MAX ? `${chars.slice(0, KEPT_DISPLAY_MAX).join('')}…` : it.text;
      const desc = tr('grid.kept', { text: it.text, codec: keptCodec });
      el = h('button', {
        type: 'button',
        class: `bg-kept bg-kept--${row}`,
        'aria-label': desc,
        title: desc,
      }, shown);
      el.style.gridColumn = String(chunkKeptColumn(chunk, it.start));
    } else if (it.gap) {
      const atEnd = it.atEnd || it.start >= chunk.end;
      const col = atEnd ? chunkByteColumn(chunk, Math.max(chunk.start, chunk.end - 1)) : chunkByteColumn(chunk, it.start);
      const badge = it.text ? displayChar(it.text).text : '⁁';
      el = h('button', {
        type: 'button',
        class: `bg-gap bg-gap--${row}${atEnd ? ' bg-gap--end' : ''}`,
        'aria-label': tr('grid.gapAria', { where: tr(row === 'top' ? 'grid.gapWhereTop' : 'grid.gapWhereBottom'), text: it.text || tr('grid.gapEmpty') }),
        title: tr('grid.gapTitle'),
      }, h('span', { class: 'bg-gap__badge', 'aria-hidden': 'true' }, badge));
      el.style.gridColumn = String(col);
    } else {
      const single = Array.from(it.text).length === 1;
      const d = single ? displayChar(it.text) : { text: it.text, kind: 'normal', title: codepointLabel(it.text) };
      const classes = ['bg-char', `bg-char--${row}`];
      if (d.kind === 'ctl') classes.push('is-ctl');
      if (d.kind === 'space') classes.push('is-space');
      if (!single && it.text.length > it.span * 2) classes.push('tight');
      if (it.error) classes.push('is-error');
      if (it.repaired) classes.push('is-repaired');
      if (it.clipped) classes.push('is-clipped');
      if (it.unchanged) classes.push('is-unchanged');
      const hex = hexOf(model.bytes, it.start, Math.min(it.end, model.total));
      const cands = it.candidates && it.candidates.length ? tr('common.cands', { list: it.candidates.join(tr('common.listSep')) }) : '';
      el = h('button', {
        type: 'button',
        class: classes.join(' '),
        'aria-label': tr('grid.charAria', {
          row: rowName,
          text: it.text,
          hex,
          repaired: it.repaired ? tr('grid.charRepaired', { cands }) : '',
          error: it.error ? tr('grid.charError') : '',
          kept: it.unchanged ? tr('grid.charKept') : '',
        }),
        title: it.repaired ? tr('grid.charTitleRepaired', { cands: cands || '' }) : d.title,
      }, d.text);
      const startCol = chunkByteColumn(chunk, it.start);
      const lastByte = Math.max(it.start, Math.min(it.end, model.shown, chunk.end) - 1);
      el.style.gridColumn = `${startCol} / span ${Math.max(1, chunkByteColumn(chunk, lastByte) - startCol + 1)}`;
    }
    el.tabIndex = -1;
    el.dataset.row = row;
    el.dataset.k = String(k);
    el.dataset.s = String(it.start);
    el.dataset.e = String(it.end);
    return el;
  }

  function gridOf(target) {
    const el = target && target.closest ? target.closest('.bg-char, .bg-gap, .bg-kept') : null;
    if (!el) return null;
    const grid = el.closest('.bytegrid');
    const ctx = grid ? gridCtx.get(grid) : null;
    return ctx ? { el, grid, ctx } : null;
  }

  function itemOf(ctx, el) {
    const k = Number(el.dataset.k);
    return (el.dataset.row === 'top' ? ctx.model.top : ctx.model.bottom)[k];
  }

  // A gap (zero-width insertion point) belongs to the character that spans it, or to a repaired
  // character that starts or ends exactly at it (the lost byte was that character's edge).
  function overlaps(a, b) {
    // Kept text owns no bytes: it only pairs with the same untouched run on the other row.
    if (a.kept || b.kept) return !!(a.kept && b.kept && a.start === b.start);
    if (a.gap && b.gap) return a.start === b.start;
    if (a.gap || b.gap) {
      const g = a.gap ? a : b;
      const c = a.gap ? b : a;
      const p = g.start;
      return (c.start < p && c.end > p) || (!!c.repaired && (c.end === p || c.start === p));
    }
    return a.start < b.end && b.start < a.end;
  }

  function clearHighlight(ctx) {
    for (const list of [ctx.byteEls, ctx.topEls, ctx.bottomEls]) {
      for (const el of list) el.classList.remove('is-lit', 'is-focus');
    }
  }

  function highlight(ctx, el) {
    clearHighlight(ctx);
    const item = itemOf(ctx, el);
    if (!item) return;
    el.classList.add('is-focus');
    if (!item.gap) {
      for (let b = item.start; b < Math.min(item.end, ctx.byteEls.length); b++) ctx.byteEls[b].classList.add('is-lit');
    }
    const otherRow = el.dataset.row === 'top' ? 'bottom' : 'top';
    const otherItems = otherRow === 'top' ? ctx.model.top : ctx.model.bottom;
    const otherEls = otherRow === 'top' ? ctx.topEls : ctx.bottomEls;
    const shared = [];
    otherItems.forEach((o, i) => {
      if (overlaps(item, o)) {
        otherEls[i].classList.add('is-lit');
        shared.push(o);
      }
    });
    // A gap has no bytes of its own; light the bytes of the character repaired around it.
    if (item.gap) {
      for (const o of shared) {
        for (let b = o.start; b < Math.min(o.end, ctx.byteEls.length); b++) ctx.byteEls[b].classList.add('is-lit');
      }
    }
    updateReadout(ctx, el, item, shared);
  }

  function updateReadout(ctx, el, item, shared) {
    const art = el.closest('.stratum');
    const out = art ? art.querySelector('.stratum__readout') : null;
    if (!out) return;
    const step = ctx.step;
    const rowLabel = el.dataset.row === 'top'
      ? (step.kind === 'unescape' ? tr('readout.rowEscape') : tr('readout.rowMisread', { enc: encName(step.wrongDecoder) }))
      : tr('readout.rowRestored', { enc: encName(step.trueEncoding) });
    const otherText = shared.map((o) => (o.gap ? tr('readout.gapOther') : o.text)).join('');
    out.textContent = '';
    if (item.kept) {
      const codec = encName(step.kind === 'unescape' ? step.trueEncoding : step.wrongDecoder);
      out.append(tr('readout.kept', { text: truncate(item.text, 80), codec }));
      return;
    }
    if (item.gap) {
      out.append(tr('readout.gap', { text: item.text || tr('readout.gapUnknown') }));
      if (otherText) out.append(tr('readout.gapRepair', { text: otherText }));
      return;
    }
    const hex = hexOf(ctx.model.bytes, item.start, Math.min(item.end, ctx.model.total));
    const cands = item.candidates && item.candidates.length
      ? tr('readout.cands', { list: item.candidates.join(tr('common.listSep')) })
      : '';
    out.append(
      tr('readout.char', { row: rowLabel, text: item.text, cp: codepointLabel(item.text) }),
      h('code', null, hex + (item.clipped ? ' …' : '')),
      otherText ? tr('readout.shared', { text: otherText }) : '',
      item.repaired ? tr('readout.repaired', { cands }) : '',
      item.error ? tr('readout.error') : '',
      item.unchanged ? tr('readout.unchanged') : '',
      tr('readout.end'));
  }

  function onGridPointer(e) {
    const hit = gridOf(e.target);
    if (!hit || hit.ctx.pinned) return;
    highlight(hit.ctx, hit.el);
  }

  function onGridLeave(e) {
    const hit = gridOf(e.target);
    if (!hit || hit.ctx.pinned) return;
    const to = e.relatedTarget;
    const toGrid = to && to.closest ? to.closest('.bytegrid') : null;
    if (to && to.closest && to.closest('.bg-char, .bg-gap, .bg-kept') && toGrid && gridCtx.get(toGrid) === hit.ctx) return;
    clearHighlight(hit.ctx);
  }

  // Roving tabindex: the last visited character becomes the band's single tab stop.
  function activateChar(ctx, el) {
    for (const list of [ctx.topEls, ctx.bottomEls]) for (const item of list) item.tabIndex = -1;
    el.tabIndex = 0;
    ctx.pinned = null;
    highlight(ctx, el);
  }

  function onGridFocus(e) {
    const hit = gridOf(e.target);
    if (hit) activateChar(hit.ctx, hit.el);
  }

  function onGridClick(e) {
    const hit = gridOf(e.target);
    if (!hit) return;
    const same = hit.ctx.pinned === hit.el;
    hit.ctx.pinned = same ? null : hit.el;
    if (same) clearHighlight(hit.ctx);
    else highlight(hit.ctx, hit.el);
  }

  function onGridKeydown(e) {
    const hit = gridOf(e.target);
    if (!hit) return;
    const { ctx, el } = hit;
    const row = el.dataset.row;
    const list = row === 'top' ? ctx.topEls : ctx.bottomEls;
    const other = row === 'top' ? ctx.bottomEls : ctx.topEls;
    const idx = list.indexOf(el);
    let next = null;
    switch (e.key) {
      case 'ArrowRight': next = list[idx + 1]; break;
      case 'ArrowLeft': next = list[idx - 1]; break;
      case 'Home': next = list[0]; break;
      case 'End': next = list[list.length - 1]; break;
      case 'ArrowDown':
      case 'ArrowUp': {
        if ((e.key === 'ArrowDown') !== (row === 'top')) break;
        const item = itemOf(ctx, el);
        const otherItems = row === 'top' ? ctx.model.bottom : ctx.model.top;
        let j = otherItems.findIndex((o) => overlaps(item, o));
        if (j < 0) {
          // Nothing shares these bytes (e.g. a gap at the edge): jump to the nearest block.
          let bestDist = Infinity;
          otherItems.forEach((o, i) => {
            const d = Math.abs(o.start - item.start);
            if (d < bestDist) { bestDist = d; j = i; }
          });
        }
        next = other[j] || null;
        break;
      }
      case 'Escape':
        ctx.pinned = null;
        clearHighlight(ctx);
        return;
      default:
        return;
    }
    if (next) {
      e.preventDefault();
      activateChar(ctx, next);
      next.focus();
    }
  }

  // ---------- alternatives & signatures ----------

  // Rank seals of the second opinions (甲乙丙… / A B C…).
  function ranks() {
    return Array.from(tr('alts.ranks'));
  }

  function renderAlternatives() {
    const list = els.altsList;
    list.textContent = '';
    const oldMore = els.alternatives.querySelector('.alts__more');
    if (oldMore) oldMore.remove();
    const view = state.view;
    // A clean text has nothing to compare; an empty "second opinions" panel is just filler.
    els.alternatives.hidden = !!view && view.status === 'clean';
    const unsolved = !!state.result && state.result.status === 'unknown';
    if (els.altsTitle) els.altsTitle.textContent = tr(unsolved ? 'alts.titleGuesses' : 'alts.title');
    const hyps = hypotheses(state.result);
    if (hyps.length <= 1) {
      list.append(h('li', { class: 'alts__empty' }, tr(hyps.length ? 'alts.agree' : 'alts.none')));
      return;
    }
    const engineHasBest = !!state.result.best;
    const { main, more, threshold } = partitionAlternatives(hyps, engineHasBest);
    const RANKS = ranks();
    const item = (i) => {
      const hyp = hyps[i];
      const current = state.viewIndex === i || (state.viewIndex == null && engineHasBest && i === 0);
      const label = hyp.label || chainSentence(stepsOf(hyp)) || tr('alts.unnamed');
      const pct = formatPercent(hyp.confidence);
      const bar = h('span');
      bar.style.width = pct;
      const btn = h('button', {
        type: 'button',
        class: 'alt__btn',
        'data-index': String(i),
        'aria-current': current ? 'true' : null,
        'aria-label': tr('alts.aria', { state: tr(current ? 'alts.current' : 'alts.adopt'), output: truncate(hyp.output, 40), label, pct }),
        onclick: () => promote(i),
      },
      h('span', { class: 'alt__rank', 'aria-hidden': 'true' }, RANKS[i] || String(i + 1)),
      h('span', { class: 'alt__out', dir: 'auto' }, truncate(hyp.output, 60)),
      h('span', { class: 'alt__label' }, `${i === 0 && engineHasBest ? tr('alts.chief') : ''}${label}`),
      h('span', { class: 'alt__conf' }, pct, h('span', { class: 'alt__bar', 'aria-hidden': 'true' }, bar)));
      return { li: h('li', { class: 'alt' }, btn), current };
    };
    main.forEach((i) => list.append(item(i).li));
    if (!more.length) return;
    // Near-zero guesses stay one click away instead of competing with the real answer.
    const inner = h('ol', { class: 'alts__list alts__list--more' });
    let holdsCurrent = false;
    more.forEach((i) => {
      const it = item(i);
      holdsCurrent = holdsCurrent || it.current;
      inner.append(it.li);
    });
    const details = h('details', { class: 'alts__more' },
      h('summary', null, tr('alts.more', { n: more.length, pct: Math.round(threshold * 100) })),
      inner);
    details.open = holdsCurrent;
    list.after(details);
  }

  function promote(index) {
    if (!state.result) return;
    const engineHasBest = !!state.result.best;
    const normalized = engineHasBest && index === 0 ? null : index;
    if (normalized === state.viewIndex) return;
    cancelRun();
    state.viewIndex = normalized;
    state.view = deriveView(state.result, normalized);
    state.expanded.clear();
    state.narration = computeNarration(state.view);
    renderResults();
    startNarration();
    const btn = els.alternatives.querySelector(`.alt__btn[data-index="${index}"]`);
    if (btn) btn.focus();
    announce(normalized == null ? tr('alts.backToChief') : tr('alts.adopted', { n: index + 1, output: truncate(state.view.best.output, 40) }));
  }

  function renderSignatures() {
    const sigs = state.view && Array.isArray(state.view.signatures) ? state.view.signatures : [];
    els.sigList.textContent = '';
    if (!sigs.length) {
      els.signatures.hidden = true;
      return;
    }
    els.signatures.hidden = false;
    sigs.forEach((s) => {
      els.sigList.append(h('li', { class: 'sig-plaque' },
        h('span', { class: 'sig-plaque__seal', 'aria-hidden': 'true' }, tr('sig.seal')),
        h('h3', { class: 'sig-plaque__title' }, s.title || s.id || tr('sig.untitled')),
        // The plaque title is often the relic itself (锟斤拷); do not print it twice.
        s.match && s.match !== s.title ? h('code', { class: 'sig-plaque__match' }, truncate(s.match, 40)) : null,
        s.note ? h('p', { class: 'sig-plaque__note' }, s.note) : null));
    });
  }

  // ---------- narration ----------

  function computeNarration(view) {
    const Narrator = mod('Narrator');
    if (Narrator && typeof Narrator.narrate === 'function') {
      try {
        const n = Narrator.narrate(view, { style: state.style, seed: state.seed, locale: currentLocale() });
        if (n && Array.isArray(n.sections)) return n;
      } catch (err) {
        if (typeof console !== 'undefined') console.error('[MBX] Narrator.narrate failed', err);
      }
    }
    return fallbackNarration(view);
  }

  // Minimal stand-in docent so the panel still says something true when narrator.js is absent.
  function fallbackNarration(view) {
    const best = view.best;
    const steps = stepsOf(best);
    const copy = copyFor(view.status);
    const sections = [{ id: 'opening', heading: tr('fallback.opening'), text: tr('fallback.openingText') }];
    if (best) {
      sections.push({
        id: 'identify',
        heading: tr('fallback.identify'),
        text: tr('fallback.identifyText', { output: truncate(best.output, 40), chain: chainSentence(steps) || tr('fallback.unknownChain') }),
      });
      const step = steps[0];
      const rows = step ? charMapRows(step, 3) : [];
      if (rows.length) {
        const sample = rows.map((r) => tr('fallback.sample', { after: r.after, hex: r.hex, before: r.before })).join(tr('fallback.sampleSep'));
        sections.push({ id: 'mechanism', heading: tr('fallback.mechanism'), text: tr('fallback.mechanismText', { sample }) });
      }
    } else {
      sections.push({ id: 'identify', heading: tr('fallback.identify'), text: copy.desc });
    }
    sections.push({ id: 'closing', heading: tr('fallback.closing'), text: tr('fallback.closingText') });
    const narration = {
      exhibitId: fallbackExhibitId(view.input),
      title: tr('fallback.title', { label: best ? best.label || tr('fallback.misread') : copy.label }),
      subtitle: tr('fallback.subtitle'),
      era: null,
      site: '',
      tags: [],
      sections,
    };
    narration.plainText = narrationPlainText(Object.assign({}, narration, { plainText: '' }));
    return narration;
  }

  // narration.docent ({ name, styleName, avatar }) is an optional narrator extension; when present
  // the seed picks a named docent, so "换一位讲解员" visibly changes who is talking.
  function currentDocent() {
    const info = styleInfo(state.style);
    const n = state.narration;
    const d = n && n.docent && (!n.style || n.style === info.id) ? n.docent : null;
    const fallbackName = tr('docent.default');
    return {
      avatar: (d && d.avatar) || info.avatar || '🧑‍🏫',
      name: d && d.name ? `${d.name} · ${d.styleName || info.name || fallbackName}` : (info.name || fallbackName),
      shortName: (d && d.name) || info.name || fallbackName,
    };
  }

  // status: a string, or a function re-evaluated after a language switch; omitted = keep it.
  function updateDocentIdentity(status) {
    const who = currentDocent();
    els.docentAvatar.textContent = who.avatar;
    els.docentName.textContent = who.name;
    if (status) state.docentStatus = status;
    const s = state.docentStatus;
    const text = typeof s === 'function' ? s() : s;
    if (text) els.docentStatus.textContent = text;
  }

  function renderStyleSwitch() {
    const fs = els.styleSwitch;
    [...fs.querySelectorAll('.style-opt')].forEach((n) => n.remove());
    stylesList().forEach((s) => {
      const input = h('input', { type: 'radio', name: 'docentStyle', value: s.id });
      input.checked = s.id === state.style;
      fs.append(h('label', { class: 'style-opt', title: s.tagline || null }, input, h('span', null, h('span', { 'aria-hidden': 'true' }, s.avatar || ''), s.name || s.id)));
    });
  }

  function setStyle(id) {
    const info = styleInfo(id);
    if (!info || info.id === state.style) return;
    state.style = info.id;
    for (const radio of els.styleSwitch.querySelectorAll('input[name="docentStyle"]')) radio.checked = radio.value === info.id;
    if (!state.view) {
      updateDocentIdentity(() => styleInfo(info.id).tagline || tr('docent.status.waiting'));
      return;
    }
    state.narration = computeNarration(state.view);
    startNarration();
  }

  function renderNarrationHead(n) {
    const box = els.narration;
    box.textContent = '';
    const meta = h('dl', { class: 'narr-meta' });
    if (n.era && n.era.label) {
      const dd = h('dd', null, n.era.label);
      // The 字节测年 section tells the same story in full; keep the reasoning one click away.
      if (n.era.reason) {
        dd.append(h('details', { class: 'narr-meta__why' },
          h('summary', null, tr('narr.why')),
          renderInline(h('p'), n.era.reason)));
      }
      meta.append(h('dt', null, tr('narr.era')), dd);
    }
    if (n.site) meta.append(h('dt', null, tr('narr.site')), renderInline(h('dd'), n.site));
    const tags = Array.isArray(n.tags) && n.tags.length
      ? h('ul', { class: 'tag-list', 'aria-label': tr('narr.tags') }, n.tags.slice(0, 8).map((t) => h('li', { class: 'tag' }, String(t))))
      : null;
    const head = h('header', { class: 'narr-head' },
      h('p', { class: 'narr-head__no' }, tr('narr.exhibitNo', { id: n.exhibitId || currentExhibitId() })),
      h('h3', { class: 'narr-head__title' }, n.title || tr('narr.untitled')),
      n.subtitle ? renderInline(h('p', { class: 'narr-head__sub' }), n.subtitle) : null,
      meta.childNodes.length ? meta : null,
      tags);
    const body = h('div', { class: 'narr-body' });
    box.append(head, body);
    state.narrBody = body;
  }

  /*
   * opts.animate === false: no typewriter (used when the language switches under a finished tour).
   * opts.ai === false: do not request the AI docent this time, even if it is switched on (a
   * language switch after the AI tour finished or was stopped would otherwise spend quota).
   */
  function startNarration(opts) {
    const animate = !(opts && opts.animate === false) && motionOn();
    const allowAi = !(opts && opts.ai === false);
    stopTypewriter();
    abortAi();
    stopSpeech();
    hideAiNotice();
    state.narrExpanded = false;
    setNarrClamp(0);
    updateNarrMore(false);
    if (!state.narration) return;
    renderNarrationHead(state.narration);
    els.docentExhibit.textContent = currentExhibitId();
    // Analyses opened from a shared link never spend the visitor's AI quota automatically, and an
    // endpoint that just failed (network, CORS, auth, config) is not retried on every new dig.
    const aiWanted = state.prefs.ai && llmReady();
    const failed = aiWanted && aiConfigFailed();
    const runIt = aiWanted && state.aiAuto && !failed && allowAi;
    els.aiToggle.checked = runIt;
    if (runIt) {
      runAi();
      return;
    }
    if (failed) showAiNotice(tr('ai.noticeFailed'));
    else if (aiWanted && !state.aiAuto) showAiNotice(tr('ai.noticeShared'));
    else if (aiWanted) showAiNotice(tr('ai.noticeLangSwitch'));
    typeNarration(state.narration, animate);
  }

  // provider|baseUrl|model of the saved AI config, used to remember an endpoint that failed.
  function aiConfigKey() {
    const c = loadLlmConfig();
    return [c.provider || 'none', c.baseUrl || '', c.model || ''].join('|');
  }

  function aiConfigFailed() {
    return !!state.ai.failedKey && state.ai.failedKey === aiConfigKey();
  }

  function typeNarration(narration, animate) {
    stopTypewriter();
    state.narrMode = 'template';
    const body = state.narrBody;
    if (!body) return;
    body.textContent = '';
    const secs = (narration.sections || []).filter((s) => s && (s.text || s.heading)).map((s) => {
      const paras = parseMini(s.text);
      return { heading: s.heading || '', paras, len: miniLength(paras), el: null, textEl: null };
    });
    const mount = (sec) => {
      if (sec.el) return;
      sec.textEl = h('div', { class: 'narr-sec__text' });
      sec.el = h('section', { class: 'narr-sec' }, sec.heading ? h('h4', null, sec.heading) : null, sec.textEl);
      body.append(sec.el);
    };
    const renderAll = () => {
      secs.forEach((sec) => { mount(sec); renderMini(sec.textEl, sec.paras); });
    };

    if (!animate || !secs.length) {
      renderAll();
      els.narration.setAttribute('aria-busy', 'false');
      updateDocentIdentity(() => tr('docent.status.done'));
      updateDocentSticky();
      return;
    }

    const total = secs.reduce((a, s) => a + s.len, 0);
    // Aim for ~7 s regardless of length, but never slower than ~45 chars/s or faster than ~400 chars/s.
    const rate = clamp(total / 7000, 0.045, 0.4);
    const t0 = now();
    let idx = 0;
    let offset = 0; // characters before section idx
    const caret = h('span', { class: 'caret', 'aria-hidden': 'true' });
    els.narration.setAttribute('aria-busy', 'true');
    els.skipType.hidden = false;
    els.docentAvatar.classList.add('is-talking');
    updateDocentIdentity(() => tr('docent.status.talking'));

    const typer = {
      raf: 0,
      finish() {
        cancelAnimationFrame(typer.raf);
        caret.remove();
        renderAll();
        typer.end();
      },
      end() {
        if (state.typer !== typer) return;
        state.typer = null;
        els.narration.setAttribute('aria-busy', 'false');
        els.skipType.hidden = true;
        if (!state.speaking) els.docentAvatar.classList.remove('is-talking');
        updateDocentIdentity(() => tr('docent.status.done'));
        updateDocentSticky();
      },
    };
    const frame = () => {
      if (state.typer !== typer) return;
      const target = Math.floor((now() - t0) * rate);
      while (idx < secs.length && target >= offset + secs[idx].len) {
        mount(secs[idx]);
        renderMini(secs[idx].textEl, secs[idx].paras);
        offset += secs[idx].len;
        idx += 1;
      }
      if (idx >= secs.length) {
        caret.remove();
        typer.end();
        return;
      }
      const sec = secs[idx];
      mount(sec);
      renderMini(sec.textEl, sec.paras, target - offset);
      const lastP = sec.textEl.lastElementChild || sec.textEl;
      lastP.append(caret);
      typer.raf = requestAnimationFrame(frame);
    };
    state.typer = typer;
    typer.raf = requestAnimationFrame(frame);
  }

  function stopTypewriter() {
    const t = state.typer;
    if (!t) return;
    cancelAnimationFrame(t.raf);
    state.typer = null;
    els.skipType.hidden = true;
    els.narration.setAttribute('aria-busy', 'false');
    if (!state.speaking) els.docentAvatar.classList.remove('is-talking');
  }

  function currentNarrationText() {
    if (state.narrMode === 'ai' && state.ai.text.trim()) return stripMarkup(state.ai.text);
    return narrationPlainText(state.narration);
  }

  function currentReport() {
    if (!state.view) return '';
    const narrationText = state.narrMode === 'ai' && state.ai.text.trim() ? state.ai.text : narrationPlainText(state.narration);
    return buildMarkdownReport({
      view: state.view, narrationText, exhibitId: currentExhibitId(), date: new Date(),
      engineBest: state.result ? state.result.best : null, locale: currentLocale(),
    });
  }

  function showAiNotice(message) {
    els.aiNotice.textContent = message;
    els.aiNotice.hidden = false;
  }

  function hideAiNotice() {
    els.aiNotice.hidden = true;
    els.aiNotice.textContent = '';
  }

  // ---------- AI docent ----------

  const AI_PHASES = ['connecting', 'thinking', 'writing'];

  function llmReady() {
    const LLM = mod('LLM');
    try {
      return !!(LLM && typeof LLM.isReady === 'function' && LLM.isReady());
    } catch (_) {
      return false;
    }
  }

  function updateAiToggle() {
    const ready = llmReady();
    els.aiToggleWrap.hidden = !ready;
    els.aiToggle.checked = ready && state.prefs.ai && !aiConfigFailed();
  }

  function onAiToggle() {
    state.prefs.ai = els.aiToggle.checked;
    // Re-toggling is the visitor asking for another try.
    state.ai.failedKey = '';
    savePrefs();
    if (!state.view || !state.narration) return;
    if (state.prefs.ai) {
      state.aiAuto = true;
      startNarration();
    } else {
      abortAi();
      hideAiNotice();
      renderNarrationHead(state.narration);
      typeNarration(state.narration, false);
    }
  }

  function abortAi() {
    const ai = state.ai;
    ai.runId += 1; // any in-flight callbacks from the old run become no-ops
    if (ai.controller) {
      try { ai.controller.abort(); } catch (_) { /* ignore */ }
    }
    ai.controller = null;
    ai.userStopped = false;
    els.stopAi.hidden = true;
  }

  async function runAi() {
    const LLM = mod('LLM');
    const view = state.view;
    if (!LLM || typeof LLM.narrate !== 'function' || !view) {
      typeNarration(state.narration, motionOn());
      return;
    }
    abortAi();
    stopTypewriter();
    const ai = state.ai;
    const runId = ai.runId;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    ai.controller = controller;
    ai.text = '';
    ai.userStopped = false;
    state.narrMode = 'ai';

    const body = state.narrBody;
    body.textContent = '';
    const locale = currentLocale();
    const box = h('div', { class: 'narr-ai' }, h('p', null, tr('ai.preparing')));
    body.append(box);
    els.stopAi.hidden = false;
    els.narration.setAttribute('aria-busy', 'true');
    els.docentAvatar.classList.add('is-talking');
    updateDocentIdentity(() => tr('ai.live'));

    let facts = null;
    try {
      const Narrator = mod('Narrator');
      facts = Narrator && typeof Narrator.factsFor === 'function' ? Narrator.factsFor(view, { locale }) : null;
    } catch (_) { facts = null; }

    let paintQueued = false;
    const caret = h('span', { class: 'caret', 'aria-hidden': 'true' });
    // Optional progress phases (llm.js extension); the placeholder only shows until text arrives.
    const onStatus = (phase, detail) => {
      if (runId !== ai.runId) return;
      if (phase === 'fallback') {
        const to = detail && detail.to ? tr('ai.serverFallbackTo', { to: detail.to }) : '';
        showAiNotice(tr('ai.serverFallback', { to }));
        return;
      }
      if (AI_PHASES.includes(phase) && !ai.text) {
        box.textContent = '';
        box.append(h('p', null, tr(`ai.phase.${phase}`)));
        updateDocentIdentity(() => tr(`ai.phase.${phase}`));
      }
    };
    const paint = () => {
      paintQueued = false;
      if (runId !== ai.runId) return;
      renderMarkdownLite(box, ai.text);
      (box.lastElementChild || box).append(caret);
    };

    try {
      const res = await LLM.narrate(view, {
        style: state.style,
        locale,
        narration: state.narration,
        facts,
        signal: controller ? controller.signal : undefined,
        onStatus,
        onText(delta, full) {
          if (runId !== ai.runId) return;
          ai.text = typeof full === 'string' ? full : ai.text + (delta || '');
          if (!paintQueued) {
            paintQueued = true;
            requestAnimationFrame(paint);
          }
        },
      });
      if (runId !== ai.runId) return;
      const text = res && typeof res.text === 'string' && res.text.trim() ? res.text : ai.text;
      if (!text.trim()) {
        const err = new Error(tr('ai.empty'));
        err.code = 'bad_response';
        throw err;
      }
      ai.text = text;
      renderMarkdownLite(box, text);
      const who = [providerName(res && res.provider), res && res.model].filter(Boolean).join(' · ');
      body.append(h('p', { class: 'narr-foot' }, tr('ai.foot', { who: who || 'AI' })));
      if (isTruncatedStop(res && res.stopReason)) {
        // max_tokens / length: the docent was cut off mid-sentence; do not present it as complete.
        showAiNotice(tr('ai.truncated'));
        updateDocentIdentity(() => tr('ai.truncatedStatus'));
      } else {
        updateDocentIdentity(() => tr('ai.done'));
      }
    } catch (err) {
      if (runId !== ai.runId) return;
      const aborted = err && (err.code === 'aborted' || err.name === 'AbortError');
      if (aborted && ai.userStopped && ai.text.trim()) {
        renderMarkdownLite(box, ai.text);
        showAiNotice(tr('ai.stoppedPartial'));
        updateDocentIdentity(() => tr('ai.stoppedStatus'));
      } else {
        ai.text = '';
        if (!aborted && aiFailureBlocksRetry(err)) {
          // Retrying the same endpoint on every dig would fail the same way.
          state.ai.failedKey = aiConfigKey();
          els.aiToggle.checked = false;
        }
        showAiNotice(aborted ? tr('ai.stoppedFallback') : aiErrorMessage(err));
        typeNarration(state.narration, motionOn());
      }
    } finally {
      if (runId === ai.runId) {
        ai.controller = null;
        els.stopAi.hidden = true;
        if (!state.typer) {
          els.narration.setAttribute('aria-busy', 'false');
          if (!state.speaking) els.docentAvatar.classList.remove('is-talking');
          updateDocentSticky();
        }
      }
    }
  }

  // ---------- speech ----------

  function updateVoiceButton() {
    const supported = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function';
    els.speakBtn.hidden = !state.prefs.voice || !supported;
    if (els.speakBtn.hidden && state.speaking) stopSpeech();
  }

  function pickVoice(synth, speechLang) {
    let voices = [];
    try { voices = synth.getVoices() || []; } catch (_) { voices = []; }
    if (/^en/i.test(speechLang)) {
      return voices.find((v) => /^en[-_]US/i.test(v.lang))
        || voices.find((v) => /^en/i.test(v.lang))
        || null;
    }
    return voices.find((v) => /^zh[-_](CN|Hans)/i.test(v.lang))
      || voices.find((v) => /^zh/i.test(v.lang))
      || null;
  }

  function speakText(text) {
    const synth = window.speechSynthesis;
    if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') {
      toast(tr('speech.unsupported'));
      return;
    }
    const locale = currentLocale();
    const speechLang = localeInfo(locale).speech || locale;
    const chunks = splitForSpeech(text, 160, locale);
    if (!chunks.length) {
      toast(tr('speech.empty'));
      return;
    }
    try { synth.cancel(); } catch (_) { /* ignore */ }
    const id = ++state.speechId;
    const voice = pickVoice(synth, speechLang);
    const done = () => { if (id === state.speechId) setSpeaking(false); };
    chunks.forEach((chunk, i) => {
      const u = new window.SpeechSynthesisUtterance(chunk);
      u.lang = speechLang;
      if (voice) u.voice = voice;
      u.rate = 1.02;
      if (i === chunks.length - 1) u.onend = done;
      u.onerror = done;
      synth.speak(u);
    });
    setSpeaking(true);
  }

  function stopSpeech() {
    state.speechId += 1;
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (_) { /* ignore */ }
    setSpeaking(false);
  }

  function setSpeaking(on) {
    state.speaking = on;
    els.speakBtn.textContent = tr(on ? 'docent.speakStop' : 'docent.speak');
    els.speakBtn.setAttribute('aria-pressed', String(on));
    if (on) els.docentAvatar.classList.add('is-talking');
    else if (!state.typer && !state.ai.controller) els.docentAvatar.classList.remove('is-talking');
  }

  // ---------- history (我的展柜) ----------

  function loadHistory() {
    const list = readJson(HISTORY_KEY, []);
    return Array.isArray(list)
      ? list.filter((x) => x && typeof x.input === 'string' && x.input && Number.isFinite(x.ts) && x.ts > 0 && x.ts < 8.64e15).slice(0, HISTORY_LIMIT)
      : [];
  }

  function pushHistory(result) {
    const best = result.best;
    // An irrecoverable relic's best output is its placeholders, not a rescue: show the verdict.
    const rescued = best && typeof best.output === 'string' && result.status !== 'irrecoverable';
    const entry = {
      input: safeSlice(result.input, HISTORY_INPUT_CAP),
      output: rescued ? truncate(best.output, 300) : '',
      status: result.status,
      label: (best && best.label) || copyFor(result.status).label,
      exhibitId: currentExhibitId(),
      ts: Date.now(),
    };
    const list = loadHistory().filter((x) => x.input !== entry.input);
    list.unshift(entry);
    writeJson(HISTORY_KEY, list.slice(0, HISTORY_LIMIT));
    renderHistory();
  }

  function renderHistory() {
    const list = loadHistory();
    els.historyList.textContent = '';
    els.historyEmpty.hidden = list.length > 0;
    els.historyClear.hidden = list.length === 0;
    const t = Date.now();
    list.forEach((item) => {
      const status = normalizeStatus(item.status);
      const statusLabel = copyFor(status).label;
      const btn = h('button', {
        type: 'button',
        class: 'cab-card',
        'aria-label': tr('cabinet.reopen', {
          id: item.exhibitId || '',
          input: truncate(item.input, 30),
          output: item.output ? ` → ${truncate(item.output, 30)}` : '',
          label: statusLabel,
        }),
        onclick: () => {
          els.relicInput.value = item.input;
          updateCount();
          startExcavation(item.input, { source: 'history' });
        },
      },
      h('span', { class: `cab-card__dot cab-card__dot--${status}`, 'aria-hidden': 'true' }),
      h('span', { class: 'cab-card__in' }, truncate(item.input, 60)),
      h('span', { class: 'cab-card__out' }, item.output ? truncate(item.output, 60) : statusLabel),
      h('span', { class: 'cab-card__meta' }, h('span', null, item.exhibitId || ''), h('time', { datetime: new Date(item.ts).toISOString() }, relativeTime(item.ts, t))));
      els.historyList.append(h('li', null, btn));
    });
  }

  function onHistoryClear() {
    // Two-step confirmation without a blocking dialog.
    if (!state.clearArmed) {
      state.clearArmed = setTimeout(() => {
        state.clearArmed = 0;
        els.historyClear.textContent = tr('cabinet.clear');
      }, 3500);
      els.historyClear.textContent = tr('cabinet.clearConfirm');
      return;
    }
    clearTimeout(state.clearArmed);
    state.clearArmed = 0;
    els.historyClear.textContent = tr('cabinet.clear');
    try {
      const s = storage();
      if (s) s.removeItem(HISTORY_KEY);
    } catch (_) { /* ignore */ }
    renderHistory();
    toast(tr('cabinet.cleared'));
    // The clear button just hid itself: keep focus where it was instead of jumping to the top.
    els.historyEmpty.tabIndex = -1;
    els.historyEmpty.focus({ preventScroll: true });
  }

  // ---------- forge (赝品工坊) ----------

  function encodingChoices() {
    const Codecs = mod('Codecs');
    const list = Codecs && Array.isArray(Codecs.ENCODINGS) ? Codecs.ENCODINGS.filter((e) => e && e.id && e.available !== false) : [];
    if (list.length) return list.map((e) => ({ id: e.id, name: e.name || e.id, desc: encDesc(e.id) || '' }));
    return FALLBACK_ENCODINGS.map(([id, name]) => ({ id, name, desc: '' }));
  }

  function encodingSelect(value, labelText, cls, onChange) {
    const sel = h('select', { class: cls, 'aria-label': labelText, onchange: onChange });
    const choices = encodingChoices();
    if (value && !choices.some((c) => c.id === value)) choices.unshift({ id: value, name: encName(value), desc: '' });
    for (const c of choices) sel.append(h('option', { value: c.id, title: c.desc || null }, c.name));
    sel.value = value;
    return sel;
  }

  // Recipes in the current language (Forge.presets(locale), §11.3); chains and samples are data.
  function forgePresets() {
    const Forge = mod('Forge');
    if (!Forge) return [];
    const loc = currentLocale();
    let list = null;
    if (typeof Forge.presets === 'function') {
      try { list = Forge.presets(loc); } catch (_) { list = null; }
    }
    if (!Array.isArray(list)) list = Array.isArray(Forge.PRESETS) ? localizeRecords(Forge.PRESETS, ['name', 'story'], loc) : [];
    return list.filter((p) => p && p.id && Array.isArray(p.chain) && p.chain.length);
  }

  // (Re)fills the recipe select, keeping the current choice.
  function fillPresetSelect() {
    const presets = forgePresets();
    const keep = els.forgePreset.value;
    els.forgePreset.textContent = '';
    els.forgePreset.append(h('option', { value: '' }, tr('forge.custom')));
    presets.forEach((p) => els.forgePreset.append(h('option', { value: p.id }, p.name || p.id)));
    els.forgePreset.value = presets.some((p) => p.id === keep) ? keep : '';
    return presets;
  }

  function setupForge() {
    const Forge = mod('Forge');
    const presets = fillPresetSelect();

    els.forgePreset.addEventListener('change', () => {
      const p = forgePresets().find((x) => x.id === els.forgePreset.value);
      if (p) applyPreset(p, true);
      else markCustom();
    });
    els.forgeAddLayer.addEventListener('click', () => {
      if (state.forgeLayers.length >= 3) return;
      state.forgeLayers.push({ encoding: 'utf-8', misreadAs: 'windows-1252' });
      markCustom();
      renderForgeLayers();
      const selects = els.forgeLayers.querySelectorAll('select');
      if (selects.length) selects[selects.length - 2].focus();
    });
    els.forgeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      runForge();
    });
    els.forgeCopy.addEventListener('click', () => copyWithToast(els.forgeOutput.value, tr('forge.copied')));
    els.forgeSend.addEventListener('click', () => {
      const out = els.forgeOutput.value;
      if (!out) return;
      els.relicInput.value = out;
      updateCount();
      startExcavation(out, { source: 'forge' });
    });

    if (!Forge || typeof Forge.corrupt !== 'function') {
      state.forgeLast = { kind: 'missing' };
      showForgeError(tr('forge.missing'));
    }

    if (presets.length) {
      els.forgePreset.value = presets[0].id;
      applyPreset(presets[0], true);
    } else {
      els.forgeText.value = tr('forge.sample');
      state.forgeLayers = [{ encoding: 'utf-8', misreadAs: 'windows-1252' }];
      state.forgeStoryKey = 'forge.noPresets';
      els.forgeStory.textContent = tr(state.forgeStoryKey);
      renderForgeLayers();
    }
  }

  // Any hand edit turns the recipe into a custom one; the preset's story no longer applies.
  function markCustom() {
    els.forgePreset.value = '';
    state.forgeStoryKey = 'forge.customStory';
    els.forgeStory.textContent = tr(state.forgeStoryKey);
  }

  function applyPreset(p, fillSample) {
    if (fillSample && typeof p.sample === 'string' && p.sample) els.forgeText.value = p.sample;
    state.forgeLayers = p.chain.slice(0, 3).map((l) => ({ encoding: l.encoding, misreadAs: l.misreadAs }));
    const opts = p.opts || {};
    els.forgeDrop.checked = !!opts.dropInvisible;
    els.forgeNbsp.checked = !!opts.nbspToSpace;
    state.forgeStoryKey = null;
    els.forgeStory.textContent = p.story || '';
    renderForgeLayers();
  }

  function showForgeError(message) {
    els.forgeError.textContent = message;
    els.forgeError.hidden = false;
  }

  // Language switch: recipe names and story, layer labels, and the last result or error.
  function relocalizeForge() {
    const presets = fillPresetSelect();
    const p = presets.find((x) => x.id === els.forgePreset.value);
    if (p) els.forgeStory.textContent = p.story || '';
    else els.forgeStory.textContent = tr(state.forgeStoryKey || 'forge.customStory');
    renderForgeLayers();
    const last = state.forgeLast;
    if (!last) return;
    if (last.kind === 'run' && (!els.forgeOutputWrap.hidden || !els.forgeError.hidden)) runForge(last);
    else if (last.kind === 'missing' || last.kind === 'needText') {
      if (!els.forgeError.hidden) showForgeError(tr(last.kind === 'missing' ? 'forge.missing' : 'forge.needText'));
    }
  }

  function renderForgeLayers() {
    const list = els.forgeLayers;
    list.textContent = '';
    state.forgeLayers.forEach((layer, i) => {
      const onFrom = (e) => { state.forgeLayers[i].encoding = e.target.value; markCustom(); };
      const onTo = (e) => { state.forgeLayers[i].misreadAs = e.target.value; markCustom(); };
      const remove = h('button', {
        type: 'button',
        class: 'btn btn--ghost btn--small forge-layer__remove',
        'aria-label': tr('forge.removeLayer', { n: i + 1 }),
        title: tr('forge.removeLayer', { n: i + 1 }),
        disabled: state.forgeLayers.length <= 1,
        onclick: () => {
          state.forgeLayers.splice(i, 1);
          markCustom();
          renderForgeLayers();
          els.forgeAddLayer.focus();
        },
      }, '×');
      list.append(h('li', { class: 'forge-layer' },
        h('span', { class: 'forge-layer__no' }, tr('forge.layerNo', { n: i + 1 })),
        encodingSelect(layer.encoding, tr('forge.layerFrom', { n: i + 1 }), 'forge-layer__from', onFrom),
        h('span', { class: 'forge-layer__arrow', 'aria-hidden': 'true' }, tr('forge.arrow')),
        encodingSelect(layer.misreadAs, tr('forge.layerTo', { n: i + 1 }), 'forge-layer__to', onTo),
        remove));
    });
    els.forgeAddLayer.disabled = state.forgeLayers.length >= 3;
  }

  // replay: the inputs of an earlier run, re-rendered quietly in the current language.
  function runForge(replay) {
    const Forge = mod('Forge');
    els.forgeError.hidden = true;
    if (!Forge || typeof Forge.corrupt !== 'function') {
      state.forgeLast = { kind: 'missing' };
      showForgeError(tr('forge.missing'));
      return;
    }
    const text = replay ? replay.text : els.forgeText.value;
    if (!text) {
      state.forgeLast = { kind: 'needText' };
      showForgeError(tr('forge.needText'));
      els.forgeText.focus();
      return;
    }
    const chain = replay ? replay.chain : state.forgeLayers.map((l) => ({ encoding: l.encoding, misreadAs: l.misreadAs }));
    const opts = replay ? replay.opts : { dropInvisible: els.forgeDrop.checked, nbspToSpace: els.forgeNbsp.checked };
    state.forgeLast = { kind: 'run', text, chain, opts };
    let res;
    try {
      res = Forge.corrupt(text, chain, Object.assign({}, opts, { locale: currentLocale() }));
    } catch (err) {
      res = { ok: false, error: err && err.message ? err.message : String(err) };
    }
    if (!res || !res.ok) {
      const where = res && Number.isInteger(res.layerIndex) ? tr('forge.layerFailed', { n: res.layerIndex + 1 }) : '';
      showForgeError(tr('forge.failed', { where, error: (res && res.error) || tr('common.unknownReason') }));
      els.forgeOutputWrap.hidden = true;
      return;
    }
    els.forgeOutput.value = res.output;
    els.forgeTrace.textContent = '';
    (res.layers || []).forEach((l, i) => {
      els.forgeTrace.append(h('li', null,
        tr('forge.trace', { n: i + 1, from: encName(l.encoding), to: encName(l.misreadAs) }),
        h('code', null, truncate(l.output, 48))));
    });
    els.forgeOutputWrap.hidden = false;
    if (!replay) announce(tr('forge.ready', { output: truncate(res.output, 40) }));
  }

  // ---------- settings drawer ----------

  function normalizeProvider(p) {
    if (!p || !p.id || p.id === 'none') return null;
    const models = Array.isArray(p.models)
      ? p.models.map((m) => (typeof m === 'string' ? m : m && (m.id || m.name))).filter(Boolean)
      : [];
    return {
      id: String(p.id),
      name: p.name || String(p.id),
      needsKey: p.needsKey !== false,
      defaultBaseUrl: p.defaultBaseUrl != null ? p.defaultBaseUrl : (p.baseUrl || ''),
      defaultModel: p.defaultModel != null ? p.defaultModel : (p.model || ''),
      models,
    };
  }

  function providerList() {
    const LLM = mod('LLM');
    if (!LLM) return [];
    try {
      if (typeof LLM.listProviders === 'function') {
        const list = LLM.listProviders(currentLocale());
        if (Array.isArray(list)) return list.map(normalizeProvider).filter(Boolean);
      }
    } catch (_) { /* fall back to the static table */ }
    const table = LLM.PROVIDERS && typeof LLM.PROVIDERS === 'object' ? LLM.PROVIDERS : {};
    return Object.keys(table).map((k) => normalizeProvider(Object.assign({ id: k }, table[k]))).filter(Boolean);
  }

  function providerById(id) {
    return providerList().find((p) => p.id === id) || null;
  }

  function providerName(id) {
    const p = id ? providerById(id) : null;
    return p ? p.name : (id || '');
  }

  function setupSettings() {
    els.openSettings.addEventListener('click', openSettings);
    els.closeSettings.addEventListener('click', closeSettings);
    els.settingsDialog.addEventListener('click', (e) => { if (e.target === els.settingsDialog) closeSettings(); });
    els.settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveSettings();
    });
    els.setProvider.addEventListener('change', onProviderChange);
    els.toggleKey.addEventListener('click', () => {
      const show = els.setKey.type === 'password';
      els.setKey.type = show ? 'text' : 'password';
      els.toggleKey.textContent = tr(show ? 'settings.hide' : 'settings.show');
      els.toggleKey.setAttribute('aria-pressed', String(show));
    });
    els.testConn.addEventListener('click', onTestConnection);
    els.clearKey.addEventListener('click', onClearKey);
    els.setKey.addEventListener('input', () => { state.keyFromStore = false; });
    els.setBaseUrl.addEventListener('change', guardKeyForEndpoint);
    // Never keep a revealed key on screen after the drawer closes.
    els.settingsDialog.addEventListener('close', () => {
      els.setKey.type = 'password';
      els.toggleKey.textContent = tr('settings.show');
      els.toggleKey.setAttribute('aria-pressed', 'false');
    });
  }

  /*
   * Test-result line: from the dictionary (re-rendered on a language switch) or raw text.
   * `raw` = { ok, cls } marks a line that quotes llm.js's own message, worded in the language of
   * the test: a language switch replaces it with a short dictionary line instead of re-running
   * the test (no network call, no stale language on screen).
   */
  function setTestResult(key, params, cls, raw) {
    state.testMsg = key ? { key, params: params || null, cls: cls || '' } : null;
    state.testRaw = key && raw ? raw : null;
    els.testResult.textContent = key ? tr(key, params) : '';
    els.testResult.className = cls ? `test-result ${cls}` : 'test-result';
  }

  function setTestResultText(text, cls, raw) {
    state.testMsg = null;
    state.testRaw = text && raw ? raw : null;
    els.testResult.textContent = text;
    els.testResult.className = cls ? `test-result ${cls}` : 'test-result';
  }

  function fillProviderSelect(providers) {
    const value = els.setProvider.value;
    els.setProvider.textContent = '';
    els.setProvider.append(h('option', { value: 'none' }, tr('settings.providerNone')));
    providers.forEach((p) => els.setProvider.append(h('option', { value: p.id }, p.name)));
    return value;
  }

  function fillStyleSelect() {
    els.setStyle.textContent = '';
    stylesList().forEach((s) => els.setStyle.append(h('option', { value: s.id }, s.name || s.id)));
  }

  // Language switch while the drawer is open: relabel options, keep every unsaved value.
  function relabelSettings() {
    const providers = providerList();
    const provider = fillProviderSelect(providers);
    els.setProvider.value = provider && (provider === 'none' || providers.some((p) => p.id === provider)) ? provider : 'none';
    const style = els.setStyle.value;
    fillStyleSelect();
    els.setStyle.value = style || state.style;
    applyProviderUi(providerById(els.setProvider.value), false);
    const msg = state.testMsg;
    const raw = state.testRaw;
    if (raw) setTestResult(raw.ok ? 'settings.testOkStale' : 'settings.testFailStale', null, raw.cls);
    else if (msg) setTestResult(msg.key, msg.params, msg.cls);
    else if (!mod('LLM')) setTestResult('settings.llmMissing');
    else setTestResultText('', '');
  }

  // { modelId: label } in the current language (LLM.modelLabels(locale), §11.3).
  function modelLabels() {
    const LLM = mod('LLM');
    if (!LLM) return {};
    const loc = currentLocale();
    try {
      if (typeof LLM.modelLabels === 'function') {
        const m = LLM.modelLabels(loc);
        if (m && typeof m === 'object') return m;
      }
    } catch (_) { /* fall back to the static table */ }
    const base = LLM.MODEL_LABELS && typeof LLM.MODEL_LABELS === 'object' ? LLM.MODEL_LABELS : {};
    if (loc === 'zh-CN') return base;
    // Chinese-only labels: keep the model name, drop the Chinese note.
    const out = {};
    for (const k of Object.keys(base)) {
      const v = String(base[k]).replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
      if (v && !/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(v)) out[k] = v;
    }
    return out;
  }

  function loadLlmConfig() {
    const LLM = mod('LLM');
    try {
      const cfg = LLM && typeof LLM.loadConfig === 'function' ? LLM.loadConfig() : null;
      return cfg && typeof cfg === 'object' ? cfg : { provider: 'none' };
    } catch (_) {
      return { provider: 'none' };
    }
  }

  function fillSettingsForm() {
    const cfg = loadLlmConfig();
    const providers = providerList();
    fillProviderSelect(providers);
    const known = cfg.provider && (cfg.provider === 'none' || providers.some((p) => p.id === cfg.provider));
    els.setProvider.value = known ? cfg.provider : 'none';
    state.settingsProvider = els.setProvider.value;

    els.setKey.value = cfg.apiKey || '';
    state.keyFromStore = !!els.setKey.value;
    els.setRemember.checked = !!cfg.remember;
    els.setBaseUrl.value = cfg.baseUrl || '';
    els.setModel.value = cfg.model || '';
    els.setEffort.value = ['low', 'medium', 'high'].includes(cfg.effort) ? cfg.effort : 'medium';
    applyProviderUi(providerById(els.setProvider.value), false);

    fillStyleSelect();
    els.setStyle.value = state.style;
    els.setAnimation.checked = state.prefs.animation;
    els.setVoice.checked = state.prefs.voice;
    const radio = els.settingsForm.querySelector(`input[name="setTheme"][value="${state.prefs.theme}"]`);
    if (radio) radio.checked = true;
    setTestResult(null);
    if (!mod('LLM')) setTestResult('settings.llmMissing');
  }

  function applyProviderUi(provider, fillDefaults) {
    const none = !provider;
    els.llmFields.classList.toggle('is-disabled', none);
    [els.setKey, els.toggleKey, els.setRemember, els.setBaseUrl, els.setModel, els.setEffort, els.testConn]
      .forEach((el) => { el.disabled = none; });
    // Only Anthropic's API takes an effort setting; the OpenAI-compatible path ignores it.
    const effortless = !none && provider.id !== 'anthropic';
    if (effortless) els.setEffort.disabled = true;
    if (els.effortHint) els.effortHint.hidden = !effortless;
    els.modelList.textContent = '';
    if (none) return;
    const labels = modelLabels();
    provider.models.forEach((m) => els.modelList.append(h('option', { value: m, label: labels[m] || null })));
    if (fillDefaults) {
      els.setBaseUrl.value = provider.defaultBaseUrl || '';
      els.setModel.value = provider.defaultModel || '';
    }
    els.setBaseUrl.placeholder = provider.defaultBaseUrl || tr('settings.baseUrlPh');
    els.setModel.placeholder = provider.defaultModel || tr('settings.modelPh');
    els.setKey.placeholder = tr(provider.needsKey ? 'settings.keyPh' : 'settings.keyOptionalPh');
  }

  function settingsFormFields() {
    return {
      provider: state.settingsProvider,
      apiKey: els.setKey.value,
      baseUrl: els.setBaseUrl.value,
      model: els.setModel.value,
    };
  }

  function onProviderChange() {
    // A key typed for one provider never follows the form to another provider's endpoint;
    // URL/model are replaced only when the visitor had not customised them.
    const next = providerSwitchForm(settingsFormFields(), els.setProvider.value, providerList(), loadLlmConfig());
    applyProviderUi(providerById(next.provider), false);
    els.setKey.value = next.apiKey;
    els.setBaseUrl.value = next.baseUrl;
    els.setModel.value = next.model;
    state.settingsProvider = els.setProvider.value;
    state.keyFromStore = next.keyRestored;
    setTestResult(next.keyCleared ? 'settings.keyCleared' : null);
  }

  /*
   * The key field still holds the stored key, but the form now points at another host: clear it
   * so it is not sent there. A key the visitor typed in this drawer is theirs to send.
   */
  function guardKeyForEndpoint() {
    if (!state.keyFromStore) return false;
    const form = Object.assign(settingsFormFields(), { provider: els.setProvider.value || 'none' });
    if (!keyNeedsReentry(form, loadLlmConfig(), providerList())) return false;
    els.setKey.value = '';
    state.keyFromStore = false;
    setTestResult('settings.keyHost', null, 'is-bad');
    return true;
  }

  function readSettingsForm() {
    return {
      provider: els.setProvider.value || 'none',
      apiKey: els.setKey.value.trim(),
      baseUrl: els.setBaseUrl.value.trim(),
      model: els.setModel.value.trim(),
      effort: els.setEffort.value || 'medium',
      remember: els.setRemember.checked,
    };
  }

  function openSettings() {
    fillSettingsForm();
    const dlg = els.settingsDialog;
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
  }

  function closeSettings() {
    const dlg = els.settingsDialog;
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
    els.openSettings.focus();
  }

  async function onTestConnection() {
    const LLM = mod('LLM');
    if (!LLM || typeof LLM.testConnection !== 'function') {
      setTestResult('settings.testNoLlm', null, 'is-bad');
      return;
    }
    if (guardKeyForEndpoint()) {
      els.setKey.focus();
      return;
    }
    const cfg = readSettingsForm();
    els.testConn.disabled = true;
    setTestResult('settings.testing');
    // llm.js words its message in the language the test started in; if the visitor switches
    // meanwhile, show the dictionary verdict in the new language instead.
    const loc = currentLocale();
    try {
      const res = await LLM.testConnection(cfg, loc);
      const ok = !!(res && res.ok);
      const cls = ok ? 'is-ok' : 'is-bad';
      if (res && typeof res.message === 'string' && res.message && currentLocale() === loc) setTestResultText(res.message, cls, { ok, cls });
      else setTestResult(ok ? 'settings.testOk' : 'settings.testFail', null, cls);
    } catch (err) {
      if (err && err.message && currentLocale() === loc) {
        setTestResult('settings.testFailMsg', { message: err.message }, 'is-bad', { ok: false, cls: 'is-bad' });
      } else {
        setTestResult('settings.testFail', null, 'is-bad');
      }
    } finally {
      els.testConn.disabled = els.setProvider.value === 'none';
    }
  }

  // Resets only the AI fields; unsaved edits elsewhere in the drawer (theme, animation…) stay.
  function onClearKey() {
    const LLM = mod('LLM');
    try {
      if (LLM && typeof LLM.clearConfig === 'function') LLM.clearConfig();
    } catch (_) { /* ignore */ }
    els.setProvider.value = 'none';
    els.setKey.value = '';
    els.setBaseUrl.value = '';
    els.setModel.value = '';
    els.setRemember.checked = false;
    applyProviderUi(null, false);
    state.settingsProvider = 'none';
    state.keyFromStore = false;
    state.ai.failedKey = '';
    updateAiToggle();
    setTestResult('settings.cleared', null, 'is-ok');
  }

  function saveSettings() {
    const LLM = mod('LLM');
    if (guardKeyForEndpoint()) {
      els.setKey.focus();
      return;
    }
    const cfg = readSettingsForm();
    const wasReady = llmReady();
    let llmSaved = true;
    // New settings deserve a fresh attempt, even for an endpoint that just failed.
    state.ai.failedKey = '';
    if (LLM && typeof LLM.saveConfig === 'function') {
      try {
        LLM.saveConfig(cfg);
      } catch (err) {
        llmSaved = false;
        toast(tr('settings.saveFailed', { message: err && err.message ? err.message : tr('common.unknownReason') }));
      }
    }

    const themeRadio = els.settingsForm.querySelector('input[name="setTheme"]:checked');
    const prevStyle = state.style;
    state.prefs.style = els.setStyle.value || state.style;
    state.prefs.animation = els.setAnimation.checked;
    state.prefs.voice = els.setVoice.checked;
    state.prefs.theme = themeRadio ? themeRadio.value : 'auto';
    savePrefs();
    applyTheme();
    applyMotionClass();
    updateVoiceButton();
    updateAiToggle();
    closeSettings();
    if (llmSaved) toast(tr(!wasReady && llmReady() ? 'settings.savedAi' : 'settings.saved'));

    if (state.prefs.style !== prevStyle) setStyle(state.prefs.style);
  }

  // ---------- go ----------

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
