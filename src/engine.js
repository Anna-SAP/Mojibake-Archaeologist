/*
 * MBX.Engine — the restoration search ("发掘引擎").
 *
 * Mojibake is text that went through one or more "encode with E, decode with W" accidents.
 * Undoing one layer means: encode the garbled text with the wrong decoder W to get the original
 * bytes back, then decode those bytes with the true encoding E. analyze() searches for the chain
 * of such layers that turns the input into the most plausible text (judged by MBX.Scorer):
 *
 *   1. Pre-pass. Pure ASCII without escape features is clean. Escape layers (%E5%A4%A7, \xE5,
 *      =E5=A4, "E5 A4 A7" hex dumps, \uXXXX, &#22823; / &eacute;) are peeled off first as
 *      "unescape" steps; byte-producing schemes try every true encoding and keep the best decode.
 *   2. Beam search over (W, E) transforms, up to maxDepth layers. A layer is only kept when it
 *      makes the text more plausible. Lossy relics (U+FFFD markers, invisible bytes dropped on
 *      copy & paste, NBSP flattened to a space, deleted replacement characters, '?' left by a
 *      lossy conversion) go through Codecs.decodeUtf8Repair, and repaired characters are then
 *      re-ranked in their textual context.
 *   3. Decision. The best chain must beat the input decisively. Gains are measured per affected
 *      (non-ASCII) code point, so a single "â€™" in a long English sentence still counts while
 *      a lucky shuffle of a few accented letters in normal text never does. Results that are
 *      still mostly U+FFFD are records of loss ('irrecoverable'), not rescues.
 *   4. Long inputs are searched on a sample, then the chain is replayed on the full text; runs
 *      the chain cannot handle are kept as they are (status 'partial').
 *   5. Fallbacks: repair the runs that can be repaired ('partial'), or explain why nothing can be
 *      done ('irrecoverable' / 'unknown'), or declare the input genuine ('clean').
 *
 * All byte facts come from MBX.Codecs (which mirrors the platform TextDecoder), so the engine
 * agrees with whatever browser or Node version it runs in.
 */
(function (root) {
  'use strict';
  const MBX = (root.MBX = root.MBX || {});

  const FFFD = '\uFFFD';
  const LN = Math.log;

  const DEFAULTS = Object.freeze({
    maxDepth: 3,
    beamWidth: 8,
    maxAlternatives: 5,
    sampleLimit: 800,
    allowLossy: true,
    allowEscapes: true,
    allowPartial: true,
    encodings: null,
  });

  /*
   * Tuning knobs. The ranking currency "u" is the plausibility gained over the input (see
   * rankFit / gainOf), rescaled to "per affected code point", minus penalties for depth, rare
   * accidents, repairs and errors. Values were tuned on tests/corpus.test.js (accuracy) and on
   * the clean texts there and in tests/engine.test.js (no false positives).
   */
  const TUNE = {
    GAIN_MIN: 0.5, // a restoration must gain at least this much per affected code point
    ABS_MIN: -5.5, // ...and the restored text itself must reach this plausibility (ScoreInfo.value)
    DEPTH_W: 0.3, // cost of every transcode layer beyond the first
    PRIOR_W: 0.3, // weight of ln(PAIR_PRIORS) — a tie-breaker, not a verdict
    REPAIR_COST: { gap: 0.6, dropped: 0.4, nbsp: 0.15 }, // log-likelihood cost per repaired character
    ERROR_COST: 1.5, // extra cost per decoding error the chain introduces
    FFFD_COST: 8, // log-likelihood cost of one U+FFFD a chain adds as a decoding error
    FFFD_CHAR: -4, // a U+FFFD counts as one poor character in the ranking total
    LOST_SHARE: 0.4, // a "restoration" that is still this much U+FFFD is a record of loss, not a rescue
    LOST_COST: 2.5, // cost of a U+FFFD that admits a loss the input had hidden (withdrawn guess)
    CJK_GUESS_MARGIN: 0.5, // a Han/kana/Hangul guessed from one unknown byte must win by this much
    CJK_GUESS_CONF: 0.8, // ...and a result holding such a guess is at most this confident
    GAP_GUESS_MARGIN: 0.4, // ...and any other character filled into a U+FFFD gap
    DROP_GUESS_MARGIN: 0.3, // ...and a character completed with swallowed invisible bytes
    HEAVY_CORE_MIN: -3.0, // heavily damaged results stay 'partial' only if what survived reads well
    EVIDENCE_N0: 2, // shrinks gains measured on very few non-ASCII characters
    ERROR_SHARE: 0.25, // a UTF-8 decode may leave at most this share of its non-ASCII output broken
    ESC_BASE: 2, // u of a credible escape layer on its own (it is deterministic evidence)
    ESC_ABS_MIN: -4.5, // plausibility an unescaped text needs to stand as a result by itself
    PARTIAL_GAIN: 1.0, // per-character gain a run needs before a partial repair touches it
    PARTIAL_MIN_PRIOR: 0.5, // partial repairs only consider the classic accidents
    PARTIAL_ABS: -3.5, // ...and only keep spans that read as plausible text in their context
    FOREIGN_SCRIPT: 4, // repair guesses in a script the surviving text does not use cost this much
    GUESS_MARGIN: 2, // a character guessed from >= 2 unknown bytes must win its context by this much
    FRONTIER_PRIOR_W: 1, // the beam expands well-known accidents first (weight of ln prior)
    RELAY_PRIOR: 0.5, // ...and only classic accidents may relay a non-improving intermediate layer
    MULTI_MIN_PRIOR: 0.3, // every layer of a multi-layer result must be at least this common an accident
    ALT_WINDOW: 4, // alternatives must rank within this distance (in u) of the best reading
    RERANK_TOP: 12, // candidates per repaired character scored in context (charScore order)
    SHORT_N: 4, // inputs with at most this many non-ASCII characters are "short" (see buildHypotheses)
    SHORT_CLASSIC_PRIOR: 0.6, // ...where a classic accident (this common) only competes with
    SHORT_RIVAL_PRIOR: 0.5, // ...one-layer readings at least this common
    WEAK_LEAD: 0.25, // ...a short classic relic restored on a gain below GAIN_MIN must lead #2 by this much
    WEAK_CONF: 0.4, // ...and is reported at most this confident
    CREDIBLE_MIN: 0.25, // a best reading below this confidence is a guess, not a restoration
    TAU: 0.5, // softmax temperature (in u) for confidence
    PLAUS_MID: -4.2, // ScoreInfo.value at which absolute plausibility is 50 %
    PLAUS_K: 1.4,
    WORK_BUDGET: 6e6, // deterministic work budget (decoded bytes + scored characters) per analysis
    TIME_BUDGET_MS: 20000, // last-resort wall-clock guard for pathological inputs (results are still returned)
  };

  /*
   * How common each accident is in the wild (key `${trueEncoding}>${wrongDecoder}`, 0..1).
   * The docs §8 classics are high, plausible-but-rarer accidents are in the middle, and every
   * pair not listed gets DEFAULT_PRIOR. Used for search ordering and as a small tie-breaker.
   */
  const PAIR_PRIORS = Object.freeze({
    // docs §8 classics
    'utf-8>windows-1252': 1.0,
    'utf-8>gbk': 0.9,
    'utf-8>windows-1251': 0.85,
    'gbk>windows-1252': 0.8,
    'utf-8>shift_jis': 0.8,
    'utf-8>iso-8859-1': 0.7,
    'gbk>iso-8859-1': 0.7,
    'shift_jis>windows-1252': 0.7,
    'koi8-r>windows-1251': 0.7,
    'windows-1251>koi8-r': 0.7,
    'big5>gbk': 0.7,
    'gbk>big5': 0.7,
    'big5>windows-1252': 0.65,
    'gbk>cp437': 0.6,
    'utf-8>cp437': 0.6,
    'shift_jis>gbk': 0.6,
    'euc-kr>windows-1252': 0.6,
    'euc-jp>shift_jis': 0.6,
    'windows-1252>utf-8': 0.6,
    'utf-8>macintosh': 0.55,
    'gbk>shift_jis': 0.5,
    'koi8-r>iso-8859-1': 0.45,
    'windows-1252>utf-16le': 0.4, // "Bush hid the facts": ASCII read as UTF-16LE
    // other realistic accidents
    'utf-8>big5': 0.6,
    'utf-8>euc-kr': 0.5,
    'utf-8>euc-jp': 0.45,
    'utf-8>koi8-r': 0.45,
    'utf-8>windows-1250': 0.45,
    'utf-8>windows-1254': 0.4,
    'utf-8>windows-1253': 0.35,
    'utf-8>ibm866': 0.35,
    'utf-8>windows-1255': 0.3,
    'utf-8>windows-1256': 0.3,
    'utf-8>windows-874': 0.3,
    'windows-1251>windows-1252': 0.6,
    'windows-1251>iso-8859-1': 0.45,
    'koi8-r>windows-1252': 0.45,
    'ibm866>windows-1251': 0.45,
    'windows-1251>ibm866': 0.4,
    'ibm866>koi8-r': 0.3,
    'koi8-r>ibm866': 0.3,
    'ibm866>windows-1252': 0.3,
    'big5>iso-8859-1': 0.45,
    'shift_jis>iso-8859-1': 0.45,
    'euc-kr>iso-8859-1': 0.45,
    'euc-jp>windows-1252': 0.45,
    'shift_jis>euc-jp': 0.5,
    'euc-kr>gbk': 0.35,
    'gbk>euc-kr': 0.3,
    'big5>shift_jis': 0.3,
    'shift_jis>big5': 0.3,
    'euc-kr>shift_jis': 0.3,
    'big5>cp437': 0.4,
    'shift_jis>cp437': 0.4,
    // "Windows-1252 served as ISO-8859-1": smart quotes and dashes become C1 controls. Text
    // without C1 characters reads the same either way, so this only decides real C1 cases.
    'windows-1252>iso-8859-1': 0.8,
    'windows-1250>windows-1252': 0.6,
    'windows-1253>windows-1252': 0.35,
    'windows-1254>windows-1252': 0.6,
    'windows-1255>windows-1252': 0.5,
    'windows-1256>windows-1252': 0.3,
    'windows-874>windows-1252': 0.45,
    'macintosh>windows-1252': 0.35,
    'windows-1252>macintosh': 0.35,
    'windows-1252>cp437': 0.35,
    'cp437>windows-1252': 0.3,
    'utf-16le>windows-1252': 0.35,
    'utf-16le>iso-8859-1': 0.25,
    'utf-16be>windows-1252': 0.2,
    'utf-8>utf-16le': 0.2,
    'utf-16le>utf-16be': 0.15,
    'utf-16be>utf-16le': 0.15,
    // the irreversible direction (legacy bytes read as UTF-8): common, but rarely undoable
    'gbk>utf-8': 0.6,
    'big5>utf-8': 0.45,
    'shift_jis>utf-8': 0.45,
    'euc-kr>utf-8': 0.4,
    'iso-8859-1>utf-8': 0.4,
    'windows-1251>utf-8': 0.45,
  });
  const DEFAULT_PRIOR = 0.05;

  // Which encoding the bytes of an escape layer were most likely written in.
  const ESCAPE_PRIORS = {
    'utf-8': 1.0, gbk: 0.6, big5: 0.45, shift_jis: 0.45, 'euc-kr': 0.4, 'euc-jp': 0.35,
    'windows-1252': 0.4, 'iso-8859-1': 0.3, 'windows-1251': 0.35, 'utf-16le': 0.3, 'utf-16be': 0.25,
  };

  // Canonical display names of the escape schemes; app/llm/narrator use the same names.
  const SCHEME_NAMES = {
    percent: 'URL 百分号编码',
    'hex-escape': '\\x 十六进制转义',
    'quoted-printable': 'Quoted-Printable 编码',
    'hex-dump': '十六进制字节串',
    'unicode-escape': '\\u Unicode 转义',
    'html-entity': 'HTML 实体',
  };

  // ---------------------------------------------------------------------------
  // Signatures of famous relics. Byte facts are verified in tests/engine.test.js
  // ---------------------------------------------------------------------------

  const SIG_DEFS = [
    {
      id: 'kunjinkao', title: '锟斤拷', re: /(?:锟斤拷)+/g, bytes: 'EF BF BD EF BF BD', decoder: 'gbk', glyph: '锟斤拷', lost: true,
      note: '两个 U+FFFD（替换字符）的 UTF-8 字节 EF BF BD EF BF BD 被 GBK 两两配对，读成了「锟斤拷」。原文在变成 U+FFFD 的那一刻就已经丢失。',
    },
    {
      id: 'kunjinkao-big5', title: '嚙踝蕭', re: /(?:嚙踝蕭)+/g, bytes: 'EF BF BD EF BF BD', decoder: 'big5', glyph: '嚙踝蕭', lost: true,
      note: '「锟斤拷」的繁体版：U+FFFD 的 UTF-8 字节 EF BF BD 被 Big5 读成「嚙踝蕭」，原文同样已经丢失。',
    },
    {
      id: 'tangtangtang', title: '烫烫烫', re: /烫{2,}/g, bytes: 'CC CC', decoder: 'gbk', glyph: '烫', lost: true,
      note: 'MSVC 调试版把未初始化的栈内存填成 0xCC，两个 0xCC 按 GBK 读出来正是「烫」。这里从来就没有文字。',
    },
    {
      id: 'tuntuntun', title: '屯屯屯', re: /屯{2,}/g, bytes: 'CD CD', decoder: 'gbk', glyph: '屯', lost: true,
      note: 'MSVC 调试版把刚分配、未初始化的堆内存填成 0xCD，0xCDCD 按 GBK 读出来正是「屯」。',
    },
    {
      id: 'qiqiqi', title: '葺葺葺', re: /葺{2,}/g, bytes: 'DD DD', decoder: 'gbk', glyph: '葺', lost: true,
      note: 'MSVC 调试堆把已经释放的内存填成 0xDD，0xDDDD 按 GBK 读出来是「葺」：这是一块被 free 之后又被读取的内存。',
    },
    {
      id: 'utf8-bom-1252', title: 'ï»¿', re: /ï»¿/g, bytes: 'EF BB BF', decoder: 'windows-1252', glyph: 'ï»¿',
      note: 'UTF-8 的字节顺序标记 BOM（EF BB BF）被 Windows-1252 逐字节读成「ï»¿」，常见于用记事本另存的 UTF-8 文件。',
    },
    {
      id: 'utf16-bom', title: 'ÿþ', re: /ÿþ|þÿ/g, bytes: 'FF FE', decoder: 'windows-1252', glyph: 'ÿþ',
      note: 'UTF-16 的字节顺序标记（小端 FF FE / 大端 FE FF）被单字节编码读成「ÿþ」/「þÿ」：这份文件其实是 UTF-16。',
    },
    {
      id: 'utf16-nul', title: '字间夹 NUL', re: /(?:[\x20-\x7e]\x00){3,}|(?:\x00[\x20-\x7e]){3,}/g, bytes: '48 00 69 00', decoder: 'windows-1252', glyph: 'H\u0000i\u0000',
      note: 'UTF-16 文本被当成单字节编码读取：每个英文字母旁边都夹着一个 00 字节，显示成看不见的 NUL。',
    },
    {
      id: 'replacement', title: '成片的 \uFFFD', re: /\uFFFD+/g, lost: true,
      test: (text) => {
        const n = countChar(text, FFFD);
        return n >= 3 || n >= 0.3 * Math.max(1, visibleLength(text));
      },
      note: '替换字符 U+FFFD 表示"这里曾有解码失败的字节"。解码器只留下了一个占位符，原始字节已经不在了。',
    },
    {
      // Runs of '?' standing where words or field values were ("Name: ??", "Hello ????,"), not
      // emphasis glued to a sentence ("真的吗???") or the "a ?? b" operator.
      id: 'question-marks', title: '满屏问号', re: /\?{2,}/g, lost: true,
      find: (text) => {
        const runs = lostQuestionRuns(text);
        if (!runs.length) return null;
        const share = countChar(text, '?') / Math.max(1, visibleLength(text));
        const ok = runs.length >= 2 || runs.some((r) => r.field) || (runs[0].match.length >= 3 && share >= 0.3);
        return ok ? runs[0] : null;
      },
      note: '文字被转换到不支持它的字符集时，每个装不下的字符都被替换成了「?」，原文已经无法推回。',
    },
  ];

  // Public, data-only view of the signature table (the regular expressions stay private).
  const SIGNATURES = Object.freeze(
    SIG_DEFS.map((d) => Object.freeze({
      id: d.id, title: d.title, pattern: d.re.source, bytes: d.bytes || null, decoder: d.decoder || null,
      glyph: d.glyph || null, irrecoverable: !!d.lost, note: d.note,
    })).concat([Object.freeze({
      id: 'notepad-bush', title: 'Bush hid the facts', pattern: null, bytes: '42 75 73 68', decoder: 'utf-16le', glyph: '畂桳',
      irrecoverable: false,
      note: 'Windows XP 记事本用 IsTextUnicode 猜编码，把一段纯 ASCII 英文误判成 UTF-16LE，两个字母拼成一个汉字。',
    })])
  );
  const BUSH_NOTE = SIGNATURES[SIGNATURES.length - 1].note;
  const LOST_SIGS = new Set(SIG_DEFS.filter((d) => d.lost).map((d) => d.id));

  // Mojibake signals strong enough to call an unexplained input "unknown" rather than "clean".
  const STRONG_SIGNALS = new Set([
    'bom', 'utf16-bom', 'utf8-as-1252', 'utf8-as-1251', 'utf8-as-mac', 'sjis-as-1252', 'utf8-as-gbk',
    'utf8-as-sjis', 'half-width-kana', 'cyrillic-case', 'latin1-run', 'kunjinkao', 'kunjinkao-big5',
    'tangtang', 'tuntun', 'fffd', 'c1', 'control', 'pua', 'question-marks',
  ]);

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  /**
   * True once an analysis has used up its work budget. The budget counts work (bytes decoded,
   * characters scored), so identical inputs stop at the same point; the wall-clock deadline is
   * only a safety net. Either way the result says so (stats.budgetHit).
   */
  function overBudget(ctx) {
    if (ctx.budgetHit) return true;
    if (ctx.work > ctx.budget || now() > ctx.deadline) ctx.budgetHit = true;
    return ctx.budgetHit;
  }

  function codecs() {
    if (!MBX.Codecs) throw new Error('MBX.Codecs 尚未加载（请先引入 src/codecs.js）');
    return MBX.Codecs;
  }

  function scorer() {
    if (!MBX.Scorer) throw new Error('MBX.Scorer 尚未加载（请先引入 src/scorer.js）');
    return MBX.Scorer;
  }

  function countChar(s, ch) {
    let n = 0;
    for (let i = s.indexOf(ch); i >= 0; i = s.indexOf(ch, i + ch.length)) n++;
    return n;
  }

  /** Number of code points (a surrogate pair counts once). */
  function cpLength(s) {
    let n = s.length;
    for (let i = 0; i + 1 < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          n--;
          i++;
        }
      }
    }
    return n;
  }

  /** Number of code points >= U+0080. */
  function nonAsciiCount(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) continue;
      if (c >= 0xdc00 && c <= 0xdfff && i > 0) {
        const p = s.charCodeAt(i - 1);
        if (p >= 0xd800 && p <= 0xdbff) continue; // second half of a pair
      }
      n++;
    }
    return n;
  }

  function visibleLength(s) {
    let n = 0;
    for (const ch of s) if (!/\s/.test(ch)) n++;
    return n;
  }

  function allAscii(bytes) {
    for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) return false;
    return true;
  }

  function hasZeroByte(bytes) {
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) return true;
    return false;
  }

  const hasC1 = (s) => /[\u0080-\u009f]/.test(s);
  const BAD_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
  function controlSoup(text) {
    const m = text.match(/[\x00-\x08\x0e-\x1f]/g);
    return !!m && m.length >= 2 && m.length >= 0.1 * text.length;
  }

  function encName(id) {
    const e = codecs().get(id);
    return e ? e.name.split(' / ')[0] : String(id);
  }

  const isUtf16 = (id) => {
    const e = codecs().get(id);
    return !!e && e.type === 'utf16';
  };

  // Does this decoder turn byte 0xA0 into NO-BREAK SPACE (so an NBSP flattened to ' ' was 0xA0)?
  const nbspCache = new Map();
  function nbspFromSpace(W) {
    let v = nbspCache.get(W);
    if (v === undefined) {
      try {
        v = codecs().decode(W, Uint8Array.of(0xa0)).text === '\u00A0';
      } catch (_) {
        v = false;
      }
      nbspCache.set(W, v);
    }
    return v;
  }

  /**
   * Prior of the accident "text in E was read with W". The iso-8859-1 / windows-1252 pair gets a
   * special rule: they usually produce the same text and windows-1252 is the more realistic
   * culprit, unless the garbled text carries C1 controls (only a true Latin-1 decoder shows those).
   */
  function pairPrior(E, W, before) {
    const key = E + '>' + W;
    let p = Object.prototype.hasOwnProperty.call(PAIR_PRIORS, key) ? PAIR_PRIORS[key] : 0;
    if (!p && W === 'iso-8859-1') p = 0.7 * (PAIR_PRIORS[E + '>windows-1252'] || 0);
    if (!p && E === 'iso-8859-1') p = 0.7 * (PAIR_PRIORS['windows-1252>' + W] || 0);
    if (!p) p = DEFAULT_PRIOR;
    if (W === 'iso-8859-1' && before && hasC1(before)) {
      p = Math.max(p, Math.min(1, pairPrior(E, 'windows-1252', null) + 0.05));
    }
    return p;
  }

  function escapePrior(E) {
    return ESCAPE_PRIORS[E] || 0.15;
  }

  function normalizeOptions(options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const int = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
    o.maxDepth = int(o.maxDepth, 1, 4, DEFAULTS.maxDepth);
    o.beamWidth = int(o.beamWidth, 1, 32, DEFAULTS.beamWidth);
    o.maxAlternatives = int(o.maxAlternatives, 0, 20, DEFAULTS.maxAlternatives);
    o.sampleLimit = int(o.sampleLimit, 32, 1e7, DEFAULTS.sampleLimit);
    o.allowLossy = o.allowLossy !== false;
    o.allowEscapes = o.allowEscapes !== false;
    o.allowPartial = o.allowPartial !== false;
    return o;
  }

  /** Per-analysis state: encoding list, caches, counters and the time budget. */
  function makeCtx(opts) {
    const C = codecs();
    const S = scorer();
    let ids = C.ids();
    if (Array.isArray(opts.encodings) && opts.encodings.length) {
      const want = new Set(opts.encodings.map((id) => String(id).toLowerCase()));
      ids = ids.filter((id) => want.has(id));
    }
    const scores = new Map();
    const encCache = new Map();
    const charMemo = new Map();
    // For W = UTF-16 whose bytes are pure ASCII, every ASCII-compatible E reads the same text:
    // decode once with the most plausible one.
    const asciiE = new Map();
    for (const W of ids) {
      let best = null;
      for (const E of ids) {
        if (E === W || isUtf16(E)) continue;
        if (!best || pairPrior(E, W) > pairPrior(best, W)) best = E;
      }
      asciiE.set(W, best);
    }
    return {
      C, S, opts, ids, asciiE,
      explored: 0,
      deadline: now() + TUNE.TIME_BUDGET_MS,
      work: 0,
      budget: TUNE.WORK_BUDGET,
      budgetHit: false,
      altCapable: new Map(),
      affinityMemo: new Map(),
      score(text) {
        let s = scores.get(text);
        if (!s) {
          s = S.score(text);
          if (scores.size < 20000) scores.set(text, s);
        }
        return s;
      },
      encChar(W, ch) {
        let m = encCache.get(W);
        if (!m) encCache.set(W, (m = new Map()));
        let b = m.get(ch);
        if (b === undefined) {
          b = C.encodeChar(W, ch);
          m.set(ch, b);
        }
        return b;
      },
      // Isolated character scores for the repair decoder. Characters that only make sense next
      // to something else (joiners, combining marks, format controls) are demoted here and get
      // their chance in rerankRepairs(), which sees the context.
      charScore(ch) {
        let v = charMemo.get(ch);
        if (v === undefined) {
          v = S.charScore(ch);
          const cp = ch.codePointAt(0);
          if (/[\p{M}\p{Cf}\p{Cc}\p{Zl}\p{Zp}]/u.test(ch) || (cp >= 0xfe00 && cp <= 0xfe0f)) v = Math.min(v, -8);
          // Box drawing reads well in a drawing, never as the character a lost byte belonged to.
          else if (cp >= 0x2500 && cp <= 0x259f) v = Math.min(v, -5);
          charMemo.set(ch, v);
        }
        return v;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // One layer: re-encode with W, decode with E
  // ---------------------------------------------------------------------------

  /*
   * "Units" describe the re-encoded bytes: { bytes, segs, marks }. segs has one Seg per code
   * point of the text (zero-width for markers); marks maps a code point index to
   *   'gap'  — a U+FFFD (or a '?') standing for lost bytes: the UTF-8 repair decoder fills it,
   *            any other decoder copies it through (absorbing the halves of the lost character);
   *   'skip' — a '?' that replaced one byte of a single-byte page: the byte is treated as
   *            swallowed, at a known position;
   *   'pass' — a character W cannot encode (tolerant mode only), copied through unchanged.
   * Decoded Segs may carry `lost: true`: a U+FFFD that admits a loss rather than a decode error.
   *
   * Seg flags in Step.segmentsBefore / segmentsAfter (beyond ch, start, end, error, repaired,
   * candidates):
   *   lost?: true  — a U+FFFD standing for bytes that are gone (always with error: true; it may
   *                  be zero-width, start === end, when the bytes were never there);
   *   kept?: true  — a character this layer left untouched, on both sides of the step: either one
   *                  W cannot encode (zero-width, start === end, never error/lost) or one in a
   *                  span a tolerant / partial layer kept as it was (its normal byte span).
   */

  /** Fast path through Codecs.encode; falls back to encodeSlow() in tolerant mode. */
  function encodeFor(ctx, text, W, o) {
    const C = ctx.C;
    // U+FFFD is a decoder's placeholder for bytes that are gone, never data: re-encoding it as
    // EF BF BD (UTF-8) or FD FF (UTF-16) would turn the loss into invented text.
    if (text.indexOf(FFFD) >= 0) {
      if (!o.lossy && !o.tolerant) return null;
      const g = C.encode(W, text, { gapChars: FFFD });
      if (g.ok) {
        const marks = new Map();
        for (const gap of g.gaps) marks.set(gap.charIndex, o.lossy ? 'gap' : 'pass');
        return withAltForms(ctx, text, W, { bytes: g.bytes, segs: g.segments, marks }, FFFD);
      }
      return o.tolerant ? encodeSlow(ctx, text, W, o.lossy, true, null) : null;
    }
    const r = C.encode(W, text);
    if (r.ok) return withAltForms(ctx, text, W, { bytes: r.bytes, segs: r.segments, marks: null }, null);
    return o.tolerant ? encodeSlow(ctx, text, W, o.lossy, true, null) : null;
  }

  /**
   * Shift_JIS reads both ED/EE (NEC-selected IBM extensions) and FA/FB as the same characters,
   * but encodes them as FA/FB only: text decoded from ED/EE bytes would not get its bytes back.
   * Such units carry the other byte form as units.alt; decodeBest() tries both.
   */
  function withAltForms(ctx, text, W, units, gapChars) {
    let capable = ctx.altCapable.get(W);
    if (capable === undefined) {
      capable = ctx.C.get(W).type === 'double' && ctx.C.encode(W, '', { preferDecodedBytes: true }).altUsed !== undefined;
      ctx.altCapable.set(W, capable);
    }
    if (!capable) return units;
    const a = ctx.C.encode(W, text, gapChars ? { gapChars, preferDecodedBytes: true } : { preferDecodedBytes: true });
    if (a.ok && a.altUsed) units.alt = { bytes: a.bytes, segs: a.segments, marks: units.marks };
    return units;
  }

  /** decodeUnits over units and, if any, their alternative byte form: the better reading wins. */
  function decodeBest(ctx, units, W, E, o) {
    const r = decodeUnits(ctx, units, W, E, o);
    if (!units.alt) return r;
    const r2 = decodeUnits(ctx, units.alt, W, E, o);
    if (!r2) return r;
    if (!r) return r2;
    const d = r2.newErrors - r.newErrors || (r2.lostAdded || 0) - (r.lostAdded || 0) || layerFit(ctx, r.text) - layerFit(ctx, r2.text);
    return d < 0 ? r2 : r;
  }

  /** Encodes one code point at a time so unencodable characters can become markers. */
  function encodeSlow(ctx, text, W, lossy, tolerant, forceGap) {
    // A '?' left by a lossy conversion replaced exactly one byte of a single-byte page: it is a
    // swallowed byte at a known spot ('skip'); in other encodings it is an unknown gap.
    const forcedKind = ctx.C.get(W).type === 'single' ? 'skip' : 'gap';
    let out = new Uint8Array(text.length * 4 + 4);
    let n = 0;
    let ci = 0;
    const segs = [];
    const marks = new Map();
    for (const ch of text) {
      const forced = forceGap !== null && forceGap.has(ci);
      const b = forced || ch === FFFD ? null : ctx.encChar(W, ch);
      if (b) {
        out.set(b, n);
        segs.push({ ch, start: n, end: n + b.length });
        n += b.length;
      } else {
        const kind = forced ? forcedKind : lossy && ch === FFFD ? 'gap' : tolerant ? 'pass' : null;
        if (!kind) return null;
        marks.set(ci, kind);
        segs.push({ ch, start: n, end: n });
      }
      ci++;
    }
    return { bytes: out.slice(0, n), segs, marks };
  }

  /** Error Segs that consumed bytes (zero-width errors and lost-character markers excluded). */
  function newErrorCount(segs, synthetic) {
    let n = 0;
    for (const s of segs) if (s.error && !s.lost && (s.end > s.start || (synthetic && synthetic.has(s.start)))) n++;
    return n;
  }

  /** Drops trailing error Segs caused by cutting a sample in the middle of a character. */
  function trimTail(segs, nBytes) {
    let k = segs.length;
    while (k > 0 && segs[k - 1].error && segs[k - 1].start >= nBytes - 3) k--;
    const kept = k === segs.length ? segs : segs.slice(0, k);
    let errors = 0;
    for (const s of kept) if (s.error) errors++;
    return { segs: kept, errors };
  }

  /**
   * Repairs are for a few damaged spots in real UTF-8, not for text that never was UTF-8:
   * a Latin-1 "café" re-encoded as bytes has one broken sequence per accented letter.
   */
  function repairWorthwhile(bytes, errors, gapCount, canDrop) {
    let leads = 0;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0xc2 && bytes[i] <= 0xf4) leads++;
    // Kana lose their middle byte 0x81 to Windows-1252 copy & paste every time, so a damaged
    // sequence per character is normal there; otherwise breakage must stay occasional.
    return errors <= 2 + (canDrop ? 1 : 0.25) * leads + 2 * gapCount;
  }

  /**
   * Gap positions for bytes that vanished without a trace: a double-byte decoder replaced them
   * with U+FFFD and someone deleted the marker. A truncated sequence lost bytes after it; an
   * orphan continuation byte lost its lead before it.
   */
  function syntheticGaps(segs, bytes, gaps) {
    const have = new Set(gaps.map((g) => g.byteOffset));
    const out = [];
    let orphanEnd = -1;
    for (const s of segs) {
      if (!s.error || s.end <= s.start) continue;
      const b = bytes[s.start];
      if (b >= 0xc2 && b <= 0xf4) {
        if (!have.has(s.end)) {
          have.add(s.end);
          out.push(s.end);
        }
      } else if (b >= 0x80 && b <= 0xbf) {
        if (orphanEnd !== s.start && !have.has(s.start)) {
          have.add(s.start);
          out.push(s.start);
        }
        orphanEnd = s.end;
      }
    }
    return out;
  }

  /** Coarse script of a code point ('neutral' for ASCII, punctuation and symbols). */
  function scriptOf(cp) {
    if (cp < 0x80) return 'neutral';
    if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x3134f)) return 'han';
    if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xff66 && cp <= 0xff9f)) return 'kana';
    if ((cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f)) return 'hangul';
    if ((cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xff65) || (cp >= 0xffe0 && cp <= 0xffef)) return 'cjkp';
    if ((cp >= 0xc0 && cp <= 0x24f) || (cp >= 0x1e00 && cp <= 0x1eff)) return 'latin';
    if ((cp >= 0x370 && cp <= 0x3ff) || (cp >= 0x1f00 && cp <= 0x1fff)) return 'greek';
    if (cp >= 0x400 && cp <= 0x52f) return 'cyrillic';
    if (cp >= 0x590 && cp <= 0x5ff) return 'hebrew';
    if ((cp >= 0x600 && cp <= 0x6ff) || (cp >= 0x750 && cp <= 0x77f)) return 'arabic';
    if (cp >= 0xe00 && cp <= 0xe7f) return 'thai';
    if ((cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf)) return 'emoji';
    if (cp <= 0xbf || (cp >= 0x2000 && cp <= 0x2bff)) return 'neutral';
    return 'other';
  }

  /**
   * Character scorer for one repair job that keeps guesses in the scripts the surviving text
   * uses: two lost bytes of a Chinese character can always be "repaired" into an Arabic letter
   * or an emoji, and Scorer.charScore alone has no reason to object.
   */
  function affinityScore(ctx, segs, W) {
    const foreign = foreignPenalty(segs, W);
    if (!foreign) return ctx.charScore;
    // Memoised per script set: repair decodes score thousands of candidates.
    let memo = ctx.affinityMemo.get(foreign.key);
    if (!memo) ctx.affinityMemo.set(foreign.key, (memo = new Map()));
    return (ch) => {
      let v = memo.get(ch);
      if (v === undefined) {
        v = ctx.charScore(ch) - foreign(ch);
        memo.set(ch, v);
      }
      return v;
    };
  }

  /**
   * ch -> extra cost of a repair guess in a script the surviving text does not use (null when
   * nothing is known). With no surviving letters at all, a CJK code page as the wrong decoder
   * says the text was CJK (or Latin, when ASCII letters dominate what is left).
   */
  function foreignPenalty(segs, W) {
    const scripts = new Set();
    let ascii = 0;
    let n = 0;
    for (const s of segs) {
      if (s.error || s.repaired) continue;
      n++;
      const cp = s.ch.codePointAt(0);
      if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) ascii++;
      scripts.add(scriptOf(cp));
    }
    scripts.delete('neutral');
    if (!scripts.size) {
      if (!W || !CJK_CODEPAGES.has(W)) return null;
      if (n && ascii >= 0.5 * n) scripts.add('latin');
      else for (const sc of ['han', 'kana', 'hangul', 'cjkp']) scripts.add(sc);
    }
    const cjk = scripts.has('han') || scripts.has('kana') || scripts.has('hangul') || scripts.has('cjkp');
    const fn = (ch) => {
      const sc = scriptOf(ch.codePointAt(0));
      if (sc === 'neutral' || scripts.has(sc)) return 0;
      if (cjk && (sc === 'cjkp' || (sc === 'han' && scripts.has('kana')))) return 0;
      return TUNE.FOREIGN_SCRIPT;
    };
    fn.key = Array.from(scripts).sort().join(',');
    return fn;
  }

  function segsText(segs) {
    let t = '';
    for (const s of segs) t += s.ch;
    return t;
  }

  /**
   * UTF-8 decode through Codecs.decodeUtf8Repair. On the surface layer (where copy & paste
   * damage happens) it also considers swallowed invisible bytes, NBSP flattened to a space and
   * deleted U+FFFD markers; deeper layers only fill the U+FFFD markers they inherited.
   */
  function repairUtf8(ctx, bytes, gaps, W, o, plainSegs) {
    const C = ctx.C;
    const info = C.get(W);
    const surface = o.surface !== false;
    const charScore = affinityScore(ctx, plainSegs, W);
    // Characters that vanish on copy & paste are C1 controls / undefined bytes of single-byte
    // code pages; the C1 singles some multi-byte decoders expose are not a real-world loss.
    const dropped = surface && info.type === 'single' ? info.invisible || [] : [];
    const nbsp = surface && nbspFromSpace(W);
    const attempt = (useNbsp, gapList, synthetic) => {
      const r = C.decodeUtf8Repair(bytes, gapList, {
        // The search ranks with the likeliest candidates; replays (tolerant) see all of them.
        charScore, droppedBytes: dropped, nbspFromSpace: useNbsp, maxCandidates: o.tolerant ? 64 : TUNE.RERANK_TOP,
      });
      return { r, errs: newErrorCount(r.segments, synthetic), synthetic };
    };
    let best = attempt(nbsp, gaps, null);
    // A space where a continuation byte belongs is either a flattened NBSP or a real space after
    // a swallowed byte ("문자 인" read as Windows-1252 loses 0x90 before the space).
    if (nbsp && dropped.length && best.r.repairs.some((rp) => rp.reason === 'nbsp')) {
      const alt = attempt(false, gaps, null);
      if (alt.errs < best.errs || (alt.errs === best.errs &&
        ctx.S.score(segsText(alt.r.segments)).total > ctx.S.score(segsText(best.r.segments)).total)) best = alt;
    }
    if (best.errs && surface && info.type === 'double') {
      const extra = syntheticGaps(best.r.segments, bytes, gaps);
      if (extra.length) {
        const synthetic = new Set(extra);
        const all = gaps.concat(extra.map((off) => ({ byteOffset: off, ch: FFFD }))).sort((a, b) => a.byteOffset - b.byteOffset);
        const alt = attempt(nbsp, all, synthetic);
        if (alt.errs < best.errs) {
          // Nothing visible marked these gaps: the repairs fill "nothing".
          for (const rp of alt.r.repairs) {
            const seg = alt.r.segments[rp.index];
            if (rp.reason !== 'gap' || !seg) continue;
            for (const off of synthetic) {
              if (off >= seg.start && off <= seg.end) {
                rp.from = '';
                break;
              }
            }
          }
          best = alt;
        }
      }
    }
    const r = best.r;
    return { segs: r.segments, repairs: r.repairs, newErrors: best.errs, lossy: r.repairs.length > 0 || gaps.length > 0 };
  }

  function decodeUtf8Run(ctx, runBytes, gaps, W, o, isLast) {
    const C = ctx.C;
    let bytes = runBytes;
    const d = C.decode('utf-8', bytes);
    let segs = d.segments;
    let errors = d.errors;
    if (!gaps.length) {
      if (!errors) return { segs, repairs: [], newErrors: 0, lossy: false };
      if (o.tail && isLast) {
        const t = trimTail(segs, bytes.length);
        if (t.segs.length < segs.length) {
          segs = t.segs;
          errors = t.errors;
          bytes = bytes.subarray(0, segs.length ? segs[segs.length - 1].end : 0);
          if (!errors) return { segs, repairs: [], newErrors: 0, lossy: false };
        }
      }
    }
    const canDrop = o.surface !== false && C.get(W).type === 'single' && (C.get(W).invisible || []).length > 0;
    if (!o.lossy || !repairWorthwhile(bytes, errors, gaps.length, canDrop)) {
      return { segs, repairs: [], newErrors: newErrorCount(segs, null) + gaps.length, lossy: false };
    }
    return repairUtf8(ctx, bytes, gaps, W, o, segs);
  }

  /**
   * Decodes a run with a non-UTF-8 encoding. Next to a U+FFFD marker a multi-byte decoder may
   * see half of the lost character: a dangling lead byte before the marker, or an orphan trail
   * byte after it. Those bytes are given to the lost character (Seg.lost) instead of failing.
   */
  function decodePlainRun(ctx, runBytes, E, o, isLast, edges) {
    const C = ctx.C;
    const type = C.get(E).type;
    const utf8 = type === 'utf8';
    const multi = edges && (type === 'double' || type === 'utf16' || utf8);
    const isLeadByte = (b) => b >= 0xc2 && b <= 0xf4;
    const decodeFrom = (from) => {
      const d = C.decode(E, from ? runBytes.subarray(from) : runBytes);
      const segs = d.segments;
      let errors = d.errors;
      if (from) {
        for (const s of segs) {
          s.start += from;
          s.end += from;
        }
        segs.unshift({ ch: FFFD, start: 0, end: from, error: true, lost: true });
      }
      let dangling = false;
      const last = segs[segs.length - 1];
      const tailLen = last ? last.end - last.start : 0;
      if (multi && edges.beforeGap && last && last.error && !last.lost && last.end === runBytes.length &&
        (utf8 ? isLeadByte(runBytes[last.start]) : runBytes[last.start] >= 0x80) && tailLen <= 3) {
        last.lost = true;
        dangling = true;
        errors--;
      }
      return { segs, errors, dangling, skipped: from > 0 };
    };
    let best = decodeFrom(0);
    if (multi && edges.afterGap && best.errors && runBytes.length > 1) {
      // UTF-8: the continuation bytes of the lost character; otherwise one trail byte.
      let k = 1;
      if (utf8) {
        k = 0;
        while (k < 3 && k < runBytes.length && runBytes[k] >= 0x80 && runBytes[k] <= 0xbf) k++;
      }
      if (k > 0 && k < runBytes.length) {
        const alt = decodeFrom(k);
        if (alt.errors < best.errors) best = alt;
      }
    }
    let { segs, errors } = best;
    if (errors && o.tail && isLast) {
      const t = trimTail(segs, runBytes.length);
      segs = t.segs;
      errors = t.errors - segs.filter((s) => s.lost).length;
    }
    if (errors && !o.tolerant) return null; // a legacy decoder had to give up: wrong hypothesis
    return { segs, repairs: [], newErrors: errors, lossy: best.dangling || best.skipped, dangling: best.dangling, skipped: best.skipped };
  }

  /**
   * Splits two Seg lists over the same bytes into aligned blocks: cut points are byte offsets
   * that are character boundaries on both sides. -> [{ i0, i1, o0, o1 }]
   */
  function alignBlocks(inSegs, outSegs) {
    const blocks = [];
    const ni = inSegs.length;
    const no = outSegs.length;
    let i = 0;
    let o = 0;
    let i0 = 0;
    let o0 = 0;
    while (i < ni || o < no) {
      const ie = i < ni ? inSegs[i].end : Infinity;
      const oe = o < no ? outSegs[o].end : Infinity;
      if (ie === oe) {
        i++;
        o++;
        blocks.push({ i0, i1: i, o0, o1: o });
        i0 = i;
        o0 = o;
      } else if (ie < oe) i++;
      else o++;
    }
    if (i0 < ni || o0 < no) blocks.push({ i0, i1: ni, o0, o1: no });
    return blocks;
  }

  /** Decodes segs[s0, s1) (one run between markers). -> decode result with absolute offsets */
  function decodeRunRaw(ctx, units, s0, s1, W, E, o, edges) {
    const { bytes, segs, marks } = units;
    const b0 = segs[s0].start;
    const b1 = segs[s1 - 1].end;
    const runBytes = bytes.subarray(b0, b1);
    const isLast = b1 === bytes.length;
    let d;
    if (E === 'utf-8' && !o.deferRepairs) {
      const gaps = [];
      if (marks) for (let k = s0; k < s1; k++) if (marks.get(k) === 'gap') gaps.push({ byteOffset: segs[k].start - b0, ch: segs[k].ch });
      d = decodeUtf8Run(ctx, runBytes, gaps, W, o, isLast);
    } else {
      d = decodePlainRun(ctx, runBytes, E, o, isLast, edges);
    }
    if (!d) return null;
    for (const s of d.segs) {
      s.start += b0;
      s.end += b0;
    }
    return d;
  }

  /**
   * Appends a decoded run to `out`. Strict mode copies it as is. Tolerant mode aligns input and
   * output and keeps the original characters wherever the decode broke, or wherever o.accept()
   * declines a span.
   */
  function emitRun(units, s0, s1, d, o, out, repairs, st) {
    if (!o.tolerant) {
      const base = out.length;
      for (const s of d.segs) out.push(s);
      for (const rp of d.repairs) repairs.push(Object.assign({}, rp, { index: rp.index + base }));
      st.newErrors += d.newErrors;
      if (d.lossy) st.lossy = true;
      return;
    }
    const inSegs = units.segs.slice(s0, s1);
    const blocks = alignBlocks(inSegs, d.segs);
    for (const b of blocks) {
      let inT = '';
      let outT = '';
      let bad = false;
      for (let j = b.i0; j < b.i1; j++) inT += inSegs[j].ch;
      for (let j = b.o0; j < b.o1; j++) {
        const s = d.segs[j];
        outT += s.ch;
        if (s.error && !s.lost && s.end > s.start) bad = true;
      }
      b.inT = inT;
      b.outT = outT;
      b.bad = bad;
      b.changed = inT !== outT;
      b.take = b.changed && !bad;
    }
    if (o.accept) applyAcceptor(blocks, s0, o.accept);

    const map = new Int32Array(d.segs.length).fill(-1);
    for (const b of blocks) {
      if (b.take) {
        for (let j = b.o0; j < b.o1; j++) {
          map[j] = out.length;
          out.push(d.segs[j]);
          if (d.segs[j].lost) st.lossy = true;
        }
      } else {
        // Untouched by this layer: the same characters on both sides, flagged `kept`.
        for (let j = b.i0; j < b.i1; j++) {
          const s = inSegs[j];
          out.push({ ch: s.ch, start: s.start, end: s.end, kept: true });
          st.keptIdx.push(s0 + j);
        }
        if (b.changed) st.kept++;
      }
    }
    for (const rp of d.repairs) {
      if (map[rp.index] >= 0) {
        repairs.push(Object.assign({}, rp, { index: map[rp.index] }));
        st.lossy = true;
      }
    }
  }

  /**
   * Groups changed, well-decoded blocks into spans (bridging unchanged ASCII letters/digits
   * inside a word) and lets the acceptor decide per span.
   */
  function applyAcceptor(blocks, s0, accept) {
    const bridge = (b) => !b.changed && !b.bad && /^[A-Za-z0-9]+$/.test(b.inT);
    let k = 0;
    while (k < blocks.length) {
      if (!blocks[k].take) {
        k++;
        continue;
      }
      let last = k;
      let j = k + 1;
      while (j < blocks.length && (blocks[j].take || bridge(blocks[j]))) {
        if (blocks[j].take) last = j;
        j++;
      }
      let inText = '';
      let outText = '';
      for (let q = k; q <= last; q++) {
        inText += blocks[q].inT;
        outText += blocks[q].take ? blocks[q].outT : blocks[q].inT;
      }
      const ok = accept({ i0: s0 + blocks[k].i0, i1: s0 + blocks[last].i1, inText, outText });
      if (!ok) for (let q = k; q <= last; q++) blocks[q].take = false;
      k = last + 1;
    }
  }

  const CJK_SCRIPTS = new Set(['han', 'kana', 'hangul']);

  function utf8Length(ch) {
    const cp = ch.codePointAt(0);
    return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }

  /**
   * Picks the best candidate for every repaired character by scoring a small window of text
   * around it (Scorer.charScore alone cannot know that a closing quote beats a joiner after "!").
   * A character whose bytes are mostly guesswork (two or more unknown bytes) is only kept when
   * its context makes it a clear winner; otherwise the loss is admitted with U+FFFD.
   */
  function sameScriptCount(cands, ch) {
    const sc = scriptOf(ch.codePointAt(0));
    let n = 0;
    for (const c of cands) if (scriptOf(c.codePointAt(0)) === sc) n++;
    return n;
  }

  const WIDE_FREQ_SLACK = 2.0; // a context-picked CJK guess may be this much rarer than the most frequent candidate

  function rerankRepairs(ctx, out, repairs, manyDropped, bytes, W, keepAll) {
    if (!repairs.length) return repairs;
    const chars = out.map((s) => s.ch);
    const kept = [];
    // Guesses in a script the surviving text does not use are charged in context too.
    const foreign = foreignPenalty(out, W);
    const listed = keepAll ? 64 : 6;
    const splits = []; // withdrawn guesses that had borrowed a real space as a flattened NBSP
    for (const rp of repairs) {
      const i = rp.index;
      const seg = out[i];
      if (!seg || i < 0 || i >= chars.length) {
        kept.push(rp);
        continue;
      }
      const all = rp.candidates && rp.candidates.length ? rp.candidates : [rp.to];
      // One unknown byte of a CJK character: every candidate (up to 64) is judged in context,
      // since the isolated character score knows nothing about the word it completes.
      const wideCjk = rp.reason !== 'nbsp' && utf8Length(rp.to) - (seg.end - seg.start) === 1 &&
        CJK_SCRIPTS.has(scriptOf(rp.to.codePointAt(0)));
      const cands = all.slice(0, wideCjk ? 64 : TUNE.RERANK_TOP);
      // Many look-alikes of the same script (64 Hanzi after E8 AF): frequency alone must not pick.
      // (Intermediate layers are judged later on the final text: refineThroughChain.)
      const wide = !keepAll && wideCjk && sameScriptCount(cands, rp.to) > 6;
      let best = rp.to;
      let margin = Infinity;
      // Out of budget: no more context scoring, guesses that need a margin become U+FFFD.
      if (cands.length > 1 && overBudget(ctx)) margin = 0;
      else if (cands.length > 1) {
        // Whole text when short (paired quotes and brackets need both ends), else a window.
        const lo = chars.length <= 160 ? 0 : Math.max(0, i - 24);
        const hi = chars.length <= 160 ? chars.length : Math.min(chars.length, i + 25);
        ctx.work += (hi - lo) * cands.length;
        let bestV = -Infinity;
        let second = -Infinity;
        const fits = wide ? [] : null;
        for (const cand of cands) {
          chars[i] = cand;
          const v = ctx.S.score(chars.slice(lo, hi).join('')).total - (foreign ? foreign(cand) : 0);
          // (Letters only: a punctuation mark fits anywhere and completes no word.)
          if (fits && /\p{L}/u.test(cand)) fits.push({ cand, v, fit: v - ctx.S.charScore(cand) });
          if (v > bestV + 1e-9) {
            second = bestV;
            bestV = v;
            best = cand;
          } else if (v > second) second = v;
        }
        margin = bestV - second;
        if (fits && fits.length) {
          // Out of 64 look-alikes the most frequent character wins on its own score ("测说",
          // "迁种"): only the fit with its neighbours (a known word) may pick one. The winner is
          // the best fit, and it must clearly beat every other candidate on that fit.
          fits.sort((a, b) => b.fit - a.fit || b.v - a.v);
          const top = fits[0];
          const fitMargin = fits.length > 1 ? top.fit - fits[1].fit : Infinity;
          best = top.cand;
          margin = top.v >= bestV - WIDE_FREQ_SLACK ? fitMargin : 0;
        }
      }
      const guessed = utf8Length(best) - (seg.end - seg.start);
      const shaky = (rp.reason === 'gap' || rp.reason === 'dropped') && guessed >= 2;
      // One unknown byte of a CJK character leaves 64 similar candidates: only context decides.
      const cjkGuess = guessed === 1 && rp.reason !== 'nbsp' && CJK_SCRIPTS.has(scriptOf(best.codePointAt(0)));
      const gapGuess = guessed === 1 && rp.reason === 'gap' && !cjkGuess && cands.length > 1;
      const dropGuess = rp.reason === 'dropped' && !cjkGuess && cands.length > 1;
      if ((shaky && margin < TUNE.GUESS_MARGIN) || (cjkGuess && margin < TUNE.CJK_GUESS_MARGIN) ||
        (gapGuess && margin < TUNE.GAP_GUESS_MARGIN) || (dropGuess && margin < TUNE.DROP_GUESS_MARGIN)) {
        chars[i] = FFFD;
        // A guess that read the following space as a flattened NBSP gives the space back: only
        // the broken sequence before it is lost ("café menu" must not become "caf�menu").
        if (rp.reason === 'dropped' && bytes && seg.end - seg.start >= 2 && bytes[seg.end - 1] === 0x20) {
          out[i] = { ch: FFFD, start: seg.start, end: seg.end - 1, error: true, lost: true };
          splits.push(i);
        } else {
          out[i] = { ch: FFFD, start: seg.start, end: seg.end, error: true, lost: true };
        }
        continue;
      }
      chars[i] = best;
      if (best !== rp.to) {
        rp.to = best;
        rp.candidates = [best].concat(all.filter((c) => c !== best)).slice(0, listed);
        out[i] = Object.assign({}, seg, { ch: best, candidates: rp.candidates.slice(0, 6) });
      } else if (all.length > listed || (seg.candidates && seg.candidates.length > 6)) {
        rp.candidates = all.slice(0, listed);
        out[i] = Object.assign({}, seg, { candidates: all.slice(0, 6) });
      }
      kept.push(rp);
    }
    splits.sort((a, b) => a - b);
    for (let k = splits.length - 1; k >= 0; k--) {
      const i = splits[k];
      out.splice(i + 1, 0, { ch: ' ', start: out[i].end, end: out[i].end + 1 });
      for (const rp of kept) if (rp.index > i) rp.index++;
    }
    return kept;
  }

  /**
   * Decodes all runs of `units` with E. Runs are separated by pass-through markers (and, for
   * targets other than UTF-8, by U+FFFD markers). -> transcode result, or null (strict mode).
   */
  function decodeUnits(ctx, units, W, E, o) {
    const { segs, marks } = units;
    ctx.work += units.bytes.length;
    const repairsHere = E === 'utf-8' && !o.deferRepairs;
    const n = segs.length;
    const items = [];
    let runStart = 0;
    for (let k = 0; k <= n; k++) {
      let m;
      if (k < n) {
        m = marks ? marks.get(k) : undefined;
        if (m === undefined || m === 'skip' || (m === 'gap' && repairsHere)) continue;
      }
      if (k > runStart) items.push({ s0: runStart, s1: k });
      if (k < n) items.push({ mark: k, kind: m });
      runStart = k + 1;
    }
    for (let q = 0; q < items.length; q++) {
      const it = items[q];
      if (it.mark !== undefined) continue;
      const edges = repairsHere ? null : {
        afterGap: q > 0 && items[q - 1].kind === 'gap',
        beforeGap: q + 1 < items.length && items[q + 1].kind === 'gap',
      };
      it.d = decodeRunRaw(ctx, units, it.s0, it.s1, W, E, o, edges);
      if (!it.d) return null;
    }

    const out = [];
    let repairs = [];
    const st = { newErrors: 0, passed: 0, kept: 0, lossy: false, keptIdx: [] };
    for (let q = 0; q < items.length; q++) {
      const it = items[q];
      if (it.mark === undefined) {
        emitRun(units, it.s0, it.s1, it.d, o, out, repairs, st);
        continue;
      }
      const s = segs[it.mark];
      if (it.kind === 'pass') {
        // A character W cannot encode: no bytes, copied through as it is (not a gap).
        out.push({ ch: s.ch, start: s.start, end: s.start, kept: true });
        st.keptIdx.push(it.mark);
        st.passed++;
        continue;
      }
      // A U+FFFD this decoder cannot repair stays as it is, unless a neighbouring run already
      // gave it the bytes of the lost character.
      st.lossy = true;
      const prev = items[q - 1];
      const next = items[q + 1];
      if (!(prev && prev.d && prev.d.dangling) && !(next && next.d && next.d.skipped)) {
        out.push({ ch: s.ch, start: s.start, end: s.start, error: true, lost: true });
      }
    }
    const manyDropped = (ctx.C.get(W).invisible || []).length > 8;
    repairs = rerankRepairs(ctx, out, repairs, manyDropped, units.bytes, W, (o.maxCandidates || 6) > 6);
    if (marks) {
      const skips = [];
      for (const [k, m] of marks) if (m === 'skip') skips.push(segs[k].start);
      if (skips.length) {
        for (const rp of repairs) {
          const sg = out[rp.index];
          if (rp.reason === 'dropped' && sg && skips.some((off) => off >= sg.start && off <= sg.end)) rp.from = '?';
        }
      }
    }
    // U+FFFD that admit a loss the input did not show (withdrawn guesses, unresolved stripped
    // markers) are honest, unlike decoding errors; the ranking charges them less.
    let lostOut = 0;
    let fffdIn = 0;
    for (const sg of out) if (sg.lost && sg.ch === FFFD) lostOut++;
    for (const sg of segs) if (sg.ch === FFFD) fffdIn++;
    // The before side of the kept characters carries the flag too (copies: units.segs may be
    // shared between decoders).
    let segsBefore = segs;
    if (st.keptIdx.length) {
      segsBefore = segs.slice();
      for (const k of st.keptIdx) segsBefore[k] = Object.assign({}, segs[k], { kept: true });
    }
    return {
      text: segsText(out), bytes: units.bytes, segsBefore, segsAfter: out, repairs,
      newErrors: st.newErrors, passed: st.passed, kept: st.kept, lossy: st.lossy || repairs.length > 0,
      lostAdded: Math.max(0, lostOut - fffdIn),
    };
  }

  /**
   * '?' characters that sit right next to a broken UTF-8 sequence were probably bytes replaced
   * by a lossy conversion: returns their code point indices.
   */
  function questionGaps(ctx, units) {
    // Broken sequences of the plain decode (the repair decoder may already have "fixed" them
    // with swallowed bytes, which is the other explanation the caller compares against).
    const errEnds = new Set();
    const errStarts = new Set();
    for (const s of ctx.C.decode('utf-8', units.bytes).segments) {
      if (s.error && s.end > s.start) {
        errEnds.add(s.end);
        errStarts.add(s.start);
      }
    }
    // A run of '?' touching a broken sequence on either side stands for its missing bytes.
    const force = new Set();
    const segs = units.segs;
    for (let k = 0; k < segs.length; k++) {
      if (segs[k].ch !== '?') continue;
      let e = k;
      while (e + 1 < segs.length && segs[e + 1].ch === '?') e++;
      if (e - k < 3 && (errEnds.has(segs[k].start) || errStarts.has(segs[e].end))) for (let q = k; q <= e; q++) force.add(q);
      k = e;
    }
    return force;
  }

  /**
   * One full layer (encode + decode). On the surface layer of an ISO-8859-1 reading, '?' next to
   * a broken sequence is retried as a lost byte: converting such text to a charset without C1
   * controls (Windows-1252, ASCII) turns each C1 character into '?'.
   */
  function transcodeUnits(ctx, text, units, W, E, o) {
    let r = decodeBest(ctx, units, W, E, o);
    if (r && E === 'utf-8' && W === 'iso-8859-1' && o.lossy && o.surface !== false && (r.newErrors > 0 || r.repairs.length || r.lostAdded > 0) &&
      text.indexOf('?') >= 0 && !o.deferRepairs) {
      const force = questionGaps(ctx, units);
      if (force.size) {
        const u2 = encodeSlow(ctx, text, W, true, !!o.tolerant, force);
        const r2 = u2 && decodeUnits(ctx, u2, W, E, o);
        // Prefer the reading with fewer errors, then fewer admitted losses, then the better text.
        const worse = (a, b) => a.newErrors - b.newErrors || (a.lostAdded || 0) - (b.lostAdded || 0) || layerFit(ctx, b.text) - layerFit(ctx, a.text);
        if (r2 && worse(r2, r) < 0) r = r2;
      }
    }
    return r;
  }

  /** Length-balanced plausibility of one layer's output (for comparing two decodes of it). */
  function layerFit(ctx, text) {
    const sc = ctx.score(text);
    return sc.total / Math.sqrt(Math.max(1, sc.length));
  }

  function transcode(ctx, text, W, E, o) {
    const units = encodeFor(ctx, text, W, o);
    return units ? transcodeUnits(ctx, text, units, W, E, o) : null;
  }

  // ---------------------------------------------------------------------------
  // Escape layers
  // ---------------------------------------------------------------------------

  const LATIN1_ENTITY_NAMES = (
    'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 ' +
    'acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml ' +
    'Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde ' +
    'Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ' +
    'ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide ' +
    'oslash ugrave uacute ucirc uuml yacute thorn yuml'
  ).split(' ');
  const NAMED_ENTITIES = (() => {
    const map = new Map([
      ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['hellip', '…'], ['mdash', '—'],
      ['ndash', '–'], ['lsquo', '‘'], ['rsquo', '’'], ['ldquo', '“'], ['rdquo', '”'],
      ['sbquo', '‚'], ['bdquo', '„'], ['bull', '•'], ['trade', '™'], ['euro', '€'],
      ['OElig', 'Œ'], ['oelig', 'œ'], ['Scaron', 'Š'], ['scaron', 'š'], ['Yuml', 'Ÿ'],
      ['zwj', '\u200D'], ['zwnj', '\u200C'], ['ensp', '\u2002'], ['emsp', '\u2003'], ['thinsp', '\u2009'],
    ]);
    LATIN1_ENTITY_NAMES.forEach((name, k) => map.set(name, String.fromCharCode(0xa0 + k)));
    return map;
  })();

  function utf8Bytes(ch) {
    return codecs().encodeChar('utf-8', ch) || [0x3f];
  }

  /**
   * Byte-producing escape schemes. Every escaped byte becomes one byte; other characters are
   * literal (ASCII as itself, anything else as its UTF-8 bytes). Each source character gets a
   * Seg: all characters of one escape token point at that token's byte, so the stratum view can
   * show "%E5" above the byte E5.
   */
  function parseByteTokens(text, re, toByte) {
    const out = [];
    const segs = [];
    let tokens = 0;
    let high = 0;
    let last = 0;
    const literal = (from, to) => {
      for (const ch of text.slice(from, to)) {
        const b = ch.codePointAt(0) < 0x80 ? [ch.codePointAt(0)] : utf8Bytes(ch);
        segs.push({ ch, start: out.length, end: out.length + b.length });
        for (const x of b) out.push(x);
      }
    };
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      literal(last, m.index);
      const v = toByte(m);
      if (v === null) {
        for (const ch of m[0]) segs.push({ ch, start: out.length, end: out.length }); // soft line break
      } else {
        for (const ch of m[0]) segs.push({ ch, start: out.length, end: out.length + 1 });
        out.push(v);
        tokens++;
        if (v >= 0x80) high++;
      }
      last = m.index + m[0].length;
    }
    literal(last, text.length);
    return { bytes: Uint8Array.from(out), segs, tokens, high };
  }

  const HEX_DUMP = /^\s*(?:(?:0x)?[0-9a-f]{2}(?:[\s,;:-]+(?:0x)?[0-9a-f]{2})+|(?:[0-9a-f]{2}){3,})\s*$/i;

  function parseHexDump(text) {
    if (!HEX_DUMP.test(text)) return null;
    const token = text.trim().replace(/^0x/i, '');
    const unspaced = /^[0-9a-f]+$/i.test(token);
    // "DECADE", "FACADE", "CAFEBABE": words spelled with the letters A-F are not byte dumps.
    if (unspaced && /^[a-f]+$/i.test(token)) return null;
    const out = [];
    const segs = [];
    let high = 0;
    const re = /(?:0x)?([0-9a-f]{2})/gi;
    let last = 0;
    let m;
    const sep = (from, to) => {
      for (const ch of text.slice(from, to)) segs.push({ ch, start: out.length, end: out.length });
    };
    while ((m = re.exec(text))) {
      sep(last, m.index);
      const v = parseInt(m[1], 16);
      for (const ch of m[0]) segs.push({ ch, start: out.length, end: out.length + 1 });
      out.push(v);
      if (v >= 0x80) high++;
      last = m.index + m[0].length;
    }
    sep(last, text.length);
    // One unspaced run of 8/12/32/40/64 hex digits is an identifier (CRC-32, MAC address,
    // MD5, SHA-1, SHA-256, container id) unless its bytes are complete UTF-8 text.
    const idLike = unspaced && [8, 12, 32, 40, 64].indexOf(token.length) >= 0;
    return { bytes: Uint8Array.from(out), segs, tokens: out.length, high, idLike };
  }

  function parseUnicodeEscapes(text) {
    const re = /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})/g;
    let high = 0;
    let bad = false;
    const out = text.replace(re, (all, braced, four, eight) => {
      const v = parseInt(braced || four || eight, 16);
      if (v >= 0x80) high++;
      if (four) return String.fromCharCode(v); // UTF-16 code units: surrogate pairs recombine
      if (v > 0x10ffff) {
        bad = true;
        return FFFD;
      }
      return String.fromCodePoint(v);
    });
    if (!high) return null;
    // Unpaired surrogates mean the escapes were cut or invented.
    if (bad || /[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/.test(out)) return null;
    return { text: out, high };
  }

  function parseEntities(text) {
    const re = /&#(\d{1,7});|&#[xX]([0-9a-fA-F]{1,6});|&([A-Za-z][A-Za-z0-9]{1,31});/g;
    let count = 0;
    let high = 0;
    let numericHigh = 0;
    const out = text.replace(re, (all, dec, hex, name) => {
      if (name) {
        const v = NAMED_ENTITIES.get(name);
        if (v === undefined) return all;
        count++;
        if (v.charCodeAt(0) >= 0x80) high++;
        return v;
      }
      const cp = parseInt(dec || hex, dec ? 10 : 16);
      if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) return all;
      count++;
      if (cp >= 0x80) {
        high++;
        numericHigh++;
      }
      return String.fromCodePoint(cp);
    });
    if (!high && !(count >= 2 && numericHigh)) return null;
    return { text: out, high };
  }

  const NESTED_ESCAPE = /%[0-9a-f]{2}|\\u[0-9a-f]{4}|\\x[0-9a-f]{2}/i;

  /** All escape layers that apply to `text`: [{ scheme, bytes?, segs?, text? }]. */
  function parseEscapes(text) {
    const found = [];
    const hexByte = (m) => parseInt(m[1], 16);
    const pct = /%[0-9a-fA-F]{2}/.test(text) && parseByteTokens(text, /%([0-9a-fA-F]{2})/g, hexByte);
    if (pct && pct.high >= 1) found.push({ scheme: 'percent', bytes: pct.bytes, segs: pct.segs, high: pct.high });
    else if (pct && NESTED_ESCAPE.test(String.fromCharCode.apply(null, pct.bytes.subarray(0, 4096)))) {
      // Only ASCII came out, but it is itself escaped (%25E5 -> %E5, %5Cu5927 -> 大): a layer
      // worth peeling only for the one inside it.
      found.push({ scheme: 'percent', bytes: pct.bytes, segs: pct.segs, high: 0, nested: true });
    }
    const hx = /\\x[0-9a-fA-F]{2}/.test(text) && parseByteTokens(text, /\\x([0-9a-fA-F]{2})/g, hexByte);
    if (hx && hx.high >= 1) found.push({ scheme: 'hex-escape', bytes: hx.bytes, segs: hx.segs, high: hx.high });
    const qp = /=[0-9A-Fa-f]{2}/.test(text) &&
      parseByteTokens(text, /=([0-9A-Fa-f]{2})|=\r?\n/g, (m) => (m[1] ? parseInt(m[1], 16) : null));
    if (qp && qp.high >= 1 && qp.tokens >= 2) found.push({ scheme: 'quoted-printable', bytes: qp.bytes, segs: qp.segs, high: qp.high });
    const dump = parseHexDump(text);
    if (dump && dump.high >= 1) found.push({ scheme: 'hex-dump', bytes: dump.bytes, segs: dump.segs, high: dump.high, idLike: dump.idLike });
    const ue = /\\[uU]/.test(text) && parseUnicodeEscapes(text);
    if (ue) found.push({ scheme: 'unicode-escape', text: ue.text });
    const ent = /&#?[A-Za-z0-9]+;/.test(text) && parseEntities(text);
    if (ent) found.push({ scheme: 'html-entity', text: ent.text });
    return found;
  }

  function unescapeStep(ctx, before, after, parsed, E, segsAfter) {
    const isBytes = !!parsed.bytes;
    return {
      kind: 'unescape',
      wrongDecoder: null,
      trueEncoding: isBytes ? E : null,
      scheme: parsed.scheme,
      before,
      after,
      bytes: isBytes ? parsed.bytes : null,
      segmentsBefore: isBytes ? parsed.segs : null,
      segmentsAfter: isBytes ? segsAfter : null,
      repairs: [],
      lossy: false,
      scoreBefore: ctx.score(before).value,
      scoreAfter: ctx.score(after).value,
      prior: isBytes ? escapePrior(E) : 1,
    };
  }

  /**
   * Unescaped versions of `text`, as search roots: [{ text, steps, credible, sv }]. Byte schemes
   * keep the two most plausible error-free decodes; one nested layer is peeled as well (e.g. a
   * JSON \u escape inside a URL parameter).
   */
  /**
   * Decodes the bytes of an escape layer. UTF-8 bytes cut in the middle of the last character
   * (a URL or dump truncated mid-character) decode with that tail marked as lost.
   * -> { text, segments, errors, tailLost }
   */
  function decodeEscapeBytes(ctx, E, bytes) {
    const d = ctx.C.decode(E, bytes);
    if (E !== 'utf-8' || d.errors !== 1) return { text: d.text, segments: d.segments, errors: d.errors, tailLost: 0 };
    const segs = d.segments;
    const last = segs[segs.length - 1];
    const lead = last ? bytes[last.start] : 0;
    const want = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : 2;
    if (!last || !last.error || last.end !== bytes.length || lead < 0xc2 || lead > 0xf4 || last.end - last.start >= want) {
      return { text: d.text, segments: segs, errors: d.errors, tailLost: 0 };
    }
    const out = segs.slice(0, -1).concat([Object.assign({}, last, { lost: true })]);
    return { text: d.text, segments: out, errors: 0, tailLost: 1 };
  }

  /** Share of letters among the non-ASCII characters of a text (1 when there are none). */
  function letterShare(text) {
    let n = 0;
    let letters = 0;
    for (const ch of text) {
      if (ch.codePointAt(0) < 0x80) continue;
      n++;
      if (/\p{L}/u.test(ch)) letters++;
    }
    return n ? letters / n : 1;
  }

  // Byte schemes whose syntax ordinary text matches by accident (hex words, register dumps,
  // Windows paths with "\x86"): their bytes need real evidence before they count as text.
  const STRICT_SCHEMES = new Set(['hex-dump', 'quoted-printable', 'hex-escape']);
  const ESC_LEGACY_MARGIN = 1.5; // a legacy decode of such bytes must read this much better than ESC_ABS_MIN
  const ESC_LEGACY_HIGH = 4; // ...and come from at least this many non-ASCII bytes

  function escapeCandidates(ctx, text, depth) {
    const res = [];
    for (const p of parseEscapes(text)) {
      if (p.bytes) {
        const decodes = [];
        // Valid UTF-8 with multi-byte sequences is overwhelming evidence (random bytes almost
        // never are): such bytes are read as UTF-8 only, even when the result is more mojibake.
        // A sequence cut off at the very end does not count against it.
        const u8 = ctx.ids.indexOf('utf-8') >= 0 ? decodeEscapeBytes(ctx, 'utf-8', p.bytes) : null;
        const utf8Only = !!u8 && !u8.errors && u8.segments.some((sg) => !sg.error && sg.end - sg.start > 1);
        if (p.idLike && !(utf8Only && !u8.tailLost)) continue;
        const strict = STRICT_SCHEMES.has(p.scheme);
        for (const E of utf8Only || p.nested ? ['utf-8'] : ctx.ids) {
          const d = E === 'utf-8' && u8 ? u8 : decodeEscapeBytes(ctx, E, p.bytes);
          if (d.errors || !d.text || BAD_CONTROLS.test(d.text)) continue;
          const sv = ctx.score(d.tailLost ? d.text.slice(0, -1) || d.text : d.text).value;
          if (strict && !utf8Only && !(p.high >= ESC_LEGACY_HIGH && sv >= TUNE.ESC_ABS_MIN + ESC_LEGACY_MARGIN && letterShare(d.text) >= 0.75)) continue;
          decodes.push({ E, d, sv, rank: sv + 0.3 * LN(escapePrior(E)) });
        }
        decodes.sort((a, b) => b.rank - a.rank);
        decodes.slice(0, 2).forEach((x, k) => {
          const step = unescapeStep(ctx, text, x.d.text, p, x.E, x.d.segments);
          res.push({
            text: x.d.text, steps: [step], credible: k === 0 && x.sv >= TUNE.ESC_ABS_MIN && !p.nested, sv: x.sv, prior: escapePrior(x.E),
            tailLost: x.d.tailLost,
          });
        });
      } else if (p.text !== text && !BAD_CONTROLS.test(p.text)) {
        const sv = ctx.score(p.text).value;
        res.push({ text: p.text, steps: [unescapeStep(ctx, text, p.text, p, null, null)], credible: sv >= TUNE.ESC_ABS_MIN, sv, prior: 1 });
      }
    }
    if (depth < 1) {
      for (const r of res.slice()) {
        for (const inner of escapeCandidates(ctx, r.text, depth + 1)) {
          res.push({
            text: inner.text, steps: r.steps.concat(inner.steps), credible: inner.credible, sv: inner.sv, prior: r.prior * inner.prior,
            tailLost: (r.tailLost || 0) + (inner.tailLost || 0),
          });
        }
      }
    }
    return res.slice(0, 6);
  }

  /** Re-applies one escape layer (applyChain on a full text). */
  function unescapeWith(ctx, text, scheme, E) {
    for (const p of parseEscapes(text)) {
      if (p.scheme !== scheme) continue;
      if (!p.bytes) return { text: p.text, step: unescapeStep(ctx, text, p.text, p, null, null) };
      const enc = E && ctx.C.get(E) ? E : 'utf-8';
      const d = decodeEscapeBytes(ctx, enc, p.bytes);
      return { text: d.text, step: unescapeStep(ctx, text, d.text, p, enc, d.segments) };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Beam search
  // ---------------------------------------------------------------------------

  /** Moves a cut point back to just after an ASCII character (within 64 code units). */
  function snapEnd(text, i) {
    for (let j = i, k = 0; j > 0 && k < 64; j--, k++) if (text.charCodeAt(j - 1) < 0x80) return j;
    const c = text.charCodeAt(i - 1);
    return c >= 0xd800 && c <= 0xdbff ? i - 1 : i;
  }

  /** Moves a window start forward to just after an ASCII character (within 64 code units). */
  function snapStart(text, i) {
    if (i <= 0) return 0;
    for (let j = i, k = 0; j < text.length && k < 64; j++, k++) if (text.charCodeAt(j - 1) < 0x80) return j;
    const c = text.charCodeAt(i);
    return c >= 0xdc00 && c <= 0xdfff ? i + 1 : i;
  }

  const SAMPLE_RADIUS = 200; // code units of context around each suspicious spot of a long text

  /**
   * The part of a long text the search looks at: roughly sampleLimit code points, cut right
   * after an ASCII character so no multi-byte sequence of the garbled text is split. A plain
   * prefix is used when it carries its share of the non-ASCII content; otherwise (an English
   * letter whose only "â€™" sits on page three) the sample is made of windows around the
   * mojibake signals and the non-ASCII runs, joined by line breaks.
   */
  function sampleOf(text, limit, S) {
    let count = 0;
    let i = 0;
    while (i < text.length && count < limit) {
      const c = text.charCodeAt(i);
      i += c >= 0xd800 && c <= 0xdbff && i + 1 < text.length ? 2 : 1;
      count++;
    }
    if (i >= text.length) return { sample: text, truncated: false, windowed: false };
    const prefix = text.slice(0, snapEnd(text, i));
    const nt = nonAsciiCount(text);
    const np = nonAsciiCount(prefix);
    if (nt === 0 || np >= nt || (np >= Math.min(nt, 8) && np >= 0.5 * nt * (prefix.length / text.length))) {
      return { sample: prefix, truncated: true, windowed: false };
    }
    // Anchors: mojibake signals first (they are what needs explaining), then non-ASCII runs.
    const anchors = [];
    if (S) {
      try {
        for (const h of S.mojibakeSignals(text)) anchors.push(h.index);
      } catch (_) { /* no signals: non-ASCII runs only */ }
    }
    for (let k = 0, inRun = false; k < text.length && anchors.length < 4096; k++) {
      const non = text.charCodeAt(k) >= 0x80;
      if (non && !inRun) anchors.push(k);
      inRun = non;
    }
    const wins = [];
    let budget = i; // code units, about sampleLimit code points
    for (const a of anchors) {
      if (budget <= 0) break;
      if (wins.some((w) => a >= w[0] && a < w[1])) continue;
      let s = Math.max(0, a - SAMPLE_RADIUS);
      let e = Math.min(text.length, a + SAMPLE_RADIUS);
      for (const w of wins) {
        if (w[1] > s && w[1] <= a) s = w[1]; // do not overlap a window on the left
        if (w[0] < e && w[0] > a) e = w[0]; // ...or on the right
      }
      if (e - s > budget) e = s + budget;
      s = snapStart(text, s);
      if (s > a) s = a;
      e = e < text.length ? snapEnd(text, e) : e;
      if (e <= a) continue;
      wins.push([s, e]);
      budget -= e - s;
    }
    if (!wins.length) return { sample: prefix, truncated: true, windowed: false };
    wins.sort((x, y) => x[0] - y[0]);
    // Adjacent windows are merged; others are separated by a line break.
    let sample = '';
    let lastEnd = -1;
    for (const [s, e] of wins) {
      if (sample && s !== lastEnd) sample += '\n';
      sample += text.slice(s, e);
      lastEnd = e;
    }
    return { sample, truncated: true, windowed: true };
  }

  /**
   * Scores a text with its U+FFFD taken out: core = ScoreInfo.value of the rest (its
   * plausibility as text), total/len = log-likelihood where every U+FFFD counts as one poor
   * character (FFFD_CHAR). Scorer itself rates U+FFFD so low that averages would reward chains
   * that merely dilute the markers of loss (three junk letters per CJK character).
   */
  function fitOf(ctx, text) {
    const fffd = countChar(text, FFFD);
    const rest = fffd ? text.split(FFFD).join('') : text;
    if (!rest) return { core: -20, total: -20 + TUNE.FFFD_CHAR * fffd, len: 1 + fffd, fffd };
    const sc = ctx.score(rest);
    return { core: sc.value, total: sc.total + TUNE.FFFD_CHAR * fffd, len: Math.max(1, sc.length) + fffd, fffd };
  }

  /**
   * Plausibility used for ranking: total log-likelihood over sqrt(own length x input length).
   * Readings of the same bytes differ in length (six Hanzi or twelve Thai letters); per-character
   * averages favour the longer letter soup, totals favour contraction too much given Scorer's
   * compressed Han scale, and the geometric mean sits between the two.
   */
  function rankFit(fit, rootLen) {
    return fit.total / Math.sqrt(fit.len * rootLen);
  }

  function makeRoot(ctx, full, pre, uBase) {
    const { sample, truncated, windowed } = sampleOf(full, ctx.opts.sampleLimit, ctx.S);
    const L = Math.max(1, cpLength(sample));
    const nonAscii = nonAsciiCount(sample);
    const N = Math.max(1, nonAscii);
    const fit = fitOf(ctx, sample);
    // Non-ASCII characters that survived intact: the only evidence a lossy relic still carries.
    const core = Math.max(0, nonAscii - fit.fffd);
    // Gains are per affected code point; the shrinkage keeps one changed symbol in a long
    // sentence ("©" -> "؟") from counting as overwhelming evidence.
    const scale = L / (N + TUNE.EVIDENCE_N0);
    // ASCII letters and whitespace are no evidence for a UTF-16 reading (that only explains
    // non-ASCII junk, or text laced with NUL / control bytes), and neither are one to three
    // code units: any pair of bytes is some UTF-16 character.
    const utf16ok = (nonAscii > 0 || /[\x00-\x08\x0e-\x1f]/.test(sample)) && sample.length >= 4;
    // Hanzi, kana and Hangul in the sample: a CJK text read with another CJK code page still shows
    // them; symbols and box drawing alone are no such evidence.
    let cjk = 0;
    for (const ch of sample) if (CJK_SCRIPTS.has(scriptOf(ch.codePointAt(0)))) cjk++;
    return {
      full, sample, truncated, windowed, pre, sv: fit.core, fit: fit.total / fit.len, len: fit.len, fffd: fit.fffd, core, L, N, scale, uBase,
      nonAscii, utf16ok, cjk,
    };
  }

  /** Plausibility gained over the root, per affected code point (before any penalty). */
  function gainOf(root, node) {
    // U+FFFD the chain adds: decoding errors cost a lot, admitted losses (withdrawn guesses)
    // little. Markers it resolves need no bonus: the repaired character outscores FFFD_CHAR.
    const d = Math.max(0, node.fffd - root.fffd);
    const honest = Math.min(d, node.lostAdded || 0);
    const marks = TUNE.FFFD_COST * (d - honest) + TUNE.LOST_COST * honest;
    return (node.fit - root.fit) * root.scale - marks / (root.N + TUNE.EVIDENCE_N0);
  }

  function repairCostOf(repairs) {
    let c = 0;
    for (const rp of repairs) c += TUNE.REPAIR_COST[rp.reason] || TUNE.REPAIR_COST.gap;
    return c;
  }

  /**
   * Repairs that invent bytes no visible character stood for: a swallowed invisible byte, or a
   * gap nobody marked (a deleted U+FFFD). They explain a broken sequence, but they are no
   * evidence of their own.
   */
  function inventedOf(repairs) {
    let n = 0;
    for (const rp of repairs) if (rp.reason === 'dropped' || (rp.reason === 'gap' && rp.from === '')) n++;
    return n;
  }

  /** Ranking value of a search node (see TUNE). */
  function uOf(root, node) {
    return root.uBase +
      gainOf(root, node) -
      TUNE.DEPTH_W * Math.max(0, node.depth - 1) +
      TUNE.PRIOR_W * LN(node.prior) -
      (node.repairCost + TUNE.ERROR_COST * node.errors) / (root.N + TUNE.EVIDENCE_N0);
  }

  /**
   * Byte content + marker layout, used to share decodes between W that produce identical bytes.
   * Lossy repairs also depend on W (its invisible bytes, whether 0xA0 is NBSP), so with repairs
   * possible those are part of the key.
   */
  function unitsKey(units, W, o) {
    let key = '';
    if (o.lossy && o.surface !== false) {
      const info = codecs().get(W);
      key += (info.type === 'single' ? (info.invisible || []).join(',') : '') + (nbspFromSpace(W) ? 'n' : '') + '#';
    }
    const b = units.bytes;
    for (let i = 0; i < b.length; i += 4096) key += String.fromCharCode.apply(null, b.subarray(i, i + 4096));
    if (units.marks) for (const [k, m] of units.marks) key += '|' + units.segs[k].start + m;
    return key;
  }

  /** Every one-layer transform of node.text; emit(child, improved). */
  function expand(ctx, root, node, emit) {
    const text = node.text;
    const lossy = ctx.opts.allowLossy;
    const hasNul = text.indexOf('\u0000') >= 0;
    const shared = new Map();
    const o = { lossy, tolerant: false, tail: root.truncated, surface: node.depth === 0 };

    const emitChild = (W, E, r, defer) => {
      if (!r.text || r.text === text) return;
      // Reading the bytes back the way they came (E>W right after W>E) is a round trip.
      if (last && last.kind === 'transcode' && last.W === E && last.E === W) return;
      if (r.newErrors > TUNE.ERROR_SHARE * nonAsciiCount(r.text) + 1) return;
      const fit = fitOf(ctx, r.text);
      const pp = pairPrior(E, W, text);
      const child = {
        stepPrior: pp,
        text: r.text,
        chain: node.chain.concat([defer ? { kind: 'transcode', W, E, defer: true } : { kind: 'transcode', W, E }]),
        depth: node.depth + 1,
        prior: node.prior * pp,
        minPrior: Math.min(node.minPrior === undefined ? 1 : node.minPrior, pp),
        repairCost: node.repairCost + repairCostOf(r.repairs),
        invented: (node.invented || 0) + inventedOf(r.repairs),
        errors: node.errors + r.newErrors,
        lostAdded: (node.lostAdded || 0) + (r.lostAdded || 0),
        sv: fit.core,
        fit: rankFit(fit, root.len),
        fffd: fit.fffd,
        root,
      };
      child.u = uOf(root, child);
      emit(child, gainOf(root, child) > gainOf(root, node) + 1e-9);
    };

    const last = node.chain.length ? node.chain[node.chain.length - 1] : null;
    for (const W of ctx.ids) {
      if (overBudget(ctx)) return;
      const wUtf16 = isUtf16(W);
      if (wUtf16 && !root.utf16ok) continue;
      const units = encodeFor(ctx, text, W, o);
      if (!units) continue;
      const ascii = allAscii(units.bytes);
      if (ascii && !wUtf16 && !(units.marks && units.marks.size)) {
        // ASCII bytes read the same in every ASCII-compatible decoder: only UTF-16 can differ.
        for (const E of ['utf-16le', 'utf-16be']) {
          if (E === W || ctx.ids.indexOf(E) < 0 || !root.utf16ok) continue;
          ctx.explored++;
          const r = transcodeUnits(ctx, text, units, W, E, o);
          if (r) emitChild(W, E, r);
        }
        continue;
      }
      const key = unitsKey(units, W, o);
      const prev = shared.get(key);
      if (prev) {
        for (const p of prev) if (p.E !== W) emitChild(W, p.E, p.r, p.defer);
        continue;
      }
      const done = [];
      const zeroSoup = wUtf16 && !hasNul && hasZeroByte(units.bytes);
      let controlBytes = 0;
      if (wUtf16) for (const b of units.bytes) if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) controlBytes++;
      for (const E of ctx.ids) {
        if (E === W) continue;
        const eUtf16 = isUtf16(E);
        if (eUtf16 && !root.utf16ok) continue;
        if (ascii && !eUtf16 && E !== ctx.asciiE.get(W)) continue;
        if (zeroSoup && !eUtf16) continue; // UTF-16 of Latin text: NULs everywhere, never the answer
        if (wUtf16 && !eUtf16 && controlBytes > 0.04 * units.bytes.length) continue;
        ctx.explored++;
        const r = transcodeUnits(ctx, text, units, W, E, o);
        if (!r) continue;
        done.push({ E, r });
        emitChild(W, E, r);
        // A lost byte "repaired" into a character of an intermediate mojibake layer is a blind
        // guess; the variant that keeps U+FFFD lets the next layer repair it with real context.
        if (E === 'utf-8' && r.repairs.some((rp) => rp.reason === 'gap') && node.depth + 1 < ctx.opts.maxDepth) {
          const r2 = decodeBest(ctx, units, W, E, Object.assign({}, o, { deferRepairs: true }));
          if (r2 && r2.text !== r.text) {
            done.push({ E, r: r2, defer: true });
            emitChild(W, E, r2, true);
          }
        }
      }
      shared.set(key, done);
    }
  }

  // Mojibake signals that mark text as a known accident (and thus maybe an intermediate layer).
  const CLASSIC_SIGNALS = new Set(['utf8-as-1252', 'utf8-as-1251', 'utf8-as-mac', 'sjis-as-1252', 'utf8-as-gbk',
    'utf8-as-sjis', 'latin1-run', 'bom', 'cyrillic-case']);
  function classicMojibake(ctx, text) {
    const sc = ctx.score(text);
    if (sc.flags.indexOf('mojibake-pattern') >= 0) return true;
    try {
      return ctx.S.mojibakeSignals(text).some((x) => CLASSIC_SIGNALS.has(x.type));
    } catch (_) {
      return false;
    }
  }

  /** Beam search from one root. -> { nodes (improving chains), side (depth-1 non-improving), rootNode } */
  function searchRoot(ctx, root) {
    const opts = ctx.opts;
    const rootNode = { text: root.sample, chain: [], depth: 0, prior: 1, repairCost: 0, errors: 0, sv: root.sv, fit: root.fit, fffd: root.fffd, u: root.uBase, root };
    const all = new Map();
    const side = [];
    const seenAt = new Map([[root.sample, 0]]);
    // Which states to expand: the most plausible ones, but well-known accidents first (a
    // Windows-1256 reading of mojibake can look more "plausible" than the true intermediate
    // layer, which is itself mojibake by nature).
    const frontierRank = (n) => n.u + TUNE.FRONTIER_PRIOR_W * LN(n.prior);
    let frontier = [rootNode];
    for (let depth = 1; depth <= opts.maxDepth && frontier.length; depth++) {
      const level = new Map();
      const relay = new Map();
      for (const node of frontier) {
        expand(ctx, root, node, (child, improved) => {
          const at = seenAt.get(child.text);
          if (at !== undefined && at < depth) return;
          if (child.chain[child.chain.length - 1].defer) {
            // Kept U+FFFD for the next layer to repair: a stepping stone, never a result.
            if (depth < opts.maxDepth && (!relay.has(child.text) || relay.get(child.text).u < child.u)) relay.set(child.text, child);
            return;
          }
          if (!improved) {
            if (depth === 1) side.push(child);
            // A classic accident that produced recognisable mojibake is probably a layer of a
            // deeper chain even though it looks no better than its parent.
            if (depth < opts.maxDepth && child.stepPrior >= TUNE.RELAY_PRIOR && !level.has(child.text) &&
              (!relay.has(child.text) || relay.get(child.text).u < child.u) && classicMojibake(ctx, child.text)) {
              relay.set(child.text, child);
            }
            return;
          }
          const prev = level.get(child.text);
          if (!prev || child.u > prev.u) level.set(child.text, child);
        });
        if (overBudget(ctx)) break;
      }
      const kids = Array.from(level.values()).sort((a, b) => b.u - a.u);
      for (const k of kids) {
        seenAt.set(k.text, depth);
        all.set(k.text, k);
      }
      const pool = kids.concat(Array.from(relay.values()).filter((r) => !level.has(r.text)));
      pool.sort((a, b) => frontierRank(b) - frontierRank(a));
      frontier = pool.slice(0, opts.beamWidth);
      for (const n of frontier) if (!seenAt.has(n.text)) seenAt.set(n.text, depth);
    }
    side.sort((a, b) => b.u - a.u);
    return { nodes: Array.from(all.values()), side: side.slice(0, 8), rootNode };
  }

  // ---------------------------------------------------------------------------
  // Replaying a chain on the full text, building hypotheses
  // ---------------------------------------------------------------------------

  function transcodeStep(ctx, before, r, W, E, partial) {
    const step = {
      kind: 'transcode',
      wrongDecoder: W,
      trueEncoding: E,
      scheme: null,
      before,
      after: r.text,
      bytes: r.bytes,
      segmentsBefore: r.segsBefore,
      segmentsAfter: r.segsAfter,
      repairs: r.repairs,
      lossy: !!r.lossy,
      scoreBefore: ctx.score(before).value,
      scoreAfter: ctx.score(r.text).value,
      prior: pairPrior(E, W, before),
    };
    if (partial) step.partial = true;
    return step;
  }

  /**
   * Applies chain links ({ kind: 'transcode', W, E } | { kind: 'unescape', scheme, E }) to a full
   * text in tolerant mode: characters W cannot encode and bytes E cannot decode keep their
   * original form, which makes the result 'partial'.
   */
  function runChain(ctx, text, chain, lossy) {
    const steps = [];
    let cur = text;
    let partial = false;
    for (let li = 0; li < chain.length; li++) {
      const link = chain[li];
      if (link.kind === 'unescape') {
        const u = unescapeWith(ctx, cur, link.scheme, link.E);
        if (!u) break;
        steps.push(u.step);
        cur = u.text;
        continue;
      }
      const C = ctx.C;
      if (!C.get(link.W) || !C.get(link.E) || link.W === link.E) break;
      const surface = !steps.some((st) => st.kind === 'transcode');
      const rest = chain.slice(li + 1);
      const r = transcode(ctx, cur, link.W, link.E, {
        lossy, tolerant: true, tail: false, surface, maxCandidates: rest.length ? 64 : 6, deferRepairs: !!link.defer,
      });
      if (!r) break;
      if (r.repairs.length && rest.length && rest.every((l) => l.kind === 'transcode')) refineThroughChain(ctx, r, rest);
      const part = r.passed > 0 || r.kept > 0;
      if (part) partial = true;
      steps.push(transcodeStep(ctx, cur, r, link.W, link.E, part));
      cur = r.text;
    }
    return { output: cur, steps, partial };
  }

  /**
   * A repair made in an intermediate layer guesses a character of the *intermediate* mojibake:
   * its quality only shows after the remaining layers. Each candidate is pushed through those
   * layers on a small window and judged on the final text.
   */
  function refineThroughChain(ctx, r, rest) {
    const chars = r.segsAfter.map((sg) => sg.ch);
    // Every candidate of a few repairs (a double layer), the likeliest ones of many.
    const width = r.repairs.length <= 24 ? 64 : 8;
    for (const rp of r.repairs) {
      const cands = (rp.candidates || []).slice(0, width);
      const i = rp.index;
      if (cands.length < 2 || i < 0 || i >= chars.length) continue;
      const lo = Math.max(0, i - 12);
      const hi = Math.min(chars.length, i + 13);
      let best = rp.to;
      let bestV = -Infinity;
      for (const cand of cands) {
        chars[i] = cand;
        let t = chars.slice(lo, hi).join('');
        for (const l of rest) {
          const x = transcode(ctx, t, l.W, l.E, { lossy: false, tolerant: true, tail: false, surface: false });
          if (!x) break;
          t = x.text;
        }
        const v = ctx.S.score(t).total;
        if (v > bestV + 1e-9) {
          bestV = v;
          best = cand;
        }
      }
      chars[i] = best;
      rp.to = best;
      rp.candidates = [best].concat(cands.filter((c) => c !== best)).slice(0, 6);
      r.segsAfter[i] = Object.assign({}, r.segsAfter[i], { ch: best, candidates: rp.candidates });
    }
    for (const rp of r.repairs) if (rp.candidates && rp.candidates.length > 6) rp.candidates = rp.candidates.slice(0, 6);
    r.text = chars.join('');
  }

  /** Follows a character index of steps[k].after down to the final output (or -1). */
  function traceIndex(steps, k, idx) {
    for (let j = k + 1; j < steps.length; j++) {
      const st = steps[j];
      const before = st.segmentsBefore;
      const after = st.segmentsAfter;
      if (!before || !after || idx < 0 || idx >= before.length) return -1;
      const s = before[idx];
      let found = -1;
      for (let q = 0; q < after.length; q++) {
        const a = after[q];
        if (s.end > s.start ? a.end > s.start && a.start < s.end : a.start === s.start) {
          found = q;
          break;
        }
      }
      idx = found;
    }
    return idx;
  }

  function collectRepairs(steps) {
    const out = [];
    steps.forEach((st, k) => {
      for (const rp of st.repairs || []) {
        const index = k === steps.length - 1 ? rp.index : traceIndex(steps, k, rp.index);
        out.push(Object.assign({}, rp, { index, step: k }));
      }
    });
    return out;
  }

  const LAYER_WORDS = ['', '', '两层', '三层', '四层', '五层'];

  /** One-line Chinese description of a chain, e.g. 'UTF-8 被误读为 Windows-1252（两层）'. */
  function labelFor(steps, partial) {
    const tc = steps.filter((s) => s.kind === 'transcode').reverse(); // formation order
    let label = '';
    if (tc.length) {
      const same = tc.every((s) => s.trueEncoding === tc[0].trueEncoding && s.wrongDecoder === tc[0].wrongDecoder);
      if (same) {
        label = `${encName(tc[0].trueEncoding)} 被误读为 ${encName(tc[0].wrongDecoder)}`;
        if (tc.length > 1) label += `（${LAYER_WORDS[tc.length] || tc.length + ' 层'}）`;
      } else {
        label = tc.map((s, k) => {
          if (k === 0) return `${encName(s.trueEncoding)} 被误读为 ${encName(s.wrongDecoder)}`;
          return s.trueEncoding === tc[k - 1].wrongDecoder
            ? `又被误读为 ${encName(s.wrongDecoder)}`
            : `再以 ${encName(s.trueEncoding)} 保存后被误读为 ${encName(s.wrongDecoder)}`;
        }).join('，');
      }
    }
    const esc = steps.filter((s) => s.kind === 'unescape');
    if (esc.length) {
      const what = esc.map((s) => SCHEME_NAMES[s.scheme] + (s.trueEncoding ? `（${encName(s.trueEncoding)} 字节）` : '')).join(' + ');
      label = label ? `${what}，内含乱码：${label}` : what;
    }
    let repairs = 0;
    for (const s of steps) repairs += (s.repairs || []).length;
    if (repairs) label += `，修复 ${repairs} 处残缺`;
    if (partial) label = `局部还原：${label}`;
    return label;
  }

  /** Softmax share among the competing readings (the untouched input included) × plausibility. */
  function confidenceOf(u, others, sv, partial) {
    const list = [0].concat(others);
    let m = u;
    for (const x of list) if (x > m) m = x;
    const self = Math.exp((u - m) / TUNE.TAU);
    let z = self;
    for (const x of list) z += Math.exp((x - m) / TUNE.TAU);
    const plaus = 1 / (1 + Math.exp(-(sv - TUNE.PLAUS_MID) * TUNE.PLAUS_K));
    const c = (self / z) * plaus * (partial ? 0.85 : 1);
    return Math.round(Math.max(0, Math.min(1, c)) * 1000) / 1000;
  }

  function hypothesisFrom(ctx, steps, output, confidence, partial) {
    return {
      output,
      confidence,
      score: ctx.score(output),
      steps,
      repairs: collectRepairs(steps),
      lang: ctx.S.detectLang(output),
      label: labelFor(steps, partial),
    };
  }

  /** Does node a continue the chain of node b (same root, b's links as a prefix)? */
  function extendsChain(a, b) {
    if (a.root !== b.root || a.chain.length <= b.chain.length) return false;
    for (let k = 0; k < b.chain.length; k++) {
      const x = a.chain[k];
      const y = b.chain[k];
      if (x.kind !== y.kind || x.W !== y.W || x.E !== y.E || x.scheme !== y.scheme) return false;
    }
    return true;
  }

  /** Full-text hypotheses for ranked search nodes, distinct by output. */
  function buildHypotheses(ctx, nodes, limit, minU) {
    const us = nodes.slice(0, 12).map((n) => n.u);
    const out = [];
    const seen = new Set([ctx.input]);
    for (const node of nodes) {
      if (out.length >= limit) break;
      if (node.u < minU) break;
      if (out.length && node.u < out[0].node.u - TUNE.ALT_WINDOW) break;
      const run = runChain(ctx, node.root.full, node.chain, ctx.opts.allowLossy);
      const steps = node.root.pre.concat(run.steps);
      if (!steps.length || seen.has(run.output)) continue;
      seen.add(run.output);
      // Deeper chains that merely extend this one are refinements of it, not competitors.
      // On a few characters of evidence ("Â©", "Ð»Ð»") a classic accident does not compete with
      // exotic or multi-layer stories that happen to land on some letter.
      // (Two bytes of evidence for one CJK character, as in "Â°" read as EUC-KR 째, are not enough.)
      const classicShort = !!ctx.classicShape && node.depth === 1 && node.prior >= TUNE.SHORT_CLASSIC_PRIOR && node.root.N <= TUNE.SHORT_N &&
        (node.root.N >= 3 || node.chain[0].E === 'utf-8');
      const others = us.filter((x, k) => nodes[k] !== node && !extendsChain(nodes[k], node) &&
        !(classicShort && (nodes[k].depth > 1 || nodes[k].prior < TUNE.SHORT_RIVAL_PRIOR)));
      const conf = confidenceOf(node.u, others, node.sv, run.partial);
      out.push({ hyp: hypothesisFrom(ctx, steps, run.output, conf, run.partial), partial: run.partial, node });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Partial repair
  // ---------------------------------------------------------------------------

  /**
   * The span judge of a partial repair over `text`: a changed span is kept when it clearly
   * improves its neighbourhood. acc.changed counts the non-ASCII characters it rewrote.
   */
  function acceptorFor(ctx, text) {
    // The text as repaired so far: spans are judged left to right, so the left context of a
    // span already shows the repairs before it.
    const view = Array.from(text);
    const acc = { changed: 0, lastEnd: -1e9 };
    acc.accept = (span) => {
      const nIn = nonAsciiCount(span.inText);
      if (nIn < 2 || span.outText.indexOf(FFFD) >= 0) return false;
      ctx.work += span.inText.length + 24;
      const left = view.slice(Math.max(0, span.i0 - 12), span.i0).join('');
      const right = view.slice(span.i1, span.i1 + 12).join('');
      const a = ctx.S.score(left + span.inText + right);
      const b = ctx.S.score(left + span.outText + right);
      // Same bytes, different lengths: compare totals over the geometric mean of the lengths.
      const gain = (b.total * Math.sqrt(a.length / Math.max(1, b.length)) - a.total) / nIn;
      let ok = gain >= TUNE.PARTIAL_GAIN && b.value >= TUNE.PARTIAL_ABS;
      // The rest of a line whose first half was just repaired (or a span carrying C1 controls,
      // which no real text contains) only has to read well by itself: its right context is
      // still the garbled input, which drags the comparison down.
      if (!ok && gain >= TUNE.PARTIAL_GAIN && (hasC1(span.inText) || span.i0 - acc.lastEnd <= 8)) {
        ok = ctx.S.score(span.outText).value >= TUNE.PARTIAL_ABS;
      }
      if (!ok) return false;
      acc.changed += nIn;
      acc.lastEnd = span.i1;
      view[span.i0] = span.outText;
      for (let k = span.i0 + 1; k < span.i1; k++) view[k] = '';
      return true;
    };
    return acc;
  }

  /** Partial repairs decode once (the acceptor keeps state): pick the byte form beforehand. */
  function preferAlt(ctx, units, W, E) {
    const o = { lossy: false, tolerant: true, surface: true };
    const a = decodeUnits(ctx, units, W, E, o);
    const b = decodeUnits(ctx, units.alt, W, E, o);
    return !!a && !!b && (b.kept < a.kept || (b.kept === a.kept && layerFit(ctx, b.text) > layerFit(ctx, a.text)));
  }

  /** One pair applied to a whole text in partial (tolerant + acceptor) mode. */
  function partialApply(ctx, text, W, E) {
    const units = encodeFor(ctx, text, W, { lossy: false, tolerant: true });
    if (!units || allAscii(units.bytes)) return null;
    const acc = acceptorFor(ctx, text);
    ctx.explored++;
    const r = decodeUnits(ctx, units.alt && preferAlt(ctx, units, W, E) ? units.alt : units, W, E, { lossy: ctx.opts.allowLossy, tolerant: true, surface: true, accept: acc.accept });
    if (!r || !acc.changed || r.text === text) return null;
    return { r, changed: acc.changed };
  }

  /** Ranking of one partial repair of `text` (see partialRound). */
  function partialValue(ctx, text, fit0, r, changed, p) {
    const after = ctx.score(r.text);
    // Accept on the gain per repaired character; among accepted pairs, keep the one that
    // improves the text most overall (a 2-character tweak must not beat the real fix).
    const total = after.total * Math.sqrt(fit0.length / Math.max(1, after.length)) - fit0.total + TUNE.PRIOR_W * LN(p) * changed;
    return { u: total / changed, total, sv: after.value };
  }

  /**
   * Repairs the runs of a text that one well-known accident explains, leaving everything else
   * alone (mixed pages: a Chinese template around double-encoded database content, a sentence
   * with one garbled name, ...). Each candidate span must clearly improve its neighbourhood.
   * `allowFull`: rewriting every non-ASCII character is allowed (the main search never saw them).
   */
  function partialRound(ctx, text, allowFull) {
    const fit0 = ctx.score(text);
    const nonAsciiTotal = nonAsciiCount(text);
    const pairs = [];
    for (const W of ctx.ids) {
      for (const E of ctx.ids) {
        if (E === W) continue;
        const p = pairPrior(E, W, text);
        if (p >= TUNE.PARTIAL_MIN_PRIOR) pairs.push({ E, W, p });
      }
    }
    pairs.sort((a, b) => b.p - a.p);
    let best = null;
    for (const { E, W, p } of pairs) {
      if (overBudget(ctx)) break;
      const res = partialApply(ctx, text, W, E);
      if (!res) continue;
      // Rewriting every non-ASCII character is not a partial repair but a full reading, which
      // the main search already judged (and rejected).
      if (!allowFull && res.changed >= nonAsciiTotal) continue;
      const v = partialValue(ctx, text, fit0, res.r, res.changed, p);
      if (v.u >= TUNE.GAIN_MIN && (!best || v.total > best.total)) best = Object.assign(v, { r: res.r, W, E, p, changed: res.changed });
    }
    return best;
  }

  const PARTIAL_PROBE = 1500; // code points the pair choice of a partial repair looks at

  /**
   * partialRound on a bounded window of a long text (its prefix, or windows around its
   * suspicious spots), then the chosen pair replayed once over the whole text.
   */
  function partialPass(ctx, text, allowFull) {
    const probe = sampleOf(text, PARTIAL_PROBE, ctx.S);
    if (!probe.truncated) return partialRound(ctx, text, allowFull);
    const pick = partialRound(ctx, probe.sample, true);
    if (!pick) return null;
    const res = partialApply(ctx, text, pick.W, pick.E);
    if (!res || (!allowFull && res.changed >= nonAsciiCount(text))) return null;
    const v = partialValue(ctx, text, ctx.score(text), res.r, res.changed, pick.p);
    if (v.u < TUNE.GAIN_MIN) return null;
    return Object.assign(v, { r: res.r, W: pick.W, E: pick.E, p: pick.p, changed: res.changed });
  }

  function partialSearch(ctx, text, allowFull) {
    const first = partialPass(ctx, text, allowFull);
    if (!first) return null;
    const steps = [transcodeStep(ctx, text, first.r, first.W, first.E, true)];
    let cur = first.r.text;
    let u = first.u;
    let sv = first.sv;
    // A second accident on top of the first (double encoding), or the same accident in spans
    // the first pass could not reach. The same pair again is only a further layer when the
    // spans it changes now are output of the first pass.
    const second = overBudget(ctx) ? null : partialPass(ctx, cur, allowFull);
    if (second && second.sv > sv) {
      steps.push(transcodeStep(ctx, cur, second.r, second.W, second.E, true));
      cur = second.r.text;
      u = Math.max(u, second.u);
      sv = second.sv;
    }
    return hypothesisFrom(ctx, steps, cur, confidenceOf(u, [], sv, true), true);
  }

  // ---------------------------------------------------------------------------
  // Verdict helpers
  // ---------------------------------------------------------------------------

  /**
   * Final sanity check of a reading of the whole input: the region it changed (common prefix
   * and suffix trimmed, a little context kept) must not read worse than the input did there.
   * U+FFFD count as poor characters (fitOf), not as the scorer's worst ones.
   */
  function degrades(ctx, input, output) {
    if (output === input) return false;
    let a = 0;
    const max = Math.min(input.length, output.length);
    while (a < max && input.charCodeAt(a) === output.charCodeAt(a)) a++;
    let b = 0;
    while (b < max - a && input.charCodeAt(input.length - 1 - b) === output.charCodeAt(output.length - 1 - b)) b++;
    // Back off to code point boundaries.
    const hi = (s, i) => i > 0 && i < s.length && s.charCodeAt(i) >= 0xdc00 && s.charCodeAt(i) <= 0xdfff;
    while (a > 0 && (hi(input, a) || hi(output, a))) a--;
    while (b > 0 && (hi(input, input.length - b) || hi(output, output.length - b))) b--;
    const left = input.slice(Math.max(0, a - 12), a);
    const right = input.slice(input.length - b, input.length - b + 12);
    const fi = fitOf(ctx, left + input.slice(a, input.length - b) + right);
    const fo = fitOf(ctx, left + output.slice(a, output.length - b) + right);
    return fo.total * Math.sqrt(fi.len / Math.max(1, fo.len)) < fi.total - 1e-9;
  }

  /**
   * Input characters (code point indices) whose bytes a one-layer reading turned into new
   * U+FFFD markers of loss. Only for single transcode steps; otherwise [].
   */
  const CJK_CODEPAGES = new Set(['gbk', 'big5', 'shift_jis', 'euc-jp', 'euc-kr']);
  /** Is the surface layer of this chain one CJK double-byte code page read as another? */
  function crossCjk(chain) {
    const l = chain.find((x) => x.kind === 'transcode');
    return !!l && CJK_CODEPAGES.has(l.W) && CJK_CODEPAGES.has(l.E);
  }

  /** Are the input characters at these code point indices outside every mojibake signal match? */
  function intactChars(text, idx, signals) {
    if (!signals.length) return true;
    const cps = Array.from(text);
    let off = 0;
    const at = [];
    for (let k = 0; k < cps.length; k++) {
      at.push(off);
      off += cps[k].length;
    }
    return idx.every((k) => {
      const o = at[k];
      return o !== undefined && !signals.some((s) => o >= s.index && o < s.index + s.match.length);
    });
  }

  function lostInputChars(hyp) {
    const st = hyp.steps.length === 1 ? hyp.steps[0] : null;
    if (!st || st.kind !== 'transcode' || !st.segmentsBefore || !st.segmentsAfter) return [];
    const out = [];
    for (const a of st.segmentsAfter) {
      if (!a.lost || a.ch !== FFFD || a.end <= a.start) continue;
      st.segmentsBefore.forEach((b, k) => {
        if (b.end > a.start && b.start < a.end && b.ch !== FFFD && out.indexOf(k) < 0) out.push(k);
      });
    }
    return out;
  }

  function findSignatures(text) {
    const out = [];
    for (const def of SIG_DEFS) {
      let hit;
      if (def.find) hit = def.find(text);
      else {
        def.re.lastIndex = 0;
        const m = def.re.exec(text);
        hit = m && (!def.test || def.test(text, m)) ? { match: m[0], index: m.index } : null;
      }
      if (!hit) continue;
      out.push({ id: def.id, title: def.title, match: hit.match, index: hit.index, note: def.note });
    }
    return out.sort((a, b) => a.index - b.index);
  }

  /**
   * Runs of two or more '?' that are not attached to a preceding letter / digit (emphasis) and
   * are not the "a ?? b" / "??=" operator. -> [{ match, index, field }]; `field`: the run is a
   * value after ':' or '='.
   */
  function lostQuestionRuns(text) {
    const runs = [];
    const re = /\?{2,}/g;
    let m;
    while ((m = re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 3), m.index);
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 2);
      if (before && /[\p{L}\p{N}]$/u.test(before)) continue;
      if (m[0].length === 2 && (/^=/.test(after) || (/[\w)\]]\s$/.test(before) && /^\s[\w(]/.test(after)))) continue;
      runs.push({ match: m[0], index: m.index, field: /[:：=]\s*$/.test(before) });
    }
    return runs;
  }

  /** Signatures that only the analysis can reveal (the chain, not the glyphs, is the clue). */
  function chainSignatures(result) {
    const best = result.best;
    if (!best) return;
    const bush = best.steps.some((s) => s.kind === 'transcode' && isUtf16(s.wrongDecoder) && !isUtf16(s.trueEncoding) &&
      /^[\x09\x0a\x0d\x20-\x7e]+$/.test(s.after) && (s.after.match(/[A-Za-z]/g) || []).length >= 4);
    if (bush && !result.signatures.some((s) => s.id === 'notepad-bush')) {
      result.signatures.push({ id: 'notepad-bush', title: 'Bush hid the facts', match: result.input.slice(0, 24), index: 0, note: BUSH_NOTE });
    }
  }

  // Symbols and typographic marks real text uses on their own (a copyright line, a unit, a bullet).
  const COMMON_SYMBOLS = new Set(Array.from(
    '©®™€£¥¢°№℃℉²³¹§¶†‡•·・…–—‘’“”‚„‹›«»¡¿±×÷µ‰′″※→←↑↓↔⇒◆◇□■○●◎★☆✓✔✗♪♥', (c) => c.codePointAt(0)));

  /** One or two code points (spaces aside), each one of COMMON_SYMBOLS. */
  function tinySymbols(text) {
    const cps = Array.from(text.trim()).filter((ch) => !/\s/.test(ch));
    if (!cps.length || cps.length > 2 || !cps.every((ch) => COMMON_SYMBOLS.has(ch.codePointAt(0)))) return false;
    // Two Latin-1 symbols in a row ("³×", "¾È") are one double-byte character read byte by byte.
    return cps.length === 1 || !cps.every((ch) => ch.codePointAt(0) >= 0xa0 && ch.codePointAt(0) <= 0xff);
  }

  /**
   * Last word on a restoration that rests on guesses: when guessed characters and new U+FFFD
   * outnumber the characters that survived intact, the result is a record of loss
   * ('irrecoverable', kept as an explanation); a Hanzi / kana / Hangul picked out of many
   * look-alikes caps the confidence.
   */
  function settleGuesses(result) {
    const b = result.best;
    if (!b || (result.status !== 'restored' && result.status !== 'partial')) return;
    let guessed = 0;
    let cjkGuess = false;
    for (const rp of b.repairs) {
      if (rp.reason === 'nbsp') continue;
      guessed++;
      if (rp.candidates && rp.candidates.length > 1 && rp.to && CJK_SCRIPTS.has(scriptOf(rp.to.codePointAt(0)))) cjkGuess = true;
    }
    if (!guessed) return;
    if (cjkGuess) b.confidence = Math.min(b.confidence, TUNE.CJK_GUESS_CONF);
  }

  function looksLikeMojibake(sc, signals) {
    if (signals.some((s) => STRONG_SIGNALS.has(s.type))) return true;
    return sc.value < -5 || (sc.length > 0 && sc.badness / sc.length > 0.25);
  }

  function lostEvidence(text, signatures) {
    if (signatures.some((s) => LOST_SIGS.has(s.id))) return true;
    const f = countChar(text, FFFD);
    return f > 0 && f >= 0.15 * Math.max(1, visibleLength(text));
  }

  // Relics that are bytes, not text (锟斤拷, 烫烫烫, ...): when they make up most of the input,
  // any "restoration" would only be a reading of debugger fill bytes or replacement markers.
  const BYTE_RELICS = new Set(['kunjinkao', 'kunjinkao-big5', 'tangtangtang', 'tuntuntun', 'qiqiqi']);
  function relicCoverage(text, signatures) {
    let covered = 0;
    for (const def of SIG_DEFS) {
      if (!BYTE_RELICS.has(def.id) || !signatures.some((s) => s.id === def.id)) continue;
      def.re.lastIndex = 0;
      let m;
      while ((m = def.re.exec(text))) covered += m[0].length;
    }
    return covered / Math.max(1, visibleLength(text));
  }

  /** For 锟斤拷-type relics: the chain that made them, shown as an explanation (not a rescue). */
  function lostExplanation(ctx, text, signatures) {
    const ids = new Set(signatures.map((s) => s.id));
    const W = ids.has('kunjinkao') ? 'gbk' : ids.has('kunjinkao-big5') ? 'big5' : null;
    if (!W || ctx.ids.indexOf(W) < 0) return null;
    const sig = signatures.find((s) => s.id === (W === 'gbk' ? 'kunjinkao' : 'kunjinkao-big5'));
    // Only the 锟斤拷 runs are explained (re-encoded and read as UTF-8); every other character
    // stays as typed ("密码正确" must not become "密码正ȷ").
    const def = SIG_DEFS.find((d) => d.id === sig.id);
    const spans = [];
    def.re.lastIndex = 0;
    let m;
    while ((m = def.re.exec(text))) {
      const i0 = cpLength(text.slice(0, m.index));
      spans.push([i0, i0 + cpLength(m[0])]);
    }
    const units = encodeFor(ctx, text, W, { lossy: false, tolerant: true });
    if (!units || !spans.length) return null;
    const accept = (span) => spans.some(([a, b]) => span.i0 >= a && span.i1 <= b);
    const r = decodeUnits(ctx, units, W, 'utf-8', { lossy: false, tolerant: true, surface: true, accept });
    if (!r || countChar(r.text, FFFD) <= countChar(text, FFFD)) return null;
    const partial = r.passed > 0 || r.kept > 0 || r.segsAfter.some((s) => s.kept);
    const steps = [transcodeStep(ctx, text, r, W, 'utf-8', partial)];
    const coverage = Math.min(1, (countChar(text, sig.match) * sig.match.length) / Math.max(1, text.length));
    return hypothesisFrom(ctx, steps, r.text, Math.round(0.6 * coverage * 1000) / 1000, partial);
  }

  function safeSignals(ctx, text) {
    try {
      return ctx.S.mojibakeSignals(text);
    } catch (_) {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function analyze(input, options) {
    const t0 = now();
    const opts = normalizeOptions(options);
    const ctx = makeCtx(opts);
    const text = input == null ? '' : String(input);
    ctx.input = text;
    const inputScore = ctx.score(text);
    const signals = safeSignals(ctx, text);
    const signatures = findSignatures(text);
    ctx.classicShape = signals.some((s) => CLASSIC_SIGNALS.has(s.type));
    const result = {
      input: text,
      status: 'clean',
      best: null,
      alternatives: [],
      signatures,
      signals,
      inputScore,
      stats: { explored: 0, ms: 0, truncated: false, budgetHit: false },
    };
    const finish = () => {
      settleGuesses(result);
      // Alternatives (and the guesses of an 'unknown' verdict) by confidence, highest first (stable).
      result.alternatives.sort((a, b) => b.confidence - a.confidence);
      result.stats.explored = ctx.explored;
      result.stats.budgetHit = !!ctx.budgetHit;
      result.stats.ms = Math.round((now() - t0) * 10) / 10;
      return result;
    };
    if (!text.trim()) return finish();
    // One or two common symbols ("©", "€", "™", "x²" is not: it has a letter) carry no evidence
    // of an accident unless they show a classic mojibake shape.
    if (tinySymbols(text) && !signals.some((s) => STRONG_SIGNALS.has(s.type))) return finish();

    // 1. Pre-pass: escape layers and the pure-ASCII shortcut.
    const ascii = !/[^\x00-\x7f]/.test(text);
    const escapes = opts.allowEscapes ? escapeCandidates(ctx, text, 0) : [];
    const roots = [];
    const relic = relicCoverage(text, signatures) >= 0.5;
    // A single character with no sign of an accident ("冇", "堃") is no evidence for any
    // reading: a rare Hanzi is still a Hanzi.
    const fewEvidence = cpLength(text.trim()) === 1 && inputScore.badness === 0 && !signals.some((s) => STRONG_SIGNALS.has(s.type));
    const rawRoot = !relic && !fewEvidence && (!ascii || controlSoup(text)) ? makeRoot(ctx, text, [], 0) : null;
    if (rawRoot) roots.push(rawRoot);
    for (const e of escapes) {
      const uBase = (e.credible ? TUNE.ESC_BASE : TUNE.ESC_BASE - 3) + 0.3 * LN(e.prior);
      roots.push(Object.assign(makeRoot(ctx, e.text, e.steps, uBase), { credible: e.credible, tailLost: e.tailLost || 0 }));
    }
    if (!roots.length && !relic) {
      if (signatures.some((s) => s.id === 'question-marks')) result.status = 'irrecoverable';
      return finish();
    }

    // 2. Search every root; credible escape layers are results by themselves.
    let nodes = [];
    let side = [];
    roots.forEach((r) => {
      const res = searchRoot(ctx, r);
      nodes = nodes.concat(res.nodes);
      side = side.concat(res.side);
      if (r.pre.length && r.credible) nodes.push(res.rootNode);
      if (r.truncated) result.stats.truncated = true;
    });
    nodes.sort((a, b) => b.u - a.u);

    let guesses = null;
    // 3. Verdict. With U+FFFD in the input, at least two intact non-ASCII characters must
    // support the chain: one surviving letter can be "explained" by anything.
    nodes = nodes.filter((n) => !n.root.fffd || n.root.core >= 2 || n.root.pre.length);
    // The mirror rule for invented bytes: a lone "→" or "Ö" is not a UTF-8 sequence that lost
    // a byte unless enough intact characters back the reading (at least half of the evidence).
    nodes = nodes.filter((n) => !n.invented || (n.root.nonAscii - n.invented >= 1 && n.invented <= 0.5 * n.root.nonAscii));
    // Several layers of exotic accidents can turn any junk into something readable.
    nodes = nodes.filter((n) => n.depth < 2 || n.minPrior >= TUNE.MULTI_MIN_PRIOR);
    const top = nodes[0];
    // A short relic that shows a classic mojibake shape ("–¼‘O" is 名前 in Shift_JIS read as
    // Windows-1252) and whose classic reading clearly leads may be restored on a smaller gain,
    // at low confidence.
    const classicShape = ctx.classicShape;
    const weakClassic = !!top && top.u > 0 && top.u < TUNE.GAIN_MIN && top.depth === 1 && top.prior >= TUNE.SHORT_CLASSIC_PRIOR &&
      classicShape && top.root.N <= TUNE.SHORT_N && (!nodes[1] || top.u - nodes[1].u >= TUNE.WEAK_LEAD);
    if (top && (top.u >= TUNE.GAIN_MIN || weakClassic) && top.sv >= TUNE.ABS_MIN) {
      // A replay on the full text must never read worse than the input it replaces.
      const hyps = buildHypotheses(ctx, nodes, opts.maxAlternatives + 1, weakClassic ? -Infinity : 0).filter((h) => !degrades(ctx, text, h.hyp.output));
      if (weakClassic && hyps.length) hyps[0].hyp.confidence = Math.max(TUNE.CREDIBLE_MIN, Math.min(hyps[0].hyp.confidence, TUNE.WEAK_CONF));
      const finalFit = hyps.length ? fitOf(ctx, hyps[0].hyp.output) : null;
      // A character cut off at the end of an escaped byte string is a truncation, not a loss.
      const cut = hyps.length ? Math.min(finalFit.fffd, hyps[0].node.root.tailLost || 0) : 0;
      const lossShare = hyps.length ? (finalFit.fffd - cut) / Math.max(1, visibleLength(hyps[0].hyp.output)) : 0;
      if (hyps.length && lossShare >= TUNE.LOST_SHARE) {
        // Mostly U+FFFD even after the best chain. A classic single accident whose surviving
        // text reads well is a damaged but genuine restoration; anything else is a record of loss.
        const h = hyps[0];
        const classic = h.node.depth === 1 && h.node.prior >= 0.4;
        result.status = classic && !h.partial && finalFit.core >= TUNE.HEAVY_CORE_MIN ? 'partial' : 'irrecoverable';
        result.best = classic ? h.hyp : null;
        if (result.best) result.best.confidence = Math.min(result.best.confidence, result.status === 'partial' ? 0.5 : 0.3);
        if (result.status === 'partial') result.alternatives = hyps.slice(1).map((x) => x.hyp);
        return finish();
      }
      if (hyps.length && hyps[0].hyp.confidence >= TUNE.CREDIBLE_MIN) {
        // A full reading that turns intact characters into U+FFFD ("The café menu" next to a
        // garbled "CafÃ©") loses to a partial repair that leaves them alone, when that reads
        // at least as well.
        const fffdIn = countChar(text, FFFD);
        const lostIdx = opts.allowPartial && !relic && countChar(hyps[0].hyp.output, FFFD) > fffdIn ? lostInputChars(hyps[0].hyp) : null;
        // (Only when those characters look intact: none of them inside a mojibake pattern.)
        if (lostIdx && lostIdx.length && intactChars(text, lostIdx, signals)) {
          const p = partialSearch(ctx, text, false);
          // The partial repair must keep exactly those characters as they were.
          if (p && p.steps.length === 1 && lostIdx.every((k) => p.steps[0].segmentsBefore[k] && p.steps[0].segmentsBefore[k].kept) &&
            countChar(p.output, FFFD) <= fffdIn && !degrades(ctx, text, p.output) &&
            fitOf(ctx, p.output).total >= fitOf(ctx, hyps[0].hyp.output).total) {
            result.status = 'partial';
            result.best = p;
            result.alternatives = hyps.slice(0, opts.maxAlternatives).map((h) => h.hyp);
            chainSignatures(result);
            return finish();
          }
        }
        result.best = hyps[0].hyp;
        result.alternatives = hyps.slice(1).map((h) => h.hyp);
        result.status = hyps[0].partial ? 'partial' : 'restored';
        chainSignatures(result);
        return finish();
      }
      // Many readings compete and none stands out (typical for random Latin-1 junk): these are
      // guesses, shown as alternatives of an 'unknown' verdict below.
      if (hyps.length) guesses = hyps.map((h) => h.hyp);
    }

    // 4. Fallbacks: partial repair, then explain the loss, then "unknown" or "clean".
    const suspicious = !fewEvidence && looksLikeMojibake(inputScore, signals);
    const lost = lostEvidence(text, signatures);
    const fffdShare = countChar(text, FFFD) / Math.max(1, visibleLength(text));
    if (opts.allowPartial && !relic && fffdShare < 0.15 && (suspicious || lost)) {
      // The partial search may rewrite every non-ASCII character when the main search never
      // saw them (a long text sampled elsewhere).
      const allowFull = !!rawRoot && rawRoot.truncated && rawRoot.nonAscii < nonAsciiCount(text);
      const p = partialSearch(ctx, text, allowFull);
      if (p && !degrades(ctx, text, p.output)) {
        result.status = 'partial';
        result.best = p;
        chainSignatures(result);
        return finish();
      }
    }
    if (lost) {
      result.status = 'irrecoverable';
      result.best = lostExplanation(ctx, text, signatures);
    } else if (suspicious || guesses) {
      result.status = 'unknown';
      if (guesses) {
        result.alternatives = guesses.slice(0, Math.min(3, opts.maxAlternatives));
        return finish();
      }
      const near = nodes.concat(side).sort((a, b) => b.u - a.u);
      result.alternatives = buildHypotheses(ctx, near, Math.min(3, opts.maxAlternatives), -Infinity).map((h) => h.hyp);
    }
    return finish();
  }

  /**
   * Replays a chain (Step objects, steps[0] = surface layer) on a text, typically the full text
   * after the search ran on a sample. -> { output, steps, partial }
   */
  function applyChain(input, steps, options) {
    const ctx = makeCtx(normalizeOptions(options));
    const chain = (Array.isArray(steps) ? steps : []).filter(Boolean).map((s) => (
      s.kind === 'unescape'
        ? { kind: 'unescape', scheme: s.scheme, E: s.trueEncoding || null }
        : { kind: 'transcode', W: s.wrongDecoder, E: s.trueEncoding }
    ));
    const run = runChain(ctx, input == null ? '' : String(input), chain, ctx.opts.allowLossy);
    return { output: run.output, steps: run.steps, partial: run.partial };
  }

  const Engine = {
    analyze,
    applyChain,
    PAIR_PRIORS,
    SIGNATURES,
    DEFAULTS,
    pairPrior: (E, W) => pairPrior(E, W, null),
    // Exposed for tests and tuning; not part of the documented contract.
    _internals: {
      TUNE, parseEscapes, sampleOf, findSignatures,
      /** Debug view of the search: the best nodes of the raw-input root with their ranking terms. */
      rank(input, options, limit) {
        const ctx = makeCtx(normalizeOptions(options));
        const root = makeRoot(ctx, String(input), [], 0);
        const res = searchRoot(ctx, root);
        return res.nodes.sort((a, b) => b.u - a.u).slice(0, limit || 10).map((n) => ({
          text: n.text, u: Math.round(n.u * 1000) / 1000, gain: Math.round(gainOf(root, n) * 1000) / 1000,
          sv: n.sv, fffd: n.fffd, depth: n.depth, prior: n.prior, repairCost: n.repairCost, errors: n.errors,
          chain: n.chain.map((l) => l.E + '>' + l.W).join(' | '),
        })).concat([{ root: { sv: root.sv, fffd: root.fffd, N: root.N, L: root.L, scale: root.scale } }]);
      },
    },
  };

  MBX.Engine = Engine;
  if (typeof module === 'object' && module.exports) module.exports = Engine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
