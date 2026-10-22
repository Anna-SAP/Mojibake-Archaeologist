/*
 * 乱码考古学家 · MBX.Narrator
 *
 * The built-in "museum docent": turns an AnalysisResult (docs/ARCHITECTURE.md §6)
 * into a witty, byte-accurate Chinese exhibit narration. It is the always-available
 * fallback when no LLM is configured, so it is built from three ingredients:
 *   1. a knowledge base of encoding history (ENCODING_FACTS / PAIR_FACTS / SIGNATURE_FACTS),
 *   2. data-driven "fact sentences" computed from THIS relic's real bytes
 *      (steps[i].segmentsBefore / segmentsAfter), and
 *   3. three docent voices (humor / academic / snark), each with several template
 *      variants per section, picked by a seeded RNG so output is deterministic per seed.
 *
 * Markup contract: section text may only contain **bold**, `code` and "\n".
 * Every piece of user-derived text goes through safe() so it can never inject markup.
 */
(function (root) {
  'use strict';
  const MBX = (root.MBX = root.MBX || {});

  /* ======================================================================
   * 1. Deterministic randomness
   * ==================================================================== */

  // FNV-1a over UTF-16 code units: tiny, fast and good enough to seed an RNG.
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Each section gets its own RNG stream (keyed by section name), so adding a
  // template variant to one section never reshuffles the others.
  function makeRng(key) {
    const next = mulberry32(fnv1a(key));
    next(); // discard the first draw; neighbouring seeds start out correlated
    return {
      next,
      pick(list) { return list[Math.floor(next() * list.length)]; },
      chance(p) { return next() < p; },
      shuffle(list) {
        const a = list.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          const t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
      },
    };
  }

  /* ======================================================================
   * 2. Small text helpers
   * ==================================================================== */

  const cps = (s) => Array.from(s == null ? '' : String(s));
  const hex2 = (b) => (b & 0xff).toString(16).toUpperCase().padStart(2, '0');
  const uplus = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

  function hex(bytes, start, end) {
    if (!bytes) return '';
    const s = start == null ? 0 : start;
    const e = end == null ? bytes.length : end;
    const out = [];
    for (let i = s; i < e && i < bytes.length; i++) out.push(hex2(bytes[i]));
    return out.join(' ');
  }

  // Neutralise anything in user-derived text that could be mistaken for markup or
  // break a one-line quote. Full-width look-alikes keep the text readable.
  function safe(s) {
    return String(s == null ? '' : s)
      .replace(/`/g, '｀')
      .replace(/\*/g, '＊')
      .replace(/\r\n|\r|\n/g, '⏎')
      .replace(/\t/g, ' ')
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '▫')
      .replace(/\uFEFF/g, '〔BOM〕');
  }

  function clip(s, n) {
    const a = cps(s);
    return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
  }

  const quote = (s, n) => '「' + safe(clip(s, n || 24)) + '」';
  const stripMarkup = (s) => String(s).replace(/\*\*/g, '').replace(/`/g, '');
  const countOf = (s, ch) => cps(s).filter((c) => c === ch).length;
  const isNum = (x) => typeof x === 'number' && isFinite(x);

  // Ideographs and kana: the characters that want a space next to an inserted Latin word.
  const HAN_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
  const isHan = (ch) => !!ch && HAN_RE.test(ch);
  // CJK punctuation / full-width forms: no padding needed next to these.
  const isCjkPunct = (ch) => !!ch && /[　-〿＀-￯—…“”‘’]/.test(ch);

  // Markup-free text for plainText: a **bold** or `code` span that starts or ends with a
  // Latin letter, digit or symbol gets a space where it touches a Chinese character, so
  // "名器印记**ï»¿**" reads "名器印记 ï»¿" instead of gluing the two together.
  function plainOf(s) {
    return String(s == null ? '' : s).replace(/\*\*([^*]*?)\*\*|`([^`]*)`/g, (m, bold, code, off, str) => {
      const inner = bold != null ? bold : code;
      if (!inner) return '';
      const a = Array.from(inner);
      const prev = str.charAt(off - 1);
      const next = str.charAt(off + m.length);
      let out = inner;
      if (isHan(prev) && !isHan(a[0]) && !isCjkPunct(a[0]) && a[0] !== ' ') out = ' ' + out;
      if (isHan(next) && !isHan(a[a.length - 1]) && !isCjkPunct(a[a.length - 1]) && a[a.length - 1] !== ' ') out += ' ';
      return out;
    }).replace(/\*\*/g, '').replace(/`/g, '');
  }

  function countMatches(haystack, needle) {
    if (!needle) return 0;
    let n = 0;
    let i = haystack.indexOf(needle);
    while (i !== -1) { n++; i = haystack.indexOf(needle, i + needle.length); }
    return n;
  }

  const INVISIBLE_NAMES = {
    0x0000: '空字符 NUL',
    0x00a0: '不换行空格 NBSP',
    0x00ad: '软连字符',
    0x200b: '零宽空格',
    0x200d: '零宽连接符',
    0xfeff: '字节顺序标记 BOM',
  };

  // Returns a Chinese description for characters that would be invisible or
  // misleading if printed raw; null for ordinary visible characters.
  function invisibleKind(cp) {
    if (INVISIBLE_NAMES[cp]) return INVISIBLE_NAMES[cp];
    if (cp <= 0x1f || cp === 0x7f) return 'C0 控制符';
    if (cp >= 0x80 && cp <= 0x9f) return 'C1 控制符';
    if (cp >= 0xe000 && cp <= 0xf8ff) return '私用区字符';
    if (cp >= 0xd800 && cp <= 0xdfff) return '孤立代理项';
    if (cp === 0x20) return '空格';
    try {
      if (/[\p{Z}\p{Cf}\p{Mn}\p{Me}\p{Cn}\p{Co}]/u.test(String.fromCodePoint(cp))) return '不可见字符';
    } catch (_) { /* engines without property escapes: treat as visible */ }
    return null;
  }

  // A garbled character, shown as inline code. Invisible ones become `U+XXXX`.
  function showGlyph(ch) {
    if (!ch) return '`?`';
    const cp = ch.codePointAt(0);
    const kind = invisibleKind(cp);
    if (kind) return '`' + uplus(cp) + '`（' + kind + '）';
    if (ch === '`' || ch === '*') return '`' + uplus(cp) + '`';
    return '`' + ch + '`';
  }

  // An original (correct) character, shown in Chinese corner quotes.
  function showChar(ch) {
    if (!ch) return '「?」';
    const cp = ch.codePointAt(0);
    const kind = invisibleKind(cp);
    if (kind) return '`' + uplus(cp) + '`（' + kind + '）';
    return '「' + safe(ch) + '」';
  }

  function utf8Of(cp) {
    if (cp < 0x80) return [cp];
    if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 63)];
    if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
    return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
  }

  // "U+5927 = 0101 1001 0010 0111 → 1110xxxx 10xxxxxx 10xxxxxx" for the academic voice.
  function utf8Layout(cp) {
    let bits;
    let groups;
    let tpl;
    if (cp < 0x80) return null;
    if (cp < 0x800) { bits = 11; groups = [5, 6]; tpl = '110xxxxx 10xxxxxx'; }
    else if (cp < 0x10000) { bits = 16; groups = [4, 6, 6]; tpl = '1110xxxx 10xxxxxx 10xxxxxx'; }
    else { bits = 21; groups = [3, 6, 6, 6]; tpl = '11110xxx 10xxxxxx 10xxxxxx 10xxxxxx'; }
    const bin = cp.toString(2).padStart(bits, '0');
    const prefixes = groups.length === 2 ? ['110', '10'] : groups.length === 3 ? ['1110', '10', '10'] : ['11110', '10', '10', '10'];
    let pos = 0;
    const filled = groups.map((g, i) => { const part = bin.slice(pos, pos + g); pos += g; return prefixes[i] + part; });
    return {
      // grouped in fours from the least significant end: 000 1110 0011, 0 0001 1111 …
      binary: bin.replace(/\B(?=(\d{4})+$)/g, ' '),
      split: groups.join('+'),
      template: tpl,
      filled: filled.join(' '),
    };
  }

  // Template filler: "{name}" placeholders; template may also be a function(vars) or a
  // conditional entry { t, if } (see usable()). A value that begins or ends with a Chinese
  // character swallows the template's own space on that side ("分 {W} 一半" + "那个解码器"
  // must not read "分 那个解码器 一半").
  function fill(tpl, vars, strict) {
    if (tpl && typeof tpl === 'object' && 't' in tpl) tpl = tpl.t;
    if (typeof tpl === 'function') return tpl(vars);
    const src = String(tpl);
    const re = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(src))) {
      const k = m[1];
      let v = vars[k];
      if (v === undefined || v === null) {
        if (strict) throw new Error('Narrator: missing template variable "' + k + '"');
        v = '';
      }
      v = String(v);
      let before = src.slice(last, m.index);
      let skipAfter = 0;
      const head = v.charAt(0);
      const tail = v.charAt(v.length - 1);
      if (v && (isHan(head) || head === '「') && / $/.test(before) && isHan((out + before).slice(-2, -1))) before = before.slice(0, -1);
      if (v && (isHan(tail) || tail === '」') && src.charAt(re.lastIndex) === ' ' && isHan(src.charAt(re.lastIndex + 1))) skipAfter = 1;
      out += before + v;
      last = re.lastIndex + skipAfter;
    }
    return out + src.slice(last);
  }

  // Template lists may carry conditional entries { t, if(c) }; this keeps the ones that apply
  // (and never returns an empty list when the input had plain entries).
  function usable(list, c) {
    if (!Array.isArray(list)) return [];
    const ok = list.filter((x) => !(x && typeof x === 'object' && typeof x.if === 'function') || x.if(c));
    return ok.length ? ok : list.filter((x) => !(x && typeof x === 'object' && typeof x.if === 'function'));
  }

  const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
  const LAYER_WORDS = ['零', '单', '双', '三', '四', '五', '六'];
  const layerWord = (n) => (LAYER_WORDS[n] || String(n)) + '层';

  /* ======================================================================
   * 3. Knowledge base
   * ==================================================================== */

  const STYLES = [
    { id: 'humor', name: '幽默讲解员', avatar: '🧑‍🏫', tagline: '把字节讲成段子', docents: ['老周', '小葵', '阿宽', '豆豆', '大刘'] },
    { id: 'academic', name: '学术研究员', avatar: '👩‍🔬', tagline: '每个结论都有字节作证', docents: ['林教授', '沈研究员', '顾博士', '许馆员'] },
    { id: 'snark', name: '毒舌鉴定师', avatar: '🧐', tagline: '嘴上不饶人，结论很靠谱', docents: ['老刁', '阿 K', '冷面老陈', '毒舌小金'] },
  ];

  // One naming family for every language code (the Scorer's "英语 / 俄语" style), so a clean
  // relic and a restored one never call the same language by two names.
  const LANG_NAMES = {
    'zh-Hans': '简体中文', 'zh-Hant': '繁体中文', ja: '日语', ko: '韩语', ru: '俄语', uk: '乌克兰语',
    el: '希腊语', he: '希伯来语', ar: '阿拉伯语', th: '泰语', tr: '土耳其语', pl: '波兰语', cs: '捷克语',
    en: '英语', fr: '法语', de: '德语', es: '西班牙语', pt: '葡萄牙语', it: '意大利语',
    latin: '拉丁字母文本', emoji: 'emoji', mixed: '多语种混合文本', unknown: '未知语言',
  };
  // Written-language nouns for analogies ("把中文菜谱用法语念出来").
  const LANG_SHORT = {
    'zh-Hans': '中文', 'zh-Hant': '中文', ja: '日文', ko: '韩文', ru: '俄文', uk: '乌克兰文', el: '希腊文',
    he: '希伯来文', ar: '阿拉伯文', th: '泰文', tr: '土耳其文', pl: '波兰文', cs: '捷克文', en: '英文',
    fr: '法文', de: '德文', es: '西班牙文', pt: '葡萄牙文', it: '意大利文',
  };
  // The language a wrong decoder's home region reads ("用法语念出来").
  const REGION_SPEECH = {
    west: '法语', cyrillic: '俄语', 'zh-Hans': '中文', 'zh-Hant': '中文', ja: '日语', ko: '韩语', greek: '希腊语',
    'central-eu': '波兰语', turkish: '土耳其语', hebrew: '希伯来语', arabic: '阿拉伯语', thai: '泰语',
  };

  // type/region mirror Codecs.ENCODINGS so the narrator works even if codecs.js is absent.
  // misread: short label used in titles ("西欧误读型").
  const ENCODING_FACTS = {
    'utf-8': {
      name: 'UTF-8', zh: '万国码 UTF-8', type: 'utf8', region: 'universal', misread: 'UTF-8',
      born: 1992, bornLabel: '1992 年 9 月', py: 'utf-8', iconv: 'UTF-8',
      birthplace: '美国新泽西州的一家餐馆：Ken Thompson 在餐垫上画出了设计，Rob Pike 在旁见证',
      nickname: '互联网的通用语',
      story: 'UTF-8 由 Ken Thompson 与 Rob Pike 于 1992 年 9 月设计，1993 年 1 月在 USENIX 大会上亮相；RFC 3629（2003）把它限定为最多 4 字节、上限 U+10FFFF。它完全兼容 ASCII，常用汉字占 3 字节，emoji 占 4 字节。',
      trivia: [
        'UTF-8 的设计是 Ken Thompson 在新泽西一家餐馆的餐垫上画出来的，Rob Pike 在一旁见证——今天全世界绝大多数网页用的编码，诞生在一张餐垫上。',
        'UTF-8 最初允许长达 6 字节的序列，RFC 3629（2003）把它砍到 4 字节，正好够到 Unicode 的上限 U+10FFFF。',
        'UTF-8 有个优雅的性质：续字节永远长成 10xxxxxx，所以从任意位置切进去，最多往回退 3 个字节就能找到字符边界。',
      ],
    },
    gbk: {
      name: 'GBK', zh: '简体中文 GBK（代码页 936）', type: 'double', region: 'zh-Hans', misread: '简中',
      born: 1995, bornLabel: '1995 年', py: 'gbk', iconv: 'GBK',
      birthplace: '中国大陆，随简体中文版 Windows 95 普及',
      nickname: '国标扩展',
      story: 'GB2312（1980）只收录 6763 个汉字；1995 年的 GBK 把它扩展到两万多字，成为简体中文 Windows 的代码页 936；后来的 GB 18030-2000 成为在中国大陆销售软件的强制标准，2022 年又发布了 GB 18030-2022。GBK 里一个汉字占 2 个字节。',
      trivia: [
        'GBK 的 K 是"扩"字拼音 kuò 的首字母——"国标扩展"。',
        'GB2312 只收了 6763 个汉字，「镕」字就不在其中，这在当年让不少排版系统犯了难。',
        '在 WHATWG 的 GBK 解码器里，单独出现的 `0x80` 会被解成欧元符号 €——这是代码页 936 留下的历史遗产。',
      ],
    },
    big5: {
      name: 'Big5', zh: '繁体中文 Big5（代码页 950）', type: 'double', region: 'zh-Hant', misread: '繁中',
      born: 1984, bornLabel: '1984 年', py: 'big5', iconv: 'BIG5',
      birthplace: '台湾，资讯工业策进会',
      nickname: '大五码',
      story: 'Big5（大五码）1984 年由台湾资讯工业策进会制定，得名于当年参与的"五大中文套装软件"；微软的对应代码页是 950。一个汉字占 2 个字节。',
      trivia: [
        'Big5 有著名的"許功蓋"问题：这几个字的第二个字节都是 `0x5C`，也就是反斜杠，在 C 语言字符串和文件路径里会被当成转义符，引发各种灵异事件。',
      ],
    },
    shift_jis: {
      name: 'Shift_JIS', zh: '日文 Shift_JIS（代码页 932）', type: 'double', region: 'ja', misread: '日文',
      born: 1983, bornLabel: '上世纪 80 年代初', py: 'cp932', iconv: 'CP932',
      birthplace: '日本，ASCII 公司与微软',
      nickname: '日文 Windows 的母语',
      story: 'Shift_JIS 由日本 ASCII 公司与微软在上世纪 80 年代初设计，把 JIS X 0208 的双字节字符"挪"（shift）到不与半角片假名冲突的字节区间；微软的变体是代码页 932（CP932）。0xA1–0xDF 是单字节的半角片假名。',
      trivia: [
        'Shift_JIS 里「表」「ソ」「能」的第二个字节都是 `0x5C`，也就是反斜杠。日本程序员把这类字叫作"ダメ文字"（问题字），它们曾让无数路径和字符串莫名其妙地坏掉。',
        '"Mojibake" 这个词本身就来自日语"文字化け"：moji 是"文字"，bake 是"变身、妖怪化"。',
      ],
    },
    'euc-jp': {
      name: 'EUC-JP', zh: '日文 Unix 编码 EUC-JP', type: 'double', region: 'ja', misread: '日文',
      born: 1985, bornLabel: '上世纪 80 年代', py: 'euc_jp', iconv: 'EUC-JP',
      birthplace: '日本的 Unix 工作站',
      nickname: 'Unix 上的日文',
      story: 'EUC-JP（日文扩展 Unix 编码）是 Unix 世界的日文编码：双字节字符的两个字节都落在 0xA1–0xFE，半角片假名用 `8E` 前缀，JIS X 0212 补充汉字用 `8F` 开头的三字节。',
      trivia: ['日本程序员处理编码的老伙计是 nkf（Network Kanji Filter），专门在 EUC-JP、Shift_JIS、ISO-2022-JP 之间来回倒腾。'],
    },
    'euc-kr': {
      name: 'EUC-KR', zh: '韩文 EUC-KR（代码页 949 的基础）', type: 'double', region: 'ko', misread: '韩文',
      born: 1987, bornLabel: '1987 年前后', py: 'cp949', iconv: 'CP949',
      birthplace: '韩国，基于 KS X 1001（原 KS C 5601-1987）',
      nickname: '韩文国标码',
      story: 'EUC-KR 基于韩国标准 KS X 1001（原 KS C 5601-1987），预制了 2350 个常用韩文音节；微软的代码页 949（统一韩文码）在其基础上补全了全部 11172 个音节。',
      trivia: ['KS X 1001 只预制了 2350 个韩文音节，其余音节在纯 EUC-KR 里没法直接表示——微软的 CP949 后来把全部 11172 个音节都补了进来。'],
    },
    'windows-1252': {
      name: 'Windows-1252', zh: '西欧 Windows-1252', type: 'single', region: 'west', misread: '西欧',
      born: 1985, bornLabel: '上世纪 80 年代中期（随早期 Windows）', py: 'cp1252', iconv: 'CP1252',
      birthplace: '微软，早期 Windows',
      nickname: '常被误称为 Latin-1',
      story: 'Windows-1252 是 Windows 西欧语言的代码页。它与 ISO-8859-1 的可打印字符一致，却把 0x80–0x9F 这段控制符区挪来放了弯引号、破折号、™ 等符号，1998 年又在 0x80 放进了欧元符号 €。HTML5 采用的 WHATWG 编码标准干脆把 iso-8859-1 这个标签直接当作 windows-1252 处理。',
      trivia: [
        'MySQL 所谓的 latin1 字符集，其实是 Windows-1252（cp1252），而不是真正的 ISO-8859-1。',
        'Windows-1252 有 5 个字节（`81` `8D` `8F` `90` `9D`）没有定义字符，乱码在复制粘贴时最容易在这里"掉字节"。',
        '在浏览器里声明 charset=iso-8859-1，浏览器实际用的是 windows-1252——这是 WHATWG 编码标准的明文规定。',
      ],
    },
    'iso-8859-1': {
      name: 'ISO-8859-1', zh: '真·Latin-1', type: 'single', region: 'west', misread: '西欧',
      born: 1987, bornLabel: '1987 年', py: 'latin-1', iconv: 'ISO-8859-1',
      birthplace: 'ISO/IEC 8859 标准',
      nickname: 'Latin-1',
      story: 'ISO-8859-1（Latin-1）1987 年发布，256 个字节值与 Unicode 前 256 个码位一一对应，其中 0x80–0x9F 是不可见的 C1 控制符。',
      trivia: [
        'Latin-1 的字节值恰好等于 Unicode 码位，所以"按 Latin-1 编码再解码"成了程序员最爱用的"字节搬运"技巧。',
        'HTTP/1.1 的 RFC 2616 规定：没声明 charset 的 text/* 默认按 ISO-8859-1 解释；这个默认值直到 2014 年的 RFC 7231 才被取消。',
      ],
    },
    'windows-1251': {
      name: 'Windows-1251', zh: '西里尔文 Windows-1251', type: 'single', region: 'cyrillic', misread: '西里尔',
      born: 1991, bornLabel: '上世纪 90 年代初', py: 'cp1251', iconv: 'CP1251',
      birthplace: '微软，俄语版 Windows',
      nickname: '俄文 Windows 的母语',
      story: 'Windows-1251 是 Windows 的西里尔文代码页，俄语、乌克兰语、保加利亚语、塞尔维亚语等都用它。',
      trivia: ['俄语把乱码叫作 кракозябры（krakozyabry）——这个词听起来本身就很像乱码。'],
    },
    'koi8-r': {
      name: 'KOI8-R', zh: '俄文 KOI8-R', type: 'single', region: 'cyrillic', misread: '西里尔',
      born: 1993, bornLabel: '1993 年（RFC 1489 登记；KOI-8 家族可追溯到上世纪 70 年代的苏联）', py: 'koi8_r', iconv: 'KOI8-R',
      birthplace: '苏联的 KOI-8 标准，后经 RFC 1489（1993）登记',
      nickname: '去掉第 8 位也能读的俄文',
      story: 'KOI8-R 的字母排列很特别：抹掉最高位后，剩下的 7 位恰好是对应的拉丁字母转写（大小写颠倒），这样即使经过只认 7 位的老旧网关，俄文也还能勉强读懂。它是上世纪 90 年代俄语 Unix、Usenet 与电子邮件的事实标准。',
      trivia: ['KOI8-R 的"抹掉第 8 位仍可读"设计：Привет 的字节去掉最高位，就是 pRIWET。'],
    },
    macintosh: {
      name: 'Mac OS Roman', zh: '经典 Mac 西欧编码', type: 'single', region: 'west', misread: '老 Mac',
      born: 1984, bornLabel: '1984 年', py: 'mac_roman', iconv: 'MACINTOSH',
      birthplace: '苹果，初代 Macintosh',
      nickname: 'Mac 的老家话',
      story: 'Mac OS Roman 随 1984 年的初代 Macintosh 问世，是经典 Mac OS 的西欧字符集。它的高位字节和 Windows-1252 排得完全不同，所以 Mac 与 PC 之间互传文本常常鸡同鸭讲。',
      trivia: ['Mac OS Roman 的 0xF0 是苹果标志，Unicode 里没有它的正式位置，只好映射到私用区 U+F8FF。'],
    },
    cp437: {
      name: 'CP437', zh: 'IBM PC / DOS 代码页 437', type: 'single', region: 'dos', misread: 'DOS',
      born: 1981, bornLabel: '1981 年', py: 'cp437', iconv: 'CP437',
      birthplace: 'IBM，初代 IBM PC',
      nickname: 'DOS 的字符集、ZIP 文件名的默认编码',
      story: 'CP437 是 1981 年初代 IBM PC 的字符集，高位塞满了制表符（╔═╗）、希腊字母与数学符号，撑起了整个 DOS 时代的文本界面。ZIP 格式历史上默认用它（或系统的 OEM 代码页）存文件名。',
      trivia: [
        'CP437 连控制字符都画了字形：0x01 是笑脸 ☺，0x03 是红心 ♥。',
        'ZIP 规范直到 APPNOTE 6.3.0（2006）才加入"文件名是 UTF-8"的标志位（通用位标志第 11 位）。',
      ],
    },
    ibm866: {
      name: 'CP866', zh: 'DOS 西里尔代码页 866', type: 'single', region: 'dos', misread: 'DOS 西里尔',
      born: 1988, bornLabel: 'DOS 时代', py: 'cp866', iconv: 'CP866',
      birthplace: 'DOS 时代的俄语 PC',
      nickname: 'DOS 俄文',
      story: 'CP866 是 DOS 时代的俄文代码页，保留了 CP437 的制表符，同时在其他位置放进了西里尔字母。',
      trivia: [],
    },
    'windows-1250': {
      name: 'Windows-1250', zh: '中欧 Windows-1250', type: 'single', region: 'central-eu', misread: '中欧',
      born: 1991, bornLabel: '上世纪 90 年代初', py: 'cp1250', iconv: 'CP1250',
      birthplace: '微软，中欧语言版 Windows', nickname: '中欧代码页',
      story: 'Windows-1250 是 Windows 的中欧代码页，波兰语、捷克语、斯洛伐克语、匈牙利语等都用它。', trivia: [],
    },
    'windows-1253': {
      name: 'Windows-1253', zh: '希腊文 Windows-1253', type: 'single', region: 'greek', misread: '希腊',
      born: 1991, bornLabel: '上世纪 90 年代初', py: 'cp1253', iconv: 'CP1253',
      birthplace: '微软，希腊语版 Windows', nickname: '希腊代码页',
      story: 'Windows-1253 是 Windows 的希腊文代码页，与 ISO-8859-7 大体相近但并不完全相同。', trivia: [],
    },
    'windows-1254': {
      name: 'Windows-1254', zh: '土耳其文 Windows-1254', type: 'single', region: 'turkish', misread: '土耳其',
      born: 1991, bornLabel: '上世纪 90 年代初', py: 'cp1254', iconv: 'CP1254',
      birthplace: '微软，土耳其语版 Windows', nickname: '土耳其代码页',
      story: 'Windows-1254 是 Windows 的土耳其文代码页，在 Windows-1252 的基础上换进了 ğ、ı、ş 等土耳其字母。', trivia: [],
    },
    'windows-1255': {
      name: 'Windows-1255', zh: '希伯来文 Windows-1255', type: 'single', region: 'hebrew', misread: '希伯来',
      born: 1991, bornLabel: '上世纪 90 年代初', py: 'cp1255', iconv: 'CP1255',
      birthplace: '微软，希伯来语版 Windows', nickname: '希伯来代码页',
      story: 'Windows-1255 是 Windows 的希伯来文代码页，希伯来字母从右往左书写，乱码时方向也一起乱。', trivia: [],
    },
    'windows-1256': {
      name: 'Windows-1256', zh: '阿拉伯文 Windows-1256', type: 'single', region: 'arabic', misread: '阿拉伯',
      born: 1991, bornLabel: '上世纪 90 年代初', py: 'cp1256', iconv: 'CP1256',
      birthplace: '微软，阿拉伯语版 Windows', nickname: '阿拉伯代码页',
      story: 'Windows-1256 是 Windows 的阿拉伯文代码页。', trivia: [],
    },
    'windows-874': {
      name: 'Windows-874', zh: '泰文 Windows-874', type: 'single', region: 'thai', misread: '泰文',
      born: 1995, bornLabel: '上世纪 90 年代', py: 'cp874', iconv: 'CP874',
      birthplace: '微软，泰语版 Windows', nickname: '泰文代码页',
      story: 'Windows-874 是 Windows 的泰文代码页，基于泰国工业标准 TIS-620。', trivia: [],
    },
    'utf-16le': {
      name: 'UTF-16LE', zh: 'Windows "Unicode"（UTF-16 小端）', type: 'utf16', region: 'universal', misread: 'UTF-16',
      born: 1996, bornLabel: '1996 年（Unicode 2.0 引入代理对；前身 UCS-2 随 Windows NT 于 1993 年登场）', py: 'utf-16-le', iconv: 'UTF-16LE',
      birthplace: 'Unicode 联盟；Windows 内核的"母语"',
      nickname: 'Windows 的"Unicode"',
      story: 'Windows 里说的"Unicode"其实就是 UTF-16LE：Windows NT（1993）起使用 UCS-2，Unicode 2.0（1996）引入代理对后演进为 UTF-16。小端序文件以 BOM `FF FE` 开头，ASCII 字母每个都带一个 `00` 字节。',
      trivia: ['Windows 记事本"另存为 Unicode"、Windows PowerShell 5.1 的 `>` 重定向，默认写出的都是 UTF-16LE。'],
    },
    'utf-16be': {
      name: 'UTF-16BE', zh: '大端 UTF-16', type: 'utf16', region: 'universal', misread: 'UTF-16',
      born: 1996, bornLabel: '1996 年（Unicode 2.0）', py: 'utf-16-be', iconv: 'UTF-16BE',
      birthplace: 'Unicode 联盟', nickname: '网络字节序的 UTF-16',
      story: 'UTF-16BE 是大端序的 UTF-16，高字节在前，BOM 为 `FE FF`。', trivia: [],
    },
    ascii: {
      name: 'ASCII', zh: '美国信息交换标准代码', type: 'single', region: 'universal', misread: 'ASCII',
      born: 1963, bornLabel: '1963 年', py: 'ascii', iconv: 'ASCII',
      birthplace: '美国标准协会（ASA）', nickname: '所有编码的公约数',
      story: 'ASCII 于 1963 年首次发布，只用 7 位、定义 128 个字符；几乎所有编码都兼容它的 0x00–0x7F，这也是纯英文很少乱码的原因。',
      trivia: ['ASCII 只有 7 位，所以第 8 位"空着"——后来各国编码争相往 0x80–0xFF 里塞自己的字母，乱码的种子就此埋下。'],
    },
  };

  const MYSQL_DOUBLE_FIX = '`UPDATE t SET col = CONVERT(CAST(CONVERT(col USING latin1) AS BINARY) USING utf8mb4);`';

  // Pair key: `${trueEncoding}>${wrongDecoder}`. Tips flagged with "急救" are the
  // one-line Python rescues; they are dropped when a relic-specific recipe exists.
  const PAIR_FACTS = {
    'utf-8>windows-1252': {
      era: [2000, 2018],
      eraWhy: 'UTF-8 在 2000 年代成为网页主流，而 MySQL 在 8.0（2018）之前默认用 latin1（实为 cp1252），HTTP/1.1 的 RFC 2616 又让未声明 charset 的文本默认按 ISO-8859-1 解释——两股力量在这些年里迎头相撞',
      sites: ['某台 PHP 5 + MySQL latin1 的 LAMP 服务器', '一个忘了声明 charset 的个人博客', '一次把 UTF-8 数据导入 latin1 表的 WordPress 搬家现场', '西欧版 Windows 上被 Excel 双击打开的 UTF-8 CSV 文件'],
      culprits: ['MySQL 8.0 之前的默认字符集 latin1', '缺失的 HTTP Content-Type charset 声明', 'PHP 5.4 之前默认按 ISO-8859-1 处理的 htmlentities()', '没有 BOM 的 UTF-8 CSV 遇上 Excel'],
      tips: [
        '网页：在 `<head>` 开头写 `<meta charset="utf-8">`，并让服务器返回 `Content-Type: text/html; charset=utf-8`。',
        'MySQL：库、表、列统一用 `utf8mb4`（别用最多 3 字节的 `utf8`，即 utf8mb3），连接时执行 `SET NAMES utf8mb4` 或在连接串里指定 `charset=utf8mb4`。',
        '如果 UTF-8 字节已经被存进了 latin1 列：先把列改成二进制类型（`VARBINARY`/`BLOB`），再改成 `utf8mb4` 的文本类型，借二进制"中转"避免 MySQL 再转一次码——动手前务必备份。',
        "PHP：PHP 5.4 之前 `htmlentities()`/`htmlspecialchars()` 默认按 ISO-8859-1 处理，老代码请显式传入 `'UTF-8'`。",
        'Python 急救：`ftfy.fix_text(s)` 专治这类乱码；若 Windows-1252 未定义的字节在复制粘贴中丢了，ftfy 能识别这类丢字节的序列并用 `�` 标出（丢掉的字节它也补不回来）。',
      ],
    },
    'utf-8>iso-8859-1': {
      era: [1999, 2014],
      eraWhy: 'HTTP/1.1 的 RFC 2616（1999）规定未声明 charset 的 text/* 默认按 ISO-8859-1 解释，直到 RFC 7231（2014）才取消；Java Servlet 容器读取请求参数时也长期默认 ISO-8859-1',
      sites: ['某个 Java Servlet/Tomcat 应用的表单提交接口', '一个没声明 charset 的老式 HTTP 接口', '一台默认 Latin-1 的老式邮件网关'],
      culprits: ['RFC 2616 的 ISO-8859-1 默认值', 'Servlet 容器默认的 ISO-8859-1 请求编码', '老版本 Tomcat 的 URIEncoding 默认值'],
      tips: [
        'HTTP 响应头显式带上 `charset=utf-8`，不要依赖任何默认值。',
        'Java Web：在读取参数前调用 `request.setCharacterEncoding("UTF-8")`，并把 Tomcat 连接器的 `URIEncoding` 设为 `UTF-8`。',
        "Python 急救：`s.encode('latin-1').decode('utf-8')`。",
        '排查时记得：浏览器里的 "iso-8859-1" 实际按 Windows-1252 解码（WHATWG 编码标准），两者都要考虑。',
      ],
    },
    'windows-1252>iso-8859-1': {
      era: [1997, 2015],
      eraWhy: 'Word 与 Outlook 的"智能"排版会写出弯引号、长短破折号、省略号和欧元符号，它们在 Windows-1252 里都落在 0x80–0x9F；这类文本却常被声明成 ISO-8859-1，而在真正的 Latin-1 解码器眼里，这段字节只是看不见的 C1 控制符。HTML5 采用的 WHATWG 编码标准干脆把 iso-8859-1 标签当作 windows-1252 解码，正是为了收拾这个烂摊子',
      sites: ['一封用 Outlook 写成、却声明 charset=iso-8859-1 的电子邮件', '一个从 Word 复制了内容、服务器却返回 charset=ISO-8859-1 的网页', '一个严格按 ISO-8859-1 读取 Windows 文本的 Java 或 Python 程序'],
      culprits: ['Word/Outlook 的"智能引号"等自动排版', '返回 charset=ISO-8859-1 的服务器或邮件客户端', '把 Latin-1 与 Windows-1252 当成同一种编码的程序'],
      tips: [
        "按 Windows-1252 读取：Python `open(path, encoding='cp1252')`；已经读错的字符串可用 `s.encode('latin-1').decode('cp1252')` 修回来。",
        '网页与邮件如实声明编码：内容是 Windows-1252 就写 `charset=windows-1252`——更好的做法是统一改用 UTF-8。',
        '浏览器早已按 WHATWG 标准把 iso-8859-1 当作 windows-1252 解码，这类问题多出在严格遵守 Latin-1 的后端程序、数据库驱动与命令行工具里。',
      ],
    },
    'utf-8>gbk': {
      era: [2005, null],
      eraWhy: '只要还有软件按中文 Windows 的默认代码页 936 去读 UTF-8 文件，这类文物就会持续出土——Excel、cmd.exe、老版本的 Python 与 Java 都是常客',
      sites: ['一台中文 Windows 上被 Excel 双击打开的、没有 BOM 的 UTF-8 CSV', '一个代码页为 936 的 cmd.exe 窗口', '一段在中文 Windows 上用默认编码 open() 文件的 Python 脚本', '一个在中文 Windows 上用默认 file.encoding 读文件的 Java 程序'],
      culprits: ['中文 Windows 的 ANSI 代码页 936', 'Excel 双击打开无 BOM 的 UTF-8 CSV', '没写 encoding 参数的 Python open()', 'JDK 18 之前随系统而定的 Java 默认字符集'],
      tips: [
        "Excel：别双击打开 CSV，改用\"数据 → 从文本/CSV\"导入并选择 `65001: Unicode (UTF-8)`；导出时可另存为\"CSV UTF-8\"，或者带上 BOM（Python 用 `encoding='utf-8-sig'`）。",
        '命令行：`chcp 65001` 把 cmd.exe 切到 UTF-8（中文 Windows 默认是代码页 936）。',
        "Python：永远显式写 `open(path, encoding='utf-8')`——中文 Windows 上的默认编码是 cp936（PEP 686 让 Python 3.15 起默认启用 UTF-8 模式；更早的版本仍跟随系统代码页）。",
        'Java：JDK 18 起（JEP 400）默认字符集是 UTF-8；更早的版本启动时加 `-Dfile.encoding=UTF-8`。',
        "急救：先按 GBK 编回字节、再按 UTF-8 解码——Python `s.encode('gbk').decode('utf-8')`；乱码里出现 `�`（不一定在末尾）说明有字节已丢失，这行代码会直接报错，需要容错处理（如 `errors='replace'`）。",
      ],
    },
    'gbk>windows-1252': {
      era: [1997, 2012],
      eraWhy: '这是 GBK 文本大量流入西文软件的年代：MP3 的 ID3 标签、早期网页与电子邮件里，没有编码声明的中文常被当作西欧文字显示',
      sites: ['一首 ID3 标签用 GBK 写成、却在西文播放器里显示的 MP3', '一个没声明 charset、被西文浏览器打开的中文网页', '一封从中文 Windows 发往海外的电子邮件'],
      culprits: ['没有字符集字段、通常按 Latin-1 读取的 ID3v1 标签', '缺失的 charset 声明', '默认 Windows-1252 的西文操作系统'],
      tips: [
        '统一转成 UTF-8：`iconv -f GBK -t UTF-8 old.txt > new.txt`。',
        "急救：`s.encode('cp1252').decode('gbk')`（乱码里没有 1252 特有符号时，用 `latin-1` 也行；若含 `U+0081` 这类 Windows-1252 未定义字节变成的控制符，Python 的 cp1252 会报错，可改用 ftfy 的 `sloppy-windows-1252`）。",
        'MP3 标签：用支持 ID3v2.4（可用 UTF-8）的工具重写标签。',
        '还在用 GBK 的网页，至少要声明 `<meta charset="gbk">`；更好的做法是迁移到 UTF-8。',
      ],
    },
    'gbk>iso-8859-1': {
      era: [1998, 2014],
      eraWhy: '这是 Java Web 开发的"上古时期"：Servlet 容器默认按 ISO-8859-1 解析请求参数，中文表单数据被拆成了一个个 Latin-1 字符',
      sites: ['一个 JSP + Tomcat 的中文表单处理页面', '一个默认 ISO-8859-1 的老式 HTTP 接口'],
      culprits: ['Servlet 容器默认的 ISO-8859-1 请求编码', 'RFC 2616 的 ISO-8859-1 默认值'],
      tips: [
        'Java 老兵的祖传咒语：`new String(s.getBytes("ISO-8859-1"), "GBK")`——能救急，但根治要在读取参数前调用 `request.setCharacterEncoding(...)`。',
        "急救：`s.encode('latin-1').decode('gbk')`。",
        '统一转成 UTF-8：`iconv -f GBK -t UTF-8`。',
      ],
    },
    'utf-8>shift_jis': {
      era: [2005, null],
      eraWhy: '日文 Windows 的默认代码页是 932，凡是不看编码声明、按"系统默认"打开 UTF-8 文件的软件，都会在这里出事',
      sites: ['一台日文 Windows 上被 Excel 双击打开的 UTF-8 CSV', '日文版 Windows 的老式记事本', '一个按 Shift_JIS 解析的日文网页表单'],
      culprits: ['日文 Windows 的 ANSI 代码页 932', '没有 BOM 的 UTF-8 文件', '缺失的 charset 声明'],
      tips: [
        'Excel：用"数据 → 从文本/CSV"导入并选择 UTF-8，或导出 CSV 时带上 BOM。',
        "Python：读写文件永远显式写 `encoding='utf-8'`——日文 Windows 上的默认编码是 cp932。",
        'Windows 10 1903 之后的记事本默认保存无 BOM 的 UTF-8；要交给老软件的文件，可以另存为"UTF-8（带 BOM）"。',
        "急救：`s.encode('cp932').decode('utf-8')`（乱码里若有 `�`，说明有字节已丢失，这行会报错，需要容错处理）。",
      ],
    },
    'shift_jis>windows-1252': {
      era: [1995, 2012],
      eraWhy: '这是日文游戏、动画字幕与网页在西文系统间流传的年代，Shift_JIS 文本常被当作西欧文字显示',
      sites: ['一份在西文 Windows 上打开的日文游戏文本', '一个被西文浏览器误判编码的日文个人网站', '一首 ID3 标签用 Shift_JIS 写成的日文歌曲'],
      culprits: ['默认 Windows-1252 的西文系统', '缺失的 charset 声明', '没有字符集字段、通常按 Latin-1 读取的 ID3v1 标签'],
      tips: [
        '运行日文老程序：用 Locale Emulator，或把系统的"非 Unicode 程序的语言"设为日语。',
        '统一转成 UTF-8：`iconv -f CP932 -t UTF-8`。',
        "急救：`s.encode('cp1252').decode('cp932')`（Shift_JIS 的首字节常是 `81`，在 Windows-1252 里未定义：若乱码里含 `U+0081` 这类控制符，Python 的 cp1252 会报错，可先 `import ftfy.bad_codecs` 再用 `sloppy-windows-1252` 编回字节）。",
      ],
    },
    'utf-8>windows-1251': {
      era: [2005, 2020],
      eraWhy: '这是俄语网站从 Windows-1251 向 UTF-8 迁移的漫长过渡期，新旧编码在数据库、模板与浏览器之间反复交错',
      sites: ['一个模板声明 windows-1251、数据库却存着 UTF-8 的俄语网站', '一台俄文 Windows 上用默认编码读取 UTF-8 文件的程序'],
      culprits: ['俄文 Windows 的 ANSI 代码页 1251', '与实际内容不符的 meta charset 声明', '设成 cp1251 的数据库连接字符集'],
      tips: [
        '网页声明与实际字节必须一致：统一为 UTF-8，并同时修改 `<meta charset>` 与 HTTP 头。',
        'MySQL 连接执行 `SET NAMES utf8mb4`，别让 cp1251 的连接字符集偷偷转码。',
        "急救：`s.encode('cp1251').decode('utf-8')`（若乱码里含 `U+0098`——Windows-1251 唯一未定义的字节 `98`，「И」（`D0 98`）、左单引号「‘」（`E2 80 98`）的 UTF-8 里都有它——Python 的 cp1251 会报错，可先 `import ftfy.bad_codecs` 再用 `sloppy-windows-1251`）。",
      ],
    },
    'windows-1251>windows-1252': {
      era: [1995, 2012],
      eraWhy: '俄文 Windows-1251 文本在西欧系统上被当作 Windows-1252 显示——Ïðèâåò 这种"带音标的伪法语"是那个年代俄语网民的日常',
      sites: ['一封从俄文 Windows 发往西欧的电子邮件', '一个没声明 charset 的俄语网页', '一首 ID3 标签用 1251 写成的俄语歌曲'],
      culprits: ['缺失的 charset 声明', '默认 Windows-1252 的西文系统'],
      tips: ['网页与邮件务必声明 charset。', '统一转成 UTF-8：`iconv -f CP1251 -t UTF-8`。', "急救：`s.encode('cp1252').decode('cp1251')`（若乱码里含 `U+008D` 这类 Windows-1252 未定义字节变成的控制符，Python 的 cp1252 会报错，可改用 ftfy 的 `sloppy-windows-1252`）。"],
    },
    'koi8-r>windows-1251': {
      era: [1993, 2005],
      eraWhy: '上世纪 90 年代的俄语世界编码林立：Unix、Usenet 与电子邮件用 KOI8-R（RFC 1489，1993），Windows 用 1251，两边互相误读是家常便饭',
      sites: ['一封从俄罗斯 Unix 服务器发出、在 Windows 上阅读的电子邮件', '一个 90 年代 Usenet 俄语新闻组的存档'],
      culprits: ['KOI8-R 与 Windows-1251 两套并存的俄文编码', '转发过程中丢失的 Content-Type charset'],
      tips: ['统一转成 UTF-8：`iconv -f KOI8-R -t UTF-8`。', '邮件请检查 `Content-Type: text/plain; charset=koi8-r` 头是否在转发中丢失。', "急救：`s.encode('cp1251').decode('koi8_r')`。"],
    },
    'windows-1251>koi8-r': {
      era: [1993, 2005],
      eraWhy: '上世纪 90 年代俄语 Windows（1251）与 Unix（KOI8-R）两大阵营并存，Windows 写的信在 Unix 邮件客户端里经常面目全非',
      sites: ['一封从俄文 Windows 发出、在 Unix 邮件客户端阅读的电子邮件', '一台默认 KOI8-R 的俄语 Linux 服务器'],
      culprits: ['KOI8-R 与 Windows-1251 两套并存的俄文编码', '缺失的 charset 声明'],
      tips: ['统一转成 UTF-8：`iconv -f CP1251 -t UTF-8`。', '邮件与网页务必声明 charset。', "急救：`s.encode('koi8_r').decode('cp1251')`。"],
    },
    'koi8-r>iso-8859-1': {
      era: [1993, 2003],
      eraWhy: '90 年代俄语邮件穿越西方网络时，常被默认 ISO-8859-1 的客户端与网关当作西欧文字处理',
      sites: ['一封经过西方邮件网关转发的俄语邮件', '一个 Usenet 俄语新闻组在西方镜像站上的存档'],
      culprits: ['默认 ISO-8859-1 的邮件客户端', '丢失的 Content-Type charset'],
      tips: ['统一转成 UTF-8：`iconv -f KOI8-R -t UTF-8`。', '邮件请检查 charset 头是否在转发中丢失。', "急救：`s.encode('latin-1').decode('koi8_r')`。"],
    },
    'big5>gbk': {
      era: [1995, 2010],
      eraWhy: '1990–2000 年代两岸 BBS、电子邮件与软件资源频繁往来，Big5 与 GBK 的双字节区间大面积重叠，互相误读后往往仍是"像模像样"的汉字',
      sites: ['一个转载了台湾 BBS 文章的大陆论坛', '一份在简体 Windows 上打开的繁体中文 txt 小说', '一封跨越海峡的电子邮件'],
      culprits: ['Big5 与 GBK 重叠的双字节编码空间', '简体中文 Windows 的默认代码页 936'],
      tips: ['统一转成 UTF-8：`iconv -f BIG5 -t UTF-8`。', '简繁转换请用 OpenCC 这类专门工具——改编码只能"换皮"，不能"换字"。', "急救：`s.encode('gbk').decode('big5')`（两套字表并不完全对称：若乱码里含私用区字符（U+E000–U+F8FF，Big5 的标点常落进 GBK 的自定义区），Python 的 gbk 编解码器编不回去，只能回到原始文件）。"],
    },
    'gbk>big5': {
      era: [1995, 2010],
      eraWhy: '1990–2000 年代两岸 BBS、电子邮件与软件资源频繁往来，GBK 文本在繁体系统上被当作 Big5 显示是常见事故',
      sites: ['一个转载了大陆论坛文章的台湾 BBS', '一份在繁体 Windows 上打开的简体中文 txt 小说', '一封跨越海峡的电子邮件'],
      culprits: ['Big5 与 GBK 重叠的双字节编码空间', '繁体中文 Windows 的默认代码页 950'],
      tips: ['统一转成 UTF-8：`iconv -f GBK -t UTF-8`。', '简繁转换请用 OpenCC 这类专门工具，别指望改编码。', "急救：`s.encode('big5').decode('gbk')`（若乱码里含私用区字符（U+E000–U+F8FF）或香港增补字符，Python 的 big5 编解码器编不回去，只能回到原始文件）。"],
    },
    'big5>windows-1252': {
      era: [1995, 2012],
      eraWhy: '这是繁体中文文本流入西文软件的年代：网页、邮件与 MP3 标签里没有声明编码的 Big5 常被当作西欧文字显示',
      sites: ['一个在西文浏览器里打开的繁体中文网页', '一首 ID3 标签用 Big5 写成的华语歌曲'],
      culprits: ['缺失的 charset 声明', '没有字符集字段、通常按 Latin-1 读取的 ID3v1 标签'],
      tips: ['统一转成 UTF-8：`iconv -f BIG5 -t UTF-8`。', 'MP3 标签：用支持 ID3v2.4（可用 UTF-8）的工具重写标签。', "急救：`s.encode('cp1252').decode('big5')`。"],
    },
    'gbk>cp437': {
      era: [1998, null],
      eraWhy: 'ZIP 历史上按 CP437/系统 OEM 代码页存文件名，APPNOTE 6.3.0（2006）才加入 UTF-8 标志位；中文 Windows 打的包至今仍会在 macOS/Linux 上出土这种文物',
      sites: ['一个用 Windows 自带压缩功能打包、在 macOS 或 Linux 上解压的 ZIP 文件', '一个在中文 Windows 上用老版本压缩软件打包、被海外同事解压的 ZIP'],
      culprits: ['ZIP 文件名默认的 CP437/OEM 代码页', '没有设置 UTF-8 标志位（通用位第 11 位）的压缩工具', '不能指定文件名编码的解压工具'],
      tips: [
        'Linux：`unzip -O CP936 archive.zip`（Debian/Ubuntu 等发行版的 unzip 支持 `-O` 选项）。',
        '7-Zip：`7z x -mcp=936 archive.zip` 指定文件名代码页。',
        "Python 3.11+：`zipfile.ZipFile(path, metadata_encoding='gbk')`；更早的版本要先把文件名按 CP437 编回字节，再按 GBK 解码。",
        '打包时用能写 UTF-8 文件名的工具（如 7-Zip 加 `-mcu=on`），接收方就不用再猜了。',
      ],
    },
    'utf-8>cp437': {
      era: [2000, null],
      eraWhy: '有些工具用 UTF-8 写入 ZIP 文件名却不设置 UTF-8 标志位（通用位第 11 位，APPNOTE 6.3.0，2006 年引入），解压工具只好按 CP437 解读',
      sites: ['一个由脚本生成、没有设置 UTF-8 标志位的 ZIP 压缩包', '一个在 macOS 或 Linux 上打包、被老式 Windows 解压工具打开的 ZIP'],
      culprits: ['没有设置 UTF-8 标志位的打包工具', '默认 CP437 的解压工具'],
      tips: ['7-Zip：`7z x -mcp=65001 archive.zip` 按 UTF-8 读取文件名。', "Python：`name.encode('cp437').decode('utf-8')` 还原文件名。", '打包时设置 UTF-8 文件名标志（7-Zip 用 `-mcu=on`）。'],
    },
    'shift_jis>gbk': {
      era: [1998, null],
      eraWhy: '在简体中文 Windows 上运行日文游戏与软件的玩家，从 2000 年前后起就与这类乱码相伴——于是有了 AppLocale 与 Locale Emulator',
      sites: ['一台简体中文 Windows 上运行的日文 Galgame', '一份在中文系统上打开的日文 txt 歌词文件', '一个日文软件的安装程序'],
      culprits: ['简体中文 Windows 的默认代码页 936', '不支持 Unicode 的日文老程序'],
      tips: ['用 Locale Emulator 以日文区域设置启动程序，或把"非 Unicode 程序的语言"临时改成日语（需要重启）。', '文本统一转成 UTF-8：`iconv -f CP932 -t UTF-8`。', "急救：`s.encode('gbk').decode('cp932')`。"],
    },
    'gbk>shift_jis': {
      era: [1998, 2015],
      eraWhy: '中文软件、字幕与网页在日文系统上被按 Shift_JIS 打开，是中日两国软件交流中的常见事故',
      sites: ['一台日文 Windows 上打开的中文字幕文件', '一个在日文系统上运行的中文老软件'],
      culprits: ['日文 Windows 的默认代码页 932', '没有编码声明的字幕文件'],
      tips: ['文本统一转成 UTF-8：`iconv -f GBK -t UTF-8`。', '运行中文老程序时，把"非 Unicode 程序的语言"设为简体中文，或用区域模拟工具。', "急救：`s.encode('cp932').decode('gbk')`。"],
    },
    'euc-kr>windows-1252': {
      era: [1995, 2012],
      eraWhy: '这是韩文 EUC-KR/CP949 文本流入西文系统的年代：K-pop 歌曲的 ID3 标签、韩文网页与邮件都是重灾区',
      sites: ['一首 ID3 标签用 EUC-KR 写成的 K-pop 歌曲', '一个没声明 charset、在西文浏览器打开的韩文网页'],
      culprits: ['没有字符集字段、通常按 Latin-1 读取的 ID3v1 标签', '缺失的 charset 声明'],
      tips: ['统一转成 UTF-8：`iconv -f CP949 -t UTF-8`。', '韩文 Windows 的代码页是 949，程序读写文件时请显式指定编码。', "急救：`s.encode('cp1252').decode('cp949')`——CP949 是 EUC-KR 的超集，兼容性更好。"],
    },
    'euc-jp>shift_jis': {
      era: [1995, 2010],
      eraWhy: '这是日本 Unix 服务器（EUC-JP）与 Windows 客户端（Shift_JIS）并存的年代，Perl CGI 网页与邮件经常在两者之间被误读',
      sites: ['一个用 EUC-JP 写成的 Perl CGI 留言板，被 Windows 浏览器按 Shift_JIS 打开', '一份从日本 Unix 服务器上下载的文本文件'],
      culprits: ['EUC-JP 与 Shift_JIS 两套并存的日文编码', '缺失的 charset 声明'],
      tips: ['日本程序员的老伙计 `nkf -w` 可以自动识别编码并转成 UTF-8。', '网页务必声明 charset，并尽快迁移到 UTF-8。', "急救：`s.encode('cp932').decode('euc_jp')`。"],
    },
    'utf-8>macintosh': {
      era: [1998, 2012],
      eraWhy: 'UTF-8 文本在经典 Mac OS 与早期 Mac OS X 软件里被按 Mac OS Roman 打开——`√©` 这种带根号的乱码是 Mac 用户的专属记忆',
      sites: ['一台运行老版本 Mac 软件的苹果电脑', '一份被按"西文（Mac OS Roman）"读取的 UTF-8 文本'],
      culprits: ['默认 Mac OS Roman 的老式 Mac 软件', '没有编码元数据的纯文本文件'],
      tips: ['在编辑器里把文件编码明确设为 UTF-8，不要依赖"西文（Mac OS Roman）"默认值。', "急救：`s.encode('mac_roman').decode('utf-8')`。"],
    },
    'windows-1252>utf-8': {
      era: [2005, null],
      eraWhy: 'UTF-8 成为默认编码之后，西文 Windows 时代的老文件被新软件按 UTF-8 读取，é、ü 之类的单字节被换成了 `�`',
      sites: ['一份西文 Windows 时代的老文档，被默认 UTF-8 的新编辑器打开', '一个从 latin1 数据库导出、却按 UTF-8 导入的数据文件'],
      culprits: ['默认 UTF-8 的现代软件', '没有编码声明的老文件'],
      tips: [
        "这种伤不可逆：`�` 替换发生时原字节已被丢弃。唯一的办法是回到源头，用正确的编码重新读取原始文件，例如 Python `open(path, encoding='cp1252')`。",
        "读取编码不明的文件时，先用 `charset-normalizer` 之类的工具探测，或用 `errors='surrogateescape'` 保留原字节。",
        '转码请用 `iconv -f CP1252 -t UTF-8`，不要让程序去"猜"。',
      ],
    },
    'gbk>utf-8': {
      era: [2005, null],
      eraWhy: 'UTF-8 成为默认编码之后，GBK 老文件被按 UTF-8 读取，汉字的两个字节大多不是合法的 UTF-8 序列，于是成片变成 `�`',
      sites: ['一份 GBK 编码的 txt 小说，被默认 UTF-8 的新编辑器打开', '一个被服务器错误声明为 UTF-8 的 GBK 老网页'],
      culprits: ['默认 UTF-8 的现代软件', '与实际字节不符的 charset 声明'],
      tips: [
        "回到源头：用 `encoding='gbk'` 重新读取原始文件，或先用 `iconv -f GBK -t UTF-8` 转码。",
        "Python 读取不确定编码的文件可用 `errors='surrogateescape'` 保留原字节，避免当场变成 `�`。",
        '网页的 HTTP 头、`<meta charset>` 与实际字节必须一致。',
      ],
    },
    'ascii>utf-16le': {
      era: [2000, 2007],
      eraWhy: 'Windows 2000/XP 的记事本用 IsTextUnicode 启发式猜编码，某些纯 ASCII 文本会被误判为 UTF-16LE；Windows Vista（2007）的记事本修复了这个问题',
      sites: ['一台 Windows XP 电脑上的记事本', '一个被编码自动检测猜错了的文本编辑器'],
      culprits: ['记事本的 IsTextUnicode 启发式', '没有 BOM 的纯文本文件'],
      tips: ['别把编码交给"猜"：用能手动指定编码的编辑器打开文件。', '给文件加上 BOM，让编辑器不必再猜。', "急救：`s.encode('utf-16-le').decode('ascii')`。"],
    },
    'utf-16le>windows-1252': {
      era: [1996, null],
      eraWhy: 'UTF-16LE 是 Windows"Unicode"文本的主流格式（NT 起用 UCS-2，Unicode 2.0 之后演进为 UTF-16），被只认单字节的工具打开时就会出土',
      sites: ['一份 Windows PowerShell 5.1 用重定向生成的日志', '一个用记事本"另存为 Unicode"、又被 Linux 工具打开的文本文件'],
      culprits: ['Windows PowerShell 5.1 默认的 UTF-16LE 输出', '只认单字节的文本工具'],
      tips: ["用 UTF-16 解码：Python `open(path, encoding='utf-16')` 会根据 BOM 自动判断字节序；或 `iconv -f UTF-16 -t UTF-8`。", 'Windows PowerShell 5.1 写文件时加 `-Encoding utf8`；PowerShell 7 默认输出无 BOM 的 UTF-8。'],
    },
    'utf-8>big5': {
      era: [2005, null],
      eraWhy: '繁体中文 Windows 的默认代码页是 950（Big5），按系统默认编码打开 UTF-8 文件的软件都会中招',
      sites: ['一台繁体中文 Windows 上被 Excel 打开的 UTF-8 CSV', '一个代码页为 950 的命令行窗口'],
      culprits: ['繁体中文 Windows 的 ANSI 代码页 950', '没有 BOM 的 UTF-8 文件'],
      tips: ['Excel 用"数据 → 从文本/CSV"导入并选择 UTF-8。', '`chcp 65001` 把命令行切换到 UTF-8。', "急救：`s.encode('big5').decode('utf-8')`（若乱码里含私用区字符或 `�`，Python 的 big5 编解码器会报错，只能回到原始文件）。"],
    },
    'utf-8>euc-kr': {
      era: [2005, null],
      eraWhy: '韩文 Windows 的默认代码页是 949，UTF-8 文件被按系统默认编码读取时就会出现',
      sites: ['一台韩文 Windows 上被按 CP949 打开的 UTF-8 文件', '一个声明了 euc-kr、实际却输出 UTF-8 的韩文网页'],
      culprits: ['韩文 Windows 的 ANSI 代码页 949', '与实际字节不符的 charset 声明'],
      tips: ['读写文件显式指定 UTF-8。', '网页的 `<meta charset>` 与 HTTP 头要和实际字节一致。', "急救：`s.encode('cp949').decode('utf-8')`（乱码里若有 `�`，说明有字节已丢失，这行会报错，需要容错处理）。"],
    },
  };

  const SIGNATURE_FACTS = {
    kunjinkao: {
      title: '锟斤拷', famous: true,
      mechanism: '当程序把非 UTF-8 的字节（比如 GBK 文本）硬按 UTF-8 解码时，每处解不出来的地方都会被换成替换字符 `U+FFFD`「�」，它的 UTF-8 编码是 `EF BF BD`。两个 `�` 连在一起就是 `EF BF BD EF BF BD`，再被 GBK 两两一组读出来：`EF BF`→「锟」、`BD EF`→「斤」、`BF BD`→「拷」。',
      lossNote: '原始字节在被换成 `�` 的那一刻就已永远丢失，「锟斤拷」只能证明"这里曾经有字"。',
      lore: '「锟斤拷」大概是中文互联网最出名的乱码，程序员圈甚至流传着一副对子——「手持两把锟斤拷，口中疾呼烫烫烫；脚踏千朵屯屯屯，笑看万物锘锘锘。」四件名器，一副对子凑齐。',
      quips: {
        humor: ['如果您在自家网站上见到它，恭喜，您已经集齐了中文编码事故的"入门徽章"。', '它是少数几个能让程序员一眼认出、并且同时叹气的汉字组合。'],
        academic: ['该签名的出现意味着信息在第一次 UTF-8 解码时已被替换字符覆盖，后续任何处理都无法复原。', '从信息论角度看，「锟斤拷」不携带任何原文信息：无论原文是什么，结果都一样。'],
        snark: ['看到锟斤拷还想恢复原文？省省吧，原字节早就投胎了。', '锟斤拷：一个需要连续犯两次错才能解锁的成就。'],
      },
      era: [2000, null],
      eraWhy: '它出没于 UTF-8 与 GBK 混用的系统，从 2000 年代至今仍在出土',
      site: '某个先把 GBK 当 UTF-8 解码、再把结果存成 UTF-8 并用 GBK 显示的中文系统',
      tips: ['回到源头：找到最初的原始文件或数据库备份，用正确的编码（多半是 GBK）重新读取。', "第一次解码时就别静默替换：Python 默认的 `errors='strict'` 会让错误尽早暴露，慎用 `errors='replace'`。"],
    },
    'kunjinkao-big5': {
      title: '嚙踝蕭', famous: true,
      mechanism: '这是「锟斤拷」的繁体孪生兄弟：同样是两个替换字符 `EF BF BD EF BF BD`，这次被 Big5 读出来——`EF BF`→「嚙」、`BD EF`→「踝」、`BF BD`→「蕭」。',
      lossNote: '和锟斤拷一样，原字节在变成 `�` 时就已丢失。',
      lore: '在繁体中文环境里，这组乱码同样臭名昭著。它和「锟斤拷」一起证明了一件事：同一串字节，换一个解码器，就是另一张脸。',
      quips: {
        humor: ['简体世界有锟斤拷，繁体世界有嚙踝蕭——乱码界的双胞胎，长得完全不像，DNA 却一模一样。', '字面上看像是"咬脚踝的萧先生"，实际上什么意思都没有。'],
        academic: ['该签名与「锟斤拷」同源，区别仅在于最终显示所用的双字节编码。'],
        snark: ['换了身繁体马甲，还是那个锟斤拷。', '名字很文艺，内容很空虚。'],
      },
      era: [2000, null],
      eraWhy: '它出没于 UTF-8 与 Big5 混用的繁体中文系统',
      site: '某个以 Big5 显示 UTF-8 内容的繁体中文系统',
      tips: ['回到源头：找到原始文件，用正确的编码（多半是 Big5）重新读取。'],
    },
    tangtangtang: {
      title: '烫烫烫', glyph: '烫', kind: 'debug-memory', memory: '未初始化的栈内存', fillByte: '0xCC', famous: true,
      mechanism: '微软 Visual C++ 的 Debug 构建会把未初始化的栈内存填成 `0xCC`——这个值恰好是 x86 的 `INT 3` 断点指令，程序万一跑飞到这里会立刻停下。如果你把一个没初始化的 char 数组当字符串打印出来，`CC CC` 被 GBK 读出来就是「烫」。',
      lossNote: '这里本来就没有"原文"——它是未初始化的内存，不是被损坏的文字。',
      lore: '「烫烫烫」是很多中国 C/C++ 程序员的成人礼——看到它，八成是变量没初始化，或者数组越界读到了未初始化的栈。',
      quips: {
        humor: ['不是您的显示器在发烧，是您的栈内存在喊冤。', '它和「屯屯屯」是一对兄弟：一个住栈上，一个住堆里。'],
        academic: ['「烫」字签名可作为未初始化栈内存的诊断依据，常见于 MSVC Debug 构建的程序输出。'],
        snark: ['编译器在用中文提醒你变量没初始化，你却以为是乱码。', '烫烫烫——你的 bug 在冒热气。'],
      },
      era: [1995, null], eraLabel: '上世纪 90 年代至今',
      eraWhy: 'Visual C++ Debug 构建（VC6 的 /GZ、后来的 /RTCs）用 0xCC 填充栈的做法由来已久，只要还有人在中文 Windows 上调试 C/C++ 程序，它就会继续出土',
      site: '一台中文 Windows 上、用 Visual C++ Debug 模式编译运行的 C/C++ 程序',
      tips: ['声明时就初始化，例如 `char buf[64] = {0}`，别让栈上的数组带着 `0xCC` 出门。', '/RTC1 中的 /RTCu 会在运行时报告未初始化变量的使用；越界读写可用 AddressSanitizer（MSVC 2019 16.9 起支持 /fsanitize=address）排查；Clang/Linux 下检查未初始化读取要用 MemorySanitizer 或 Valgrind。'],
    },
    tuntuntun: {
      title: '屯屯屯', glyph: '屯', kind: 'debug-memory', memory: '刚分配、还没初始化的堆内存', fillByte: '0xCD', famous: true,
      mechanism: 'Debug 版 C 运行库的 `malloc`/`new` 会把刚分配、尚未初始化的堆内存填成 `0xCD`，`CD CD` 在 GBK 里就是「屯」。顺带一提：已释放的堆内存会被填成 `0xDD`（GBK 里是「葺」），堆块两侧的保护字节则是 `0xFD`。',
      lossNote: '这里本来就没有"原文"——它是刚分配、还没写入的堆内存。',
      lore: '「烫烫烫」住在栈上，「屯屯屯」住在堆里——看到哪个，就知道该去哪儿找没初始化的变量。',
      quips: {
        humor: ['「脚踏千朵屯屯屯」——对子里的又一位成员到场。', '屯屯屯：一堆没人认领的堆内存在排队。'],
        academic: ['「屯」字签名指向未初始化的堆内存，可与「烫」（栈）互为对照。'],
        snark: ['又一个 new 完不初始化的。', '屯屯屯：你的堆在囤 bug。'],
      },
      era: [1995, null], eraLabel: '上世纪 90 年代至今',
      eraWhy: 'Visual C++ 调试运行库用 0xCD 填充新分配堆内存的做法由来已久，至今仍在中文 Windows 上出土',
      site: '一台中文 Windows 上、用 Visual C++ Debug 模式运行的 C/C++ 程序',
      tips: ['分配后立即初始化：用 `calloc`，或写 `new T()`（带括号会做值初始化）。', '用 Application Verifier 或 AddressSanitizer 检查堆内存的使用。'],
    },
    // Engine-only signature (MBX.Engine.SIGNATURES): freed MSVC debug-heap memory, 0xDD.
    qiqiqi: {
      title: '葺葺葺', glyph: '葺', kind: 'debug-memory', memory: '已经释放的堆内存', fillByte: '0xDD', famous: true,
      mechanism: 'Debug 版 C 运行库在 `free`/`delete` 一块堆内存时，会先把它填满 `0xDD`（"已死亡"标记），好让"释放后仍在使用"的 bug 尽早露馅。`DD DD` 被 GBK 读出来就是「葺」——看到它，说明程序把一块已经释放的内存当成字符串读了出来。',
      lossNote: '这里本来就没有"原文"——它是一块已经释放的堆内存，读到它本身就是一个 bug。',
      lore: '调试堆的三种填充值各有分工：`0xCC` 填未初始化的栈（「烫」），`0xCD` 填刚分配的堆（「屯」），`0xDD` 填已释放的堆（「葺」）。看到哪个字，就知道该去查哪一类内存错误。',
      quips: {
        humor: ['「烫」看守栈，「屯」看守新分配的堆，「葺」负责给已经释放的内存守灵。', '内存都释放了还被拉出来念，难怪它满脸写着"葺"——修修补补。'],
        academic: ['「葺」字签名指向释放后使用（use-after-free），比未初始化读取更危险：那块内存随时可能被其他数据复用。'],
        snark: ['指针 free 了不置空，还接着读——这块内存的墓碑都替你刻好了。', '葺葺葺：你的悬空指针在念经。'],
      },
      era: [1995, null], eraLabel: '上世纪 90 年代至今',
      eraWhy: 'Visual C++ 调试运行库用 0xDD 标记已释放堆内存的做法由来已久，至今仍在中文 Windows 上出土',
      site: '一台中文 Windows 上、用 Visual C++ Debug 模式运行、把已释放内存当字符串打印的 C/C++ 程序',
      tips: ['`free`/`delete` 之后立刻把指针置空，或改用智能指针管理对象的生命周期。', '用 AddressSanitizer 或 Application Verifier 揪出释放后使用（use-after-free）。'],
    },
    'utf8-bom-1252': {
      title: 'ï»¿',
      mechanism: '`EF BB BF` 是 UTF-8 的字节顺序标记（BOM，`U+FEFF`）。UTF-8 其实不需要字节序，但 Windows 上不少工具喜欢在文件开头放上它，当作"我是 UTF-8"的暗号；不认识它的程序按 Windows-1252 读，就成了 `ï` `»` `¿`。',
      lossNote: '',
      lore: 'BOM 是 PHP 程序员的老冤家：它会在 `<?php` 之前被原样输出，引发经典的 "headers already sent" 错误。若被 GBK 读，`EF BB` 则是「锘」——「笑看万物锘锘锘」说的就是它。',
      quips: {
        humor: ['三个字节的"隐形人"，平时看不见，一出事就现原形。'],
        academic: ['Unicode 标准对 UTF-8 BOM 的态度是"允许但不推荐"，许多 Unix 工具会把它当作普通字符处理。'],
        snark: ['一个本来就不需要的东西，偏偏要放在文件最前面。'],
      },
      era: [2000, null],
      eraWhy: 'BOM 多见于 Windows 工具保存的 UTF-8 文件——Windows 10 1903（2019）之前的记事本保存 UTF-8 时默认带 BOM',
      site: '一份用 Windows 记事本保存、又被不认 BOM 的程序读取的 UTF-8 文件',
      tips: ["保存为\"UTF-8（无 BOM）\"；Python 读取时用 `encoding='utf-8-sig'` 可自动去掉 BOM。"],
    },
    'utf16-bom': {
      title: 'ÿþ',
      mechanism: '`FF FE` 是 UTF-16 小端序的 BOM，`FE FF` 是大端序的 BOM；按单字节编码读出来就是 `ÿþ` 或 `þÿ`。后面通常紧跟着夹杂 `00` 字节的文字——ASCII 字母在 UTF-16 里每个都要占两个字节，其中一个是零。',
      lossNote: '',
      lore: 'Windows 记事本"另存为 Unicode"和 Windows PowerShell 5.1 的 `>` 重定向，默认写出的都是带 BOM 的 UTF-16LE；把这种文件交给只认单字节的工具，就会出土 `ÿþ`。',
      quips: {
        humor: ['ÿþ——看起来像某种北欧语言的感叹词，其实只是两个字节在报到。'],
        academic: ['BOM 的本意是声明字节序，却在不识别它的环境中成了最显眼的乱码特征。'],
        snark: ['把 UTF-16 当单字节读，你就能收获开头的 ÿþ 和一行被零字节隔开的字母。'],
      },
      era: [1996, null],
      eraWhy: 'UTF-16 自 Unicode 2.0（1996）起成为 Windows "Unicode" 文本的主流格式',
      site: '一个用"Unicode"（UTF-16LE）保存的 Windows 文本文件，被只认单字节的程序打开',
      tips: ["用 UTF-16 解码：Python `open(path, encoding='utf-16')` 会根据 BOM 自动判断字节序；或 `iconv -f UTF-16 -t UTF-8`。", 'Windows PowerShell 5.1 写文件时加 `-Encoding utf8`；PowerShell 7 默认输出无 BOM 的 UTF-8。'],
    },
    // Engine-only signature (MBX.Engine.SIGNATURES): UTF-16 text read one byte at a time.
    'utf16-nul': {
      title: '字间夹 NUL',
      mechanism: 'UTF-16LE 用两个字节表示一个常用字符，英文字母的第二个字节总是 `00`：「H」写作 `48 00`。把这样的文件按单字节编码读取，每个字母后面都会跟着一个 `U+0000`（NUL）——屏幕上多半看不见，文字像被隔空拉开；交给 C 语言字符串处理时，第一个 `00` 就被当成结尾，整段只剩一个字母。',
      lossNote: '',
      lore: 'Windows PowerShell 5.1 用 `>` 重定向写出的文件默认就是 UTF-16LE。这类文件交给 Git 或 grep，常被当成二进制文件（它们正是靠"有没有零字节"来判断的）。',
      quips: {
        humor: ['每个字母都拖着一个看不见的"影子"——那是 UTF-16 留下的零字节。'],
        academic: ['零字节与 ASCII 字节交替出现，是 UTF-16 文本被按单字节解读的最强统计特征之一。'],
        snark: ['字母之间全是空气，这不叫排版，这叫 UTF-16。'],
      },
      era: [1996, null],
      eraWhy: 'UTF-16 自 Unicode 2.0（1996）起成为 Windows "Unicode" 文本的主流格式',
      site: '一份由 Windows PowerShell 5.1 重定向写出、又被按单字节编码打开的日志文件',
      tips: ["用 UTF-16 解码：Python `open(path, encoding='utf-16-le')`，或 `iconv -f UTF-16LE -t UTF-8`。", 'Windows PowerShell 5.1 写文件时加 `-Encoding utf8`；PowerShell 7 默认输出无 BOM 的 UTF-8。'],
    },
    replacement: {
      title: '成片的 �',
      mechanism: '替换字符 `U+FFFD`「�」是解码器的"查无此字"章：遇到无法解释的字节，就在那里盖一个 `�`，原字节随即被丢弃。它的 UTF-8 编码是 `EF BF BD`——无论原来是什么字节，替换之后都长一个样，所以无从还原。最常见的成因是把 GBK、Windows-1252 等非 UTF-8 文本当作 UTF-8 读取，又把结果保存了下来。',
      lossNote: '每个 `�` 背后，都是一个（或几个）再也找不回来的字节。',
      lore: '这个黑底白问号的菱形正式名叫 REPLACEMENT CHARACTER，是 Unicode 专门为"出错了"准备的字符。',
      quips: {
        humor: ['每一个 `�` 都是一块小墓碑，上面写着"此处曾有一个字节"。'],
        academic: ['U+FFFD 的出现标志着解码阶段的信息丢失，此后的任何处理都只能在残缺数据上进行。'],
        snark: ['`�` 是解码器在说：我尽力了，但我不打算告诉你原来是什么。'],
      },
      era: null,
      eraWhy: '替换字符抹掉了原始字节，也抹掉了大部分年代线索',
      site: '某个把非 UTF-8 文件按 UTF-8 读取、又把结果存了下来的程序',
      tips: ['回到源头：用正确的编码重新读取原始文件，而不是在已经出现 `�` 的文本上修修补补。', "读取编码未知的文件时用 `errors='surrogateescape'`（Python）保留原字节，而不是让它们变成 `�`。"],
    },
    'question-marks': {
      title: '满屏问号',
      mechanism: '一串 `?`（字节 `3F`）往往是有损转换的痕迹：当文字被转换到一个装不下它的字符集时（比如把中文存进 latin1 列，或者用只支持 ASCII 的方式输出中文），编码器会用 `?` 顶替无法表示的字符。和 `�` 一样，原字符已经永远消失了。',
      lossNote: '问号是编码器在"装不下"时顶替原字符留下的，原字符已经不在了。',
      lore: '与 `�` 不同，`?` 产生于"编码"阶段：程序明明知道这是什么字，却因为目标字符集里没有它，只好写下一个问号。',
      quips: {
        humor: ['满屏问号——连文字自己都很困惑。'],
        academic: ['问号替换发生于编码阶段，属于"明知故犯"的信息丢弃。'],
        snark: ['????——这也是我看到你们数据库配置时的表情。'],
      },
      era: null,
      eraWhy: '任何一次有损的字符集转换都可能留下问号，单凭它很难断代',
      site: '某个字符集配置过窄的数据库或终端',
      tips: ['数据库的列、表与连接字符集统一用 `utf8mb4`，避免中文写进 latin1 列被替换成 `?`。', 'Java 的 `String.getBytes(charset)` 遇到无法编码的字符会默默换成 `?`；需要严格校验时改用 `CharsetEncoder` 并设置 `CodingErrorAction.REPORT`。'],
    },
    'notepad-bush': {
      title: 'Bush hid the facts', famous: true, family: true,
      mechanism: 'Windows 2000/XP 的记事本用 `IsTextUnicode` 启发式函数猜测文件编码。像 "Bush hid the facts" 这种长度和字母分布都恰到好处的纯 ASCII 文本，会被误判成 UTF-16LE：每两个字节拼成一个 16 位码元，例如 `42 75`（「B」「u」）→ `U+7542`「畂」，整句话就变成了「畂桳栠摩琠敨映捡獴」。',
      lossNote: '',
      lore: '当年这个现象被传成了"阴谋论"，其实只是一个统计启发式猜错了。Windows Vista（2007）的记事本修复了这个问题。',
      quips: {
        humor: ['一句英文被记事本"翻译"成了一串很有学问的汉字——史上最离谱的机翻。'],
        academic: ['该案例常被用作"编码自动检测本质上是统计推断"的教学范例。'],
        snark: ['记事本：我觉得你是 UTF-16。文件：我不是。记事本：你是。'],
      },
      era: [2000, 2007],
      eraWhy: 'Windows 2000/XP 的记事本才有这个毛病，Vista（2007）已经修复',
      site: '一台 Windows XP 电脑上的记事本',
      tips: ['在 Windows Vista 及以后的记事本中重新打开即可——那个启发式在 2007 年就修好了。'],
    },
  };

  // name: the canonical scheme name (docs/ARCHITECTURE.md §6); short: the word used in titles.
  const SCHEMES = {
    percent: { name: 'URL 百分号编码', short: '百分号封装', habitat: '一条 URL 的查询参数', byte: true },
    'hex-escape': { name: '\\x 十六进制转义', short: '\\x 转义', habitat: '一段程序日志或源码里的字符串', byte: true },
    'quoted-printable': { name: 'Quoted-Printable 编码', short: 'QP 封装', habitat: '一封 MIME 电子邮件', byte: true },
    'hex-dump': { name: '十六进制字节串', short: '十六进制转储', habitat: '一份十六进制转储', byte: true },
    'unicode-escape': { name: '\\u Unicode 转义', short: '\\u 转义', habitat: '一个 JSON 字符串或 JavaScript 源码', byte: false },
    'html-entity': { name: 'HTML 实体', short: 'HTML 实体封装', habitat: '一段网页 HTML 源码', byte: false },
  };

  // How one byte looks when the single-byte decoder W reads it (null when unknown,
  // undefined or invisible, so callers can leave the glyph clause out).
  function byteGlyph(W, b) {
    let ch = null;
    try {
      const C = MBX.Codecs;
      if (C && typeof C.decode === 'function' && typeof C.get === 'function' && C.get(W)) ch = C.decode(W, Uint8Array.of(b)).text;
    } catch (_) { ch = null; }
    if (ch == null && (W === 'windows-1252' || W === 'iso-8859-1') && b >= 0xa0) ch = String.fromCharCode(b);
    if (!ch || cps(ch).length !== 1 || ch === '�' || ch === '`' || ch === '*') return null;
    return invisibleKind(ch.codePointAt(0)) ? null : ch;
  }

  // `Ã`、`Â` for the given bytes in W, or null when any of them has no visible glyph.
  function glyphRun(W, bytes, sep) {
    const gs = bytes.map((b) => byteGlyph(W, b));
    return gs.every(Boolean) ? gs.map((g) => '`' + g + '`').join(sep == null ? '、' : sep) : null;
  }

  // UTF-8 lead bytes → what usually lives behind them (for the "fingerprint" note). The
  // glyphs are those of the relic's own wrong decoder W: 1251 shows D0 as Р, Mac Roman
  // shows C3 as √ — only Windows-1252 turns them into Ð and Ã.
  function leadMeaning(lead, second, W) {
    const west = W === 'windows-1252' || W === 'iso-8859-1';
    let g;
    if (lead === 0xc2 || lead === 0xc3) {
      g = glyphRun(W, [0xc3, 0xc2]);
      return '它是带音标拉丁字母（é、ü、ñ）与 ©、° 等符号的 UTF-8 前导字节' + (g ? '，满屏 ' + g + ' 基本就是它的指纹' : '');
    }
    if (lead >= 0xc4 && lead <= 0xcb) return '它是拉丁扩展字母（如中欧语言的 ł、ő）的 UTF-8 前导字节';
    if (lead === 0xce || lead === 0xcf) return '它是希腊字母的 UTF-8 前导字节';
    if (lead === 0xd0 || lead === 0xd1) {
      g = glyphRun(W, [0xd0, 0xd1]);
      return '它是西里尔字母（俄文等）的 UTF-8 前导字节' + (g ? '，满屏 ' + g + ' 就是俄文的指纹' : '');
    }
    if (lead === 0xd7) return '它是希伯来字母的 UTF-8 前导字节';
    if (lead >= 0xd8 && lead <= 0xdb) return '它是阿拉伯字母的 UTF-8 前导字节';
    if (lead === 0xe0) return '它是天城文、泰文等文字的 UTF-8 前导字节';
    if (lead === 0xe2 && second === 0x80) {
      g = glyphRun(W, [0xe2, 0x80], '');
      return '弯引号、破折号、省略号（“ ” ‘ ’ — …）的 UTF-8 都以 `E2 80` 开头' +
        (g ? '，在 ' + encName(W) + ' 里就是 ' + g + (west ? '——这大概是全世界出镜率最高的乱码' : '') : '');
    }
    if (lead === 0xe2) return '它是各类标点与符号（€、™、箭头等）的 UTF-8 前导字节';
    if (lead === 0xe3) return '它是日文假名与中日韩标点的 UTF-8 前导字节';
    if (lead >= 0xe4 && lead <= 0xe9) {
      g = glyphRun(W, [0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9], ' ');
      return 'E4–E9 是中日韩统一汉字的 UTF-8 前导字节' + (g ? '，看到成片的 ' + g + '，基本可以断定底下埋着汉字' : '');
    }
    if (lead >= 0xea && lead <= 0xed) return '它是韩文音节的 UTF-8 前导字节';
    if (lead === 0xef) return '它是全角字符、BOM 等的 UTF-8 前导字节';
    if (lead === 0xf0) return '它是 4 字节字符（emoji、生僻汉字）的 UTF-8 前导字节';
    return null;
  }

  /* ======================================================================
   * 4. Encoding lookups (narrator's own table first, then Codecs, then guesses)
   * ==================================================================== */

  function codecInfo(id) {
    try {
      const C = MBX.Codecs;
      return C && typeof C.get === 'function' ? C.get(id) || null : null;
    } catch (_) { return null; }
  }

  function encName(id) {
    if (!id) return '未知编码';
    const f = ENCODING_FACTS[id];
    if (f) return f.name;
    const info = codecInfo(id);
    return safe(info && info.name ? info.name : String(id).toUpperCase());
  }

  function encKnown(id) {
    return !!(id && (ENCODING_FACTS[id] || codecInfo(id)));
  }

  function encType(id) {
    const f = ENCODING_FACTS[id];
    if (f) return f.type;
    const info = codecInfo(id);
    if (info && info.type) return info.type;
    return 'single';
  }

  function invisibleBytes(id) {
    const info = codecInfo(id);
    if (info && Array.isArray(info.invisible) && info.invisible.length) return info.invisible;
    if (id === 'windows-1252') return [0x81, 0x8d, 0x8f, 0x90, 0x9d];
    if (id === 'iso-8859-1') { const a = []; for (let b = 0x80; b <= 0x9f; b++) a.push(b); return a; }
    return [];
  }

  function formatByteList(list) {
    if (!list.length) return '若干不可见字节';
    const contiguous = list.every((b, i) => i === 0 || b === list[i - 1] + 1);
    if (list.length > 6 && contiguous) return '`' + hex2(list[0]) + '`–`' + hex2(list[list.length - 1]) + '`';
    return list.slice(0, 8).map((b) => '`' + hex2(b) + '`').join(' ');
  }

  function isAsciiText(s) { return /^[\x00-\x7f]*$/.test(s); }

  // Pair facts with sensible aliasing: iso-8859-1 ≈ windows-1252, ASCII-only
  // originals use the "ascii>" entries, and anything else gets generated facts.
  function pairFactsFor(E, W, original) {
    const key = E + '>' + W;
    if (PAIR_FACTS[key]) return { key, facts: PAIR_FACTS[key], generic: false };
    const aliases = [];
    if (W === 'iso-8859-1') aliases.push(E + '>windows-1252');
    if (W === 'windows-1252') aliases.push(E + '>iso-8859-1');
    if (original != null && isAsciiText(original)) aliases.push('ascii>' + W);
    for (const k of aliases) if (PAIR_FACTS[k]) return { key, facts: PAIR_FACTS[k], generic: false };
    return { key, facts: genericPair(E, W), generic: true };
  }

  function genericPair(E, W) {
    const e = ENCODING_FACTS[E];
    const w = ENCODING_FACTS[W];
    const eName = encName(E);
    const wName = encName(W);
    const tips = [];
    if (W === 'utf-8') {
      tips.push('这类伤通常不可逆：`�` 替换发生时原字节已被丢弃，请回到源头用 ' + eName + ' 重新读取原始文件。');
    }
    if (e && w && W !== 'utf-8') tips.push("急救：`s.encode('" + w.py + "').decode('" + e.py + "')`。");
    if (e) tips.push('统一转成 UTF-8：`iconv -f ' + e.iconv + ' -t UTF-8`。');
    tips.push('文件、数据库、网页与终端统一使用 UTF-8，并且每一处都显式声明编码。');
    const both = e && w;
    return {
      era: both ? [Math.max(e.born, w.born), null] : null,
      eraWhy: both
        ? eName + ' 诞生于' + (/^\d/.test(e.bornLabel) ? ' ' : '') + e.bornLabel + '，' + wName + ' 诞生于' + (/^\d/.test(w.bornLabel) ? ' ' : '') + w.bornLabel + '，这种误读只可能发生在两者都已登场之后'
        : '这是一种本馆尚未收录的编码组合，暂时无法给出可靠的年代',
      sites: ['一个用 ' + eName + ' 写下文字、却被当作 ' + wName + ' 打开的文件', '一套在 ' + eName + ' 与 ' + wName + ' 之间转手、却没人声明编码的系统'],
      culprits: ['缺失或错误的编码声明', '默认按 ' + wName + ' 解读文本的软件'],
      tips,
    };
  }

  /* ======================================================================
   * 5. Voices: three docents, several variants per slot
   * ==================================================================== */

  const VOICES = {
    humor: {
      headings: { opening: '开场白', identify: '鉴定结果', mechanism: '作案现场还原', dating: '字节测年', repair: '文物修复', conservation: '保护建议', easter: '彩蛋时间', closing: '结束语' },
      opening: [
        '各位观众，欢迎来到乱码考古博物馆！我是今天的讲解员{docent}。请大家往这边看——展柜里这件编号 `{exhibitId}` 的文物{relic}，{hook}',
        '嘘——小声点，别惊动了展柜里的字节。我是讲解员{docent}，欢迎参观"乱码考古"特展。今天的主角是编号 `{exhibitId}` 的出土文物{relic}，全长 {relicLen} 个字符。{hook}',
        '大家好，我是{docent}，今天由我带大家参观。先别急着拍照——眼前这件{relic}（馆藏编号 `{exhibitId}`）可不是外星文字，也不是古埃及咒语。{hook}',
        '欢迎欢迎！我是本馆最爱讲段子的讲解员{docent}。今天这件展品{relic}刚从某块硬盘里出土，馆藏编号 `{exhibitId}`。{hook}',
      ],
      hooks: {
        restored: [
          { t: '乍一看像是键盘被猫踩过，其实它有一段相当曲折的身世。', if: (c) => !c.escapeOnly },
          { t: '别看它长得歪瓜裂枣，每一个字节都是有"户口"的，今天我们就来查查它的档案。', if: (c) => !c.escapeOnly },
          { t: '它其实是一段被误会了的正常文字——误会有多深，等会儿您就知道了。', if: (c) => !c.escapeOnly },
          { t: '它其实一个字节都没坏——只是被打包成了转义序列，拆开就是原文。', if: (c) => c.escapeOnly },
          { t: '别被这一串符号唬住：它是一件"打了包"的文物，包装拆开，里面完好无损。', if: (c) => c.escapeOnly },
        ],
        partial: ['它有一部分已经被我们修好了，剩下的……还在观察室里。', '这是一件"残件"：能修的我们修了，修不了的，咱们也讲讲为什么。'],
        partialClean: ['它大部分是好好的文字，只有一小段被误读成了乱码——像一页书上溅了一滴墨。', '别被那一小段鬼画符吓到：其余的字从头到尾都完好无损。'],
        irrecoverable: ['先打个预防针：这件文物伤得很重，有些部分已经永远回不来了。', '这是一件"伤残文物"，请大家保持肃静，向逝去的字节默哀三秒。', '它的故事有点悲伤——不过悲伤的故事往往最有教育意义。'],
        debugMemory: ['先别报警：它不是坏掉的文字，而是程序把一块{mem}当成字符串打印了出来。', '这件展品有点特别——它从来就不是文字，是调试器刷在内存上的"警示漆"。'],
        clean: ['不过剧透一下：这可能是本馆有史以来最健康的一件展品。', '送检人怀疑它是乱码，我们拿放大镜看了半天……先卖个关子。', '它被送来的时候，大家都以为是乱码——结果嘛，等会儿揭晓。'],
        unknown: ['老实说，它的来历连我们馆长都挠头。', '这是一件"未解之谜"级别的展品，今天我们边讲边猜。', '它长得像乱码，却又不像任何一种已知的乱码——神秘感拉满。'],
      },
      subtitle: {
        restored: ['一段被 {W} 嚼碎又吐出来的 {E}', '{E} 字节在 {W} 世界里的奇幻漂流', '当 {E} 遇上 {W}：一场跨越编码的误会'],
        partial: ['一件只修好了一部分的 {E} 残件', '{E} 与 {W} 的局部误会', '修复进度：{progress}'],
        partialClean: ['正常文字里混进的一段 {E} 乱码', '一处 {E}→{W} 的局部误读', '乱码片段已归位，其余原本完好'],
        irrecoverable: ['字节已逝，乱码长存', '一件无法复原的伤残文物', '它曾经是一段文字'],
        debugMemory: ['一块{mem}，被当成了文字', '不是乱码，是调试器的警示色', '内存在用中文报警'],
        clean: ['一件品相完好的现代真品', '虚惊一场：这不是乱码', '健康证明：字节与字符严丝合缝'],
        unknown: ['来历不明的神秘铭文', '一件连馆长都挠头的展品', '未解之谜：它到底是什么编码？'],
      },
      identify: {
        restored: [
          '经过本馆专家组（其实就是一段 JavaScript）的会诊，结论出炉：这是一段**{langText}**，原文是{output}。作案链路：{chainPath}。鉴定把握 {conf}。',
          { t: '真相只有一个！这件文物的原貌是{output}（{lang}）。来龙去脉一句话：{chainPath}。本馆的把握是 {conf}，比天气预报靠谱一点。', if: (c) => c.confidence != null && c.confidence >= 0.8 },
          { t: '真相只有一个！这件文物的原貌是{output}（{lang}）。来龙去脉一句话：{chainPath}。本馆的把握是 {conf}。', if: (c) => c.confidence == null || c.confidence < 0.8 },
          { t: '鉴定结果出来了：{output}。没错，这串鬼画符原本就是这么一句朴素的{lang}。罪魁祸首：{chainPath}。把握 {conf}。', if: (c) => !c.repairs.length && !c.escapeOnly },
          { t: '鉴定结果出来了：{output}，一句{lang}。来龙去脉：{chainPath}。把握 {conf}。', if: (c) => c.repairs.length > 0 || c.escapeOnly },
        ],
        partial: [
          '这件文物我们只修好了一部分。目前能读出来的是{output}——{partNote}。修好的部分属于：{chainPath}。',
          '好消息和坏消息各一个。好消息是{fixedNote}；坏消息是其余部分没找到可信的还原链路，只能保持原样。目前的最佳读法是{output}，已确认的链路是：{chainPath}。',
          '鉴定结果：部分还原。{partNote}；目前的最佳读法是{output}，修好的片段来自：{chainPath}。',
        ],
        partialClean: [
          '鉴定结果：{fixedNote}，其余文字原本就完好。完整读法是{output}（{lang}）。作案链路：{chainPath}。',
          '这件文物只有一小块受了伤——{fixedNote}，其余部分本来就是好好的{lang}。修好后全文是{output}。罪魁祸首：{chainPath}。',
          '好消息：{fixedNote}；其余文字一直完好，不需要动。全文读作{output}，链路是：{chainPath}。',
        ],
        irrecoverable: [
          '很遗憾，这件文物伤得太重了。{lossDetail}就像被雨水泡过的竹简，有些字已经永远读不出来了。{outputNote}',
          '鉴定结果令人心碎：{lossDetail}这种伤，神仙也救不回来。{outputNote}',
          '这件属于"不可逆文物"：{lossDetail}我们能讲清它是怎么来的，但没法让它起死回生。{outputNote}',
        ],
        debugMemory: [
          '鉴定结果：这不是被损坏的文字，而是一块{mem}。{detail}它从来就没有"原文"，要修的不是文字，是程序。',
          '真相大白：{detail}屏幕上的字，其实是调试器往{mem}里刷的填充字节 {fill}——程序把它们当字符串打印了出来。',
          '这件展品没受过任何编码伤害。{detail}它是一块{mem}，填充值 {fill} 被 GBK 两两一组读成了{glyph}。',
        ],
        clean: [
          '好消息：经鉴定，这件展品**不是乱码**！它是一段完好的**{langText}**，字节与字符严丝合缝。本馆很少收到这么健康的"文物"，建议直接颁发"品相完好"证书。',
          '我们用二十多种编码把它翻来覆去"折腾"了一遍，结果发现——最通顺的就是它现在的样子。结论：**真品无误**，一段正常的{langText}。',
          '鉴定结果：这是一件**现代真品**，语言为{lang}。没有错位、没有误读，干净得让考古队有点失落。',
        ],
        unknown: [
          '说实话，这件文物把我们难住了。{signalNote}我们试遍了常见的编码组合，没有一个能把它变成通顺的文字。{altNote}',
          '本馆专家组吵了一下午也没定论。{signalNote}{altNote}',
          '未解之谜！{signalNote}也许它是某种我们还没收录的编码，也许它压根是一段密码，也许……它就是猫踩出来的。{altNote}',
        ],
      },
      lowConfidence: ['不过馆里也有专家持不同意见，认为它也可能是{altOutput}（{altLabel}，{altConf}）——学术争鸣，欢迎围观。', '当然，也有一派考古学家坚持认为是{altOutput}（{altLabel}，{altConf}），这事儿还没吵完。'],
      sigMention: [
        { t: '另外，它身上还带着名器印记**{sigTitle}**——这可是镇馆级别的特征，彩蛋环节细说。', if: (c) => c.signatures.every((s) => s.fact && s.fact.famous) },
        '眼尖的观众可能已经发现了：它身上带着**{sigTitle}**的印记！稍后详谈。',
      ],
      sigMentionFamily: ['眼尖的观众可能已经认出来了：它属于大名鼎鼎的**{sigTitle}**家族！稍后详谈。', '这件文物还有个出名的亲戚：它和**{sigTitle}**是一家子，彩蛋环节细说。'],
      mechIntro: ['好，重头戏来了——请大家掏出放大镜，我们看字节。', '接下来请大家戴上"字节眼镜"，咱们把这件文物切开看看。', '来，我们把文物翻个面，看看它的字节"骨骼"。'],
      multiIntro: ['这件文物有 {n} 层地层，我们从最深处开始往上挖：', '它可不是一次成型的——足足 {n} 层，像千层饼一样。从最底下那层说起：'],
      wrong: {
        single: ['{W} 是个"一字节一个字"的老实人，压根不知道 {E} 的字符是几个字节抱团的，于是挨个拆开查表。', '{W} 的世界观很简单：一个字节就是一个字。它才不管 {E} 的这几个字节是不是一家人。', '{W} 单字节、不回头，一个字节查一次表，多字节字符在它手里只会被大卸八块。'],
        double: ['{W} 是个"两字节一口"的吃货：见到高位字节，就连同后面一个字节一口咬下。偏偏 {E} 的字符不是两个字节一组，于是越咬越错位。', '{W} 吃字节是两个两个地吃，可 {E} 不是这么排队的——一口咬在两个字的接缝上，是常有的事。', '{W} 是双字节编码，遇到高位字节就"两个一组"；{E} 的分组却不一样，结果就是"牙口"对不上。'],
        shift: ['{E} 和 {W} 都是双字节编码，可"牙口"不一样：{W} 会把某些高位字节单独当成一个字，于是 {E} 的字节被切成了另一套分组。', '{E} 与 {W} 都爱两个字节一口，偏偏对"哪些字节该单独成字"意见不一——一处分歧，后面的分组就全乱了。', '两个双字节编码碰头，本以为能对上号，结果 {W} 的分组规则跟 {E} 不一样，字节被拆成了别的组合。'],
        utf8: ['UTF-8 解码器是个强迫症：前导字节后面必须跟着格式正确的续字节（10xxxxxx），差一点都不行，不合规的一律换成 `�`。', 'UTF-8 解码器眼里揉不得沙子：字节结构一不对，立刻发一张 `�` 罚单。', 'UTF-8 有严格的"户籍制度"：不是合法序列的字节，统统被替换成 `�`。'],
        same: ['{E} 和 {W} 每个字符占的字节数一样，字节对得整整齐齐，只是同一个字节在两张码表里对应着不同的字——相当于拿错了密码本。', '这回没有"拆字"，只有"换字"：同样的字节，{E} 的表里是一个字，{W} 的表里是另一个。', '{W} 和 {E} 的"牙口"一样，一个字也没咬错位置——可惜两本字典不是同一本。'],
        utf16: ['{W} 解码器两个字节一组，把两个 ASCII 字母硬拼成一个 16 位码元——英文秒变"汉字"。', '{W} 一口吞两个字节，结果两个英文字母合体成了一个看起来很有文化的汉字。', '{W} 把每两个字节当成一个字，于是英文句子被"压缩"成了一串神秘汉字。'],
      },
      trace: ['以{orig}为例：它的 {E} 字节是 `{hex}`，到了 {W} 手里，{action}。', '看{origCp}：{E} 把它写成 `{hex}`，{W} 却{action}。', '{orig}在 {E} 里是 `{hex}`——{W} 一看，{action}。'],
      traceUp: ['上一层产生的{glyph}这回被当成了 {E} 文字：它的字节是 `{hex}`，又被 {W} {action}。', '接着，{glyph}被按 {E} 存成 `{hex}`，{W} 再读一遍，{action}。'],
      crossNote: ['整件文物里一共有 {k} 处这样的"跨界咬合"。', '像这样一口咬在两个字接缝上的情况，全文一共 {k} 处。'],
      mechOutro: [
        '所以你看，字节一个都没丢，只是被"读错了"。乱码不是数据坏了，是理解出了偏差——跟人一样。',
        '说白了，这就是一场"我以为你说的是那个意思"的误会。',
        { t: '这就好比把{L1}菜谱用{L2}念出来——每个音都在，意思全没了。', if: (c) => !!c.analogy },
        { t: '字节就像乐谱上的音符，换一本错的调号表来演奏，旋律就面目全非了。', if: (c) => !c.analogy },
      ],
      mechOutroLossy: ['可惜在这个过程中，有些字节被替换或丢掉了——误会还能解释，丢了的可就真丢了。', '只是这一次，误读的同时还发生了"丢件"，所以修复要靠推理，不全是还原。'],
      mechOutroUnrepaired: ['可惜有字节在半路丢了，又没有足够的线索把它补回来——结果里仍留着 `�`，那是一个诚实的空位。', '误读的部分都倒回去了，丢了的字节却补不回来，所以结果里还留着 `�`。'],
      memIntro: ['我们来看看这些字是怎么"长"出来的：', '这些字不是从哪段文字里变来的，而是从内存里"冒"出来的：', '它的来历，要从调试器说起：'],
      mechOutroLost: ['到了这一步，原来的字节早已被顶替，后面的每一次误读都只是在废墟上又盖了一层。', '我们能把废墟一层层挖开，却挖不出已经消失的字节。', '所以您看到的，是一次事故留下的"化石"，而不是被误会的文字。'],
      mechOutroEscape: ['剥掉这层"包装纸"，文字就原样露出来了——严格说它不是损坏，只是被打了包。', '所以这件文物其实毫发无伤，只是穿了一身"转义盔甲"。', '转义是无损的：只要知道规则，一个字节都不会少。'],
      specimenIntro: ['既然是真品，我们就把它当"标准标本"看看：', '给大家做个对照实验：', '借这件健康标本，顺便上一堂编码课：'],
      lostIntro: ['我们来看看它是怎么"阵亡"的：', '虽然救不回来，但"死因"我们查得清清楚楚：', '验伤报告如下：'],
      unknownMech: ['虽然没破案，我们还是收集到一些线索：', '线索板上目前钉着这些东西：', '我们手里的证据不多，先摆出来：'],
      dating: [
        '接下来是本馆独门绝技——**字节测年法**（比碳十四便宜，比星座准）。{evidence}综合判断，这件文物形成于**{era}**。推测出土地点：{site}。',
        '我们把它放进"字节测年仪"里转了三圈：{evidence}所以，它的年代是**{era}**。至于出土地点，我们怀疑是{site}。',
        '测年时间到！{evidence}结论：**{era}**。如果它会说话，八成会告诉你它来自{site}。',
      ],
      datingUnknown: ['测年仪转了半天，只吐出几个字：**{era}**。{evidence}', '这件文物的年代嘛……测年仪给出的答案是**{era}**。{evidence}没有足够的地层证据，我们不乱猜。'],
      datingClean: ['测年？不需要。它是一段**{eraShort}**的正常文本。{evidence}', '字节测年仪对它不感兴趣：**{era}**。{evidence}'],
      suspects: ['头号嫌疑人：{culprits}。', '本案嫌疑人名单：{culprits}。'],
      repairIntro: ['这件文物送来时缺胳膊少腿，我们的修复师做了些"微创手术"：', '修复记录如下（修复师已累瘫在工作台上）：', '文物有破损，我们动用了"字节推理术"来补全：'],
      conservationIntro: ['为了防止它的子孙后代再遭此劫，本馆给出以下保护建议：', '想不再挖出这种文物？请收好这份"防乱码护身符"：', '文物保护建议，建议打印出来贴在显示器旁边：'],
      easterIntro: ['最后是彩蛋时间！', '附赠一个可以在饭桌上炫耀的冷知识：', '讲到这儿，必须送大家一个彩蛋：'],
      closing: {
        restored: ['好了，今天的讲解就到这里。记住本馆的镇馆格言：**字节无罪，误读有罪**。出口在右手边，纪念品商店有售印着「锟斤拷」的文化衫。', '感谢各位的耐心。下次再在屏幕上看到这种"天书"，别慌，送到本馆来，我们给它上户口。', '讲解结束！临走前送大家一句口诀：**存的时候说清楚，读的时候问清楚**——编码这事，最怕"我以为"。'],
        irrecoverable: ['今天的讲解有点沉重。请记住：**替换字符一旦出现，原字节就回不来了**——备份，备份，还是备份。', '让我们向这些逝去的字节致敬。散场时请顺手检查一下自家数据库的字符集。', '故事讲完了，文物修不好，但教训留下了：编码转换时，**别让替换字符悄悄吃掉你的数据**。'],
        clean: ['今天的展品太健康，讲解员有点失业。欢迎下次带一件真正的乱码来！', '好了，这件"真品"可以原样带回家了。祝您的字节永远对得上号。', '散场！这件展品免检通关。真正的乱码，我们随时恭候。'],
        unknown: ['这件文物暂时存入"未解之谜"展柜。如果您找到它的原始文件，欢迎回来补充线索！', '今天没能破案，但科学就是这样——承认不知道，也是一种专业。', '讲解到此结束。如果您知道它的来历，请务必告诉馆长，他已经三天没睡好了。'],
        partialClean: ['讲解结束！这件文物只是溅了一小块乱码，现在已经擦干净了。记住：**存的时候说清楚，读的时候问清楚**。', '感谢各位。下次看到正常文字里夹着一小段"天书"，别急着整段重来——送来本馆，我们只修坏掉的那一块。', '好了，今天就到这里。乱码片段归位，其余文字完好如初。'],
        debugMemory: ['今天的讲解到此结束。回去把变量初始化了吧——内存不会自己变干净。', '散场！记住口诀：看到「烫」先查栈上的变量初始化，看到「屯」先查 malloc，看到「葺」先查悬空指针。', '讲解完毕。这件展品不用修复，该修的是代码。'],
        escape: ['好了，今天的讲解就到这里。这件文物只是穿了件"转义外套"，脱下来就是原样——下次见到它，自己动手拆包装吧。', '感谢各位。记住：转义不是损坏，规则在手，一个字节都不会少。', '讲解结束！转义文物是本馆最省心的展品：知道规则，一行代码就能拆开。'],
      },
    },

    academic: {
      headings: { opening: '引言', identify: '鉴定结论', mechanism: '成因机制', dating: '年代测定', repair: '修复报告', conservation: '保护建议', easter: '附记', closing: '结语' },
      opening: [
        '各位来宾好，我是本馆研究员{docent}。本次展出的标本编号为 `{exhibitId}`，原始形态为{relic}，共 {relicLen} 个码位。{hook}',
        '欢迎参观。我是{docent}，负责标本 `{exhibitId}` 的学术解读。该标本的原始形态为{relic}。{hook}',
        '诸位好，我是{docent}。乱码研究的基本前提是：字节不会说谎，说谎的是解码器。本件标本 `{exhibitId}`（{relic}）正是检验这一前提的样本。{hook}',
      ],
      hooks: {
        restored: [
          '以下将依次报告其鉴定结论、成因机制、年代测定与保护建议。',
          { t: '它属于典型的"文字化け"（mojibake）遗存：字节本身完好，失真发生在解释层面。', if: (c) => !c.escapeOnly && !c.repairs.length },
          { t: '初步观察显示，该标本具备明显的误解码统计特征。', if: (c) => !c.escapeOnly },
          { t: '需要预先说明：该标本并非误解码遗存，而是一层可逆的转义封装，信息完整无损。', if: (c) => c.escapeOnly },
        ],
        partial: ['该标本仅部分可复原，以下分别说明已复原与未复原的部分。', '该标本呈现混合特征：部分片段可逆，部分片段已失真。'],
        partialClean: ['该标本以正常文本为主，仅局部片段存在误解码特征。', '初步观察显示，标本中只有个别片段失真，其余部分为完好的原文。'],
        irrecoverable: ['需要预先说明：该标本存在不可逆的信息损失。', '该标本的特殊之处在于，它记录的是一次信息丢失事件。', '本报告将重点讨论其损毁机制，而非复原。'],
        debugMemory: ['需要预先说明：该标本并非文本损毁，而是{mem}被按 GBK 解读的结果。', '该标本记录的不是编码事故，而是一次内存使用错误。'],
        clean: ['本报告将说明为何该标本应被判定为正常文本。', '送检方怀疑其为乱码，本报告给出检验过程与结论。', '本件标本可作为"阴性对照"供参观者比较。'],
        unknown: ['需要说明的是，本标本的成因尚未确证。', '该标本具有若干可疑特征，但现有证据不足以确定其形成链路。', '本报告将呈现现有线索，并如实标注不确定性。'],
      },
      subtitle: {
        restored: ['{E} 字节序列经 {W} 解码形成的误读遗存', '{E}→{W} 型文字化け标本', '一例 {E}/{W} 编码错配的字节学考察'],
        partial: ['{E}→{W} 型局部失真标本', '可部分复原的 {E} 误读遗存', '一例局部可逆的编码错配'],
        partialClean: ['含局部 {E}→{W} 误读片段的文本标本', '局部误读型 {E} 遗存（其余部分完好）', '一例局部 {E}/{W} 编码错配'],
        irrecoverable: ['不可逆信息丢失型标本', '替换字符污染型遗存', '一例有损转换的考古记录'],
        debugMemory: ['调试填充字节型非文本遗存', '一例被误作文本的{mem}', 'MSVC 调试内存标本'],
        clean: ['阴性对照：正常文本标本', '未检出误解码特征的现代文本', '对照组标本'],
        unknown: ['成因待考的疑似乱码标本', '来源不明的可疑字节遗存', '待进一步鉴定的标本'],
      },
      identify: {
        restored: [
          '鉴定结论：标本原文为{output}，语言判定为{lang}。形成链路：{chainPath}（共 {depth} 层）。综合可读性评分，本鉴定的置信度为 {conf}。',
          '经逆向解码复原，标本原文为{output}（{lang}）。其成因可表述为：{chainPath}。置信度 {conf}。',
          '复原结果为{output}。以可读性评分为判据，最优解释是：{chainPath}；置信度 {conf}，语言为{lang}。',
        ],
        partial: [
          '鉴定结论：部分复原。{partNote}。当前最优读法为{output}，已复原片段的成因为：{chainPath}。',
          '标本经分段处理后，{partNote}；复原文本为{output}。可确认的链路：{chainPath}。',
          '结论：局部可逆。最优读法为{output}；{partNote}。已复原部分对应：{chainPath}。',
        ],
        partialClean: [
          '鉴定结论：局部误读。{fixedNote}，其余 {keptN} 个字符为未经误读的原文。复原文本为{output}；误读片段的成因为：{chainPath}。',
          '标本经分段检验，仅{frags}存在误解码特征：{fixedNote}；其余部分为完好的原文。复原文本为{output}，成因：{chainPath}。',
          '结论：局部可逆，且误读片段已全部复原。{fixedNote}，其余文字原本完好。全文为{output}（{lang}），误读片段对应：{chainPath}。',
        ],
        irrecoverable: [
          '鉴定结论：不可逆损毁。{lossDetail}在信息论意义上，原文已无法唯一复原。{outputNote}',
          '标本属于有损失真。{lossDetail}可推断其成因，但无法恢复原文。{outputNote}',
          '结论：信息已丢失。{lossDetail}以下仅给出成因分析与预防建议。{outputNote}',
        ],
        debugMemory: [
          '鉴定结论：非文本遗存。{detail}标本为{mem}，填充值 {fill} 经 GBK 解读后显示为{glyph}；不存在可复原的原文。',
          '该标本不属于编码损毁，而是内存使用错误的外在表现。{detail}其字节为调试填充值 {fill}，对应{mem}。',
          '结论：标本为调试运行时的填充字节。{detail}应排查的是程序中对{mem}的读取，而非文本编码。',
        ],
        clean: [
          '鉴定结论：标本为正常的{langText}，未检出误解码特征。在所有候选编码组合下，保持原样的可读性评分最高，故判定为"无乱码"。',
          '经系统检验，标本不具备 mojibake 的统计特征，判定为真品（{lang}），无需复原。',
          '结论：阴性。标本为正常的{langText}，任何重新编解码操作都只会降低其可读性。',
        ],
        unknown: [
          '鉴定结论：成因未定。{signalNote}在常见编码组合的搜索空间内，未找到可读性显著提升的解释。{altNote}',
          '现有证据不足以确定形成链路。{signalNote}{altNote}',
          '本标本暂列为"待考"。{signalNote}它可能涉及未收录的编码，也可能是加密或压缩数据。{altNote}',
        ],
      },
      lowConfidence: ['需要指出，另一解释——{altOutput}（{altLabel}，{altConf}）——亦不能完全排除。', '竞争假说为{altOutput}（{altLabel}，{altConf}），两者的可读性差距有限，结论宜审慎看待。'],
      sigMention: ['此外，标本含有已知签名**{sigTitle}**，详见附记。', '值得注意的是，标本中检出典型签名**{sigTitle}**。'],
      sigMentionFamily: ['此外，该标本属于已知的**{sigTitle}**类案例，详见附记。', '值得注意的是，该标本与著名的**{sigTitle}**案例同属一类。'],
      mechIntro: ['以下给出成因机制的字节级分析。', '机制分析须回到字节层面。', '我们从字节序列入手，复原其形成过程。'],
      multiIntro: ['标本共含 {n} 层地层（{k} 层误读{escNote}），按形成先后自深而浅叙述：', '该标本经历了 {k} 次编解码错配{escAnd}，以下按地层由深至浅逐层说明：'],
      wrong: {
        single: ['{W} 为单字节编码，解码时对每个字节独立查表，不考虑多字节序列的边界。', '{W} 将每个字节视为一个独立字符，{E} 多字节序列的结构信息因此被完全忽略。', '在 {W} 的模型中，字节与字符一一对应；{E} 的多字节字符因此被拆解为若干单字节字符。'],
        double: ['{W} 为双字节编码：首字节落在高位区时，与随后一个字节组合为一个字符。由于 {E} 的字符长度与之不同，分组边界会逐步错开。', '{W} 以"首字节 + 尾字节"为单位解码；当 {E} 的字符边界与这一分组不一致时，便出现跨字符的错位组合。', '{W} 的解码粒度为两个字节（ASCII 除外），与 {E} 的字符边界并不对齐。'],
        shift: ['{E} 与 {W} 虽同为双字节编码，但字节分组规则不同：{W} 将部分高位字节视为单字节字符，导致分组边界与 {E} 的字符边界不一致。', '两者的首字节区间并不重合，{W} 的分组因此在若干位置与 {E} 的字符边界错开。', '尽管二者均以双字节为主，{W} 的单字节区与 {E} 的双字节区存在重叠，分组边界随之偏移。'],
        utf8: ['UTF-8 解码器对字节结构有严格约束（前导字节 + 若干 10xxxxxx 续字节），不合法的序列按 WHATWG 规则替换为 U+FFFD。', 'UTF-8 是自同步编码，非法序列会被确定性地识别并替换为 U+FFFD，原字节随之丢失。', '按 UTF-8 解码时，不符合"前导字节 + 续字节"结构的字节会被替换为 U+FFFD。'],
        same: ['{E} 与 {W} 的字符宽度相同，字节分组并未错位；失真仅来自两张码表在同一字节位置上的不同映射。', '两者之间的误读不改变分组方式，属于纯粹的"码表置换"：字节序列不变，映射关系改变。', '由于 {E} 与 {W} 的字节宽度一致，此类误读可视为逐字符的码表替换。'],
        utf16: ['{W} 解码器以两个字节为一个码元组合（ASCII 字母两两组合后多落入 CJK 统一汉字区）。', '{W} 将相邻两字节组合为一个 16 位码元，因而 ASCII 文本被"压缩"为半数个 CJK 字符。', '在 {W} 解码下，每对字节构成一个码元。'],
      },
      trace: ['{origCp}在 {E} 中编码为 `{hex}`；{W} 将其解读为 {mapping}。', '以{orig}为例：其 {E} 字节序列为 `{hex}`，经 {W} 解码得到 {mapping}。', '{origCp}的 {E} 编码为 `{hex}`，在 {W} 下被解读为 {mapping}。'],
      traceUp: ['上一层的产物{glyph}在本层被重新编码为 {E}（`{hex}`），继而被 {W} 解读为 {mapping}。', '本层中，{glyph}的 {E} 字节 `{hex}` 再次经 {W} 解码，得到 {mapping}。'],
      crossNote: ['全文共计 {k} 处跨字符边界的错位组合。', '统计显示，全文有 {k} 个乱码字符由相邻两个原字符的字节拼合而成。'],
      mechOutro: ['可见字节序列本身未受损，失真完全源于解码约定的错配；只要逆向执行"按错误编码重新编码、按正确编码重新解码"即可复原。', '本例再次说明：文本 = 字节 + 编码约定，二者缺一不可。', '上述过程是可逆的，前提是中间环节没有发生字符替换或字节丢失。'],
      mechOutroLossy: ['需要注意，该过程中出现了替换或丢失，复原部分依赖推断，应视为"修复"而非"还原"。', '由于存在有损环节，部分字符的复原是基于上下文的最大似然推断。'],
      mechOutroUnrepaired: ['需要注意，该过程中有字节丢失，现有上下文不足以确定其原貌，复原结果中保留了 U+FFFD 作为缺失标记。', '丢失的字节未被补全：结果中的 U+FFFD 如实标出了信息缺口的位置。'],
      memIntro: ['其形成机制如下：', '以下说明这些字符的来源：', '该标本的字节来源可追溯如下：'],
      mechOutroLost: ['由此可见，信息丢失发生在更早的解码环节，后续误读只是在残缺数据上叠加失真。', '逆向解码可以剥离后续的误读层，但无法恢复已被替换的原始字节。', '因此，本标本的价值在于记录事故过程，而非复原原文。'],
      mechOutroEscape: ['转义编码本身是无损的，按规则逆向解码即可完整复原。', '严格而言，本标本并非误解码遗存，而是一层可逆的转义封装。', '此类标本的复原不涉及任何推断：转义规则是确定性的。'],
      specimenIntro: ['作为阴性对照，我们记录其字节特征：', '以下给出该标本的字节表示，供与乱码标本对照：', '附该标本的字节学描述：'],
      lostIntro: ['损毁机制分析如下：', '以下说明信息丢失发生的环节：', '其失真机制可复原如下：'],
      unknownMech: ['现有线索整理如下：', '以下列出已观察到的特征及其可能含义：', '可供参考的诊断信息：'],
      dating: [
        '年代测定（字节测年法）：{evidence}据此推定形成年代为**{era}**。推测出土环境：{site}。',
        '关于年代：{evidence}综合上述证据，本标本的形成年代宜定为**{era}**；最可能的出土环境为{site}。',
        '采用"字节测年法"进行断代。{evidence}结论：**{era}**；出土环境推测为{site}。',
      ],
      datingUnknown: ['断代结果：**{era}**。{evidence}', '{evidence}现有证据不足以收窄范围，断代结论暂为：**{era}**。'],
      datingClean: ['无需断代：**{era}**。{evidence}', '该标本为**{eraShort}**的正常文本，无需断代。{evidence}'],
      suspects: ['可能的责任环节：{culprits}。', '相关责任环节推测为：{culprits}。'],
      repairIntro: ['修复报告：', '以下为逐项修复记录：', '本标本存在缺损，修复依据与结果如下：'],
      conservationIntro: ['为避免同类失真再次发生，提出以下保护建议：', '保护与预防建议如下：', '基于上述成因，建议采取以下措施：'],
      easterIntro: ['附记：', '补充一则相关史料：', '另附一则考据：'],
      closing: {
        restored: [{ t: '以上为本标本的完整鉴定报告。结论可概括为：字节层面完好，解释层面失真。欢迎各位继续参观其他展品。', if: (c) => !c.flags.lossy }, { t: '以上为本标本的完整鉴定报告。结论可概括为：失真主要发生在解释层面，个别字节的缺损已按上下文推断补全。欢迎各位继续参观其他展品。', if: (c) => c.flags.lossy && c.repairs.length > 0 }, { t: '以上为本标本的完整鉴定报告。结论可概括为：失真主要发生在解释层面，另有个别字节在转换中丢失，结果中以 U+FFFD 如实标出。欢迎各位继续参观其他展品。', if: (c) => c.flags.lossy && !c.repairs.length },'本报告到此结束。乱码研究提醒我们：文本从来不只是"字符"，而是"字节 + 约定"；约定一旦缺席，字节便会被任意诠释。', '谢谢聆听。若有新的出土材料（更长的上下文或原始文件），本馆可进一步收窄链路与年代的不确定性。'],
        irrecoverable: ['本报告到此结束。该标本提示：有损转换一旦发生，再精巧的算法也无法凭空恢复信息。', '谢谢聆听。建议相关方尽快查找原始数据源，那是唯一可靠的复原途径。', '以上。信息论的结论很朴素：被丢弃的比特不会自己回来。'],
        clean: ['以上为对照标本的检验报告。该标本可作为后续乱码鉴定的参照。', '本报告到此结束。结论为阴性，无需进一步处理。', '谢谢聆听。正常文本同样值得研究——它展示了"约定一致"时文本应有的样子。'],
        unknown: ['本报告暂告一段落，标本列入待考目录。欢迎提供更多出土材料。', '谢谢聆听。科学研究允许"尚无定论"，本标本即为一例。', '以上为初步报告。若能获得原始字节，可显著提高鉴定的可靠性。'],
        partialClean: ['以上为本标本的鉴定报告。结论：局部误读片段已复原，其余文本完好。', '本报告到此结束。局部乱码通常源于拼接：一段文本在某个环节被单独误读后，又与正常文本合在了一起。', '谢谢聆听。若能获得原始文件，可进一步确认误读片段的来源。'],
        debugMemory: ['本报告到此结束。该标本提示：读取前未初始化或已释放的内存，是比编码错配更值得警惕的程序缺陷。', '谢谢聆听。建议相关方在 Debug 构建下复现该输出，并定位读取这块内存的代码。', '以上。调试填充值的存在本身就是诊断信息：它指明了应当排查的内存区域。'],
        escape: ['以上为本标本的完整鉴定报告。结论可概括为：转义封装无损，按规则逆向解码即得原文。', '本报告到此结束。转义编码是文本在特定载体（URL、源码、邮件）中的合法形态，并非损坏。', '谢谢聆听。此类标本的复原完全确定，不涉及任何统计推断。'],
      },
    },

    snark: {
      headings: { opening: '开场', identify: '验货结论', mechanism: '作案手法', dating: '测年', repair: '抢救记录', conservation: '防再犯指南', easter: '冷知识', closing: '收工' },
      opening: [
        '我是鉴定师{docent}。又一件{relic}送到我桌上了——馆藏编号 `{exhibitId}`。{hook}',
        '{docent}，毒舌鉴定师，专治各种"在我电脑上明明是好的"。今天送检的是{relic}，编号 `{exhibitId}`。{hook}',
        '来，看看这件{relic}（编号 `{exhibitId}`）。我是{docent}。每当有人问我"这是不是中病毒了"，我都会深吸一口气，然后开始讲字节。{hook}',
      ],
      hooks: {
        restored: [
          { t: '说实话，这类货色我一周能见八百回，但既然来了，就给你掰扯清楚。', if: (c) => !c.escapeOnly },
          { t: '先说结论：不是你的错，但也不全是电脑的错。', if: (c) => !c.escapeOnly },
          { t: '别紧张，这病常见，能治。', if: (c) => !c.escapeOnly },
          { t: '先说结论：没坏，只是没拆包装。', if: (c) => c.escapeOnly },
          { t: '这也叫乱码？转义而已，拆开就完事。', if: (c) => c.escapeOnly },
        ],
        partial: ['能修的我修了，修不了的我也懒得假装能修。', '半成品，凑合看吧。'],
        partialClean: ['就那么一小段坏了，其余的字好好的，别慌。', '大部分没毛病，坏的那一小块我给你修了。'],
        irrecoverable: ['先把丑话说在前面：这件我救不了。', '送来得太晚了，病人已经没有心跳。', '这不是乱码，这是乱码的遗骸。'],
        debugMemory: ['先说清楚：这不是乱码，是你的程序在读一块{mem}。', '别找编码的茬了，这是内存的锅。'],
        clean: ['剧透：你白跑一趟了。', '我看了一眼就想退货——不是因为它坏，而是因为它好好的。', '在我开骂之前，先确认一下：你确定这是乱码？'],
        unknown: ['这件有点意思，我也没一眼看穿。', '难得碰上一件我说不准的。', '这玩意儿长得很欠，但我暂时没抓到它的把柄。'],
      },
      subtitle: {
        restored: ['又一个没声明编码的受害者', '{W}：我以为这是我的字节', '{E} 写的，{W} 读的，锅是大家的'],
        partial: ['只修好一部分的烂摊子', '{W} 留下的烂摊子', '能救多少是多少'],
        partialClean: ['就一小段乱码，其余好好的', '{W} 只啃坏了一小口', '局部事故，不必惊慌'],
        irrecoverable: ['节哀：字节已经没了', '修不好，别问了', '一次有损转换的事故现场'],
        debugMemory: ['不是乱码，是没初始化的内存', '你的内存在冒热气', '编码没错，代码错了'],
        clean: ['不是乱码，是你多虑了', '退货：这玩意儿好好的', '白跑一趟纪念品'],
        unknown: ['暂时没抓到凶手', '一件让鉴定师都皱眉的东西', '悬案'],
      },
      identify: {
        restored: [
          { t: '验完了。原文是{output}——一句再普通不过的{lang}。作案经过：{chainPath}。把握 {conf}，剩下那点不确定，留给相信玄学的人。', if: (c) => c.confidence != null && c.confidence >= 0.8 },
          { t: '验完了。原文是{output}——一句再普通不过的{lang}。作案经过：{chainPath}。把握 {conf}，我不打包票。', if: (c) => c.confidence == null || c.confidence < 0.8 },
          '结论：{output}。谁干的？{chainPath}。把握 {conf}。下次再有人说"乱码是电脑坏了"，请把这段甩他脸上。',
          { t: '这件"文物"翻译成人话就是{output}。作案经过：{chainPath}。置信度 {conf}——比大多数项目的单元测试覆盖率都高。', if: (c) => c.confidence != null && c.confidence >= 0.8 },
          { t: '这件"文物"翻译成人话就是{output}。作案经过：{chainPath}。置信度 {conf}，凑合信吧。', if: (c) => c.confidence == null || c.confidence < 0.8 },
        ],
        partial: [
          '能救的部分我救了：{output}。{partNote}。修好的那部分是这么坏的：{chainPath}。',
          '半成品交付：{output}。{partNote}，别跟我讨价还价。链路：{chainPath}。',
          '鉴定结果：只修好一部分——{partNote}。目前能读的版本是{output}，病因：{chainPath}。',
        ],
        partialClean: [
          '就一小段坏了：{fixedNote}，其余的字本来就好好的。全文：{output}。谁干的？{chainPath}。',
          '坏的就那一小块：{fixedNote}，剩下的根本没坏。全文是{output}，病因：{chainPath}。',
          '鉴定完毕：{fixedNote}。其余部分原样保留——它们本来就没事。链路：{chainPath}。',
        ],
        irrecoverable: [
          '没救了。{lossDetail}别指望奇迹。{outputNote}',
          '{lossDetail}这玩意儿修不了，能修的我早修了。{outputNote}',
          '告诉你个坏消息：{lossDetail}还有一个更坏的——没有好消息。{outputNote}',
        ],
        debugMemory: [
          '这不是乱码。{detail}这是一块{mem}，你的程序把它当字符串打出来了。',
          '{detail}别问我原文是什么——根本没有原文，只有一块{mem}。',
          '验完了：{detail}这是一块{mem}，填充值 {fill}，GBK 一读就是{glyph}。改代码去。',
        ],
        clean: [
          '验完了：没毛病。这就是一段正常的{langText}。你是不是复制错了？',
          '恭喜，这不是乱码——是你多虑了。一段健康的{langText}，原样退回。',
          '我翻来覆去试了一遍，它比我的周报还通顺。正常的{langText}，退回。',
        ],
        unknown: [
          '说实话，我也没抓到凶手。{signalNote}常见组合试了一圈，没有一个能让它变通顺。{altNote}',
          '{signalNote}嫌疑人一大堆，证据一个没有。{altNote}',
          '悬案。{signalNote}可能是没收录的编码，可能是加密，也可能是你把二进制文件当文本打开了。{altNote}',
        ],
      },
      lowConfidence: ['当然，也可能是{altOutput}（{altLabel}，{altConf}）——我不打包票，谁打包票谁是骗子。', '有人会说是{altOutput}（{altLabel}，{altConf}）。也行，你自己挑。'],
      sigMention: ['哦对了，里面还混着**{sigTitle}**——老熟人了，待会儿说。', '还有，我看见**{sigTitle}**了。别装没看见。'],
      sigMentionFamily: ['还有，这是**{sigTitle}**那一家子的，老熟人了。', '哦对了，它跟**{sigTitle}**是亲戚，待会儿说。'],
      mechIntro: ['想知道怎么坏的？简单，看字节。', '作案手法很老套，但我还是给你拆开看。', '别眨眼，过程很短。'],
      multiIntro: [
        { t: '而且它还不是坏了一次——是 {k} 次。从最早那次说起：', if: (c) => c.transcodes.length >= 2 },
        { t: '{n} 层。对，同一类错误犯了不止一次。从底下往上数：', if: (c) => c.transcodes.length >= 2 && c.flags.samePair },
        '它不止一层——足足 {n} 层。从最底下那层说起：',
      ],
      wrong: {
        single: ['{W} 只认单字节，{E} 的多字节字符到它手里直接被拆成零件，绝不多想。', '{W} 的脑容量就一个字节：来一个字节，出一个字，管你原来是几个字节一组。', '{W} 根本不知道多字节字符是什么东西，一个字节一个字，硬拆。'],
        double: ['{W} 两个字节一口，{E} 的字符可不是两个字节一组——牙口对不上，那就只能错着咬。', '{W} 见高位字节就拉上下一个字节凑一对，也不问问人家是不是一伙的。', '{W} 按双字节"拉郎配"，{E} 的字符边界它根本不看。'],
        shift: ['{E} 和 {W} 都号称双字节，可分组规则各管各的，{W} 一刀切下去全切歪了。', '同样是双字节，{W} 偏要把有些字节单拎出来，{E} 的分组就这么被拆散了。', '{W} 对"哪个字节单独算一个字"有自己的主意，{E} 的字节只好被它重新分组。'],
        utf8: ['UTF-8 可不惯着你：格式不对直接给 `�`，原字节当场销毁。', 'UTF-8 解码器看到不合规的字节，二话不说换成 `�`——这一步就是不可逆的开始。', 'UTF-8 对非法字节零容忍，`�` 伺候。'],
        same: ['{E} 和 {W} 字节宽度一样，字节一个没动，就是查错了表。', '同一个字节，{E} 说是这个字，{W} 说是那个字，谁也不服谁。', '没拆字，就换了张表——这种错最低级，也最常见。'],
        utf16: ['{W} 两个字节拼一个字，英文直接被拼成"汉字"，主打一个看起来很有文化。', '{W}：两个字母合成一个汉字，谁看了不说一句高深。', '{W} 把每两个字节焊在一起，英文秒变天书。'],
      },
      trace: ['{orig}，{E} 写作 `{hex}`，{W} 读成 {glyphs}。', '{orig}的 {E} 字节 `{hex}`，到 {W} 那儿成了 {glyphs}。', '拿{orig}说事：`{hex}`，{W} 直接给你变成 {glyphs}。'],
      traceUp: ['上一层的{glyph}又被按 {E} 存成 `{hex}`，{W} 再读一遍：{glyphs}。', '然后{glyph}被当成 {E} 存成 `{hex}`，{W} 二次加工：{glyphs}。'],
      crossNote: ['这种跨界乱咬，全文一共 {k} 处。', '数了一下，{k} 个乱码字都是"两个字各出一部分"拼出来的。'],
      mechOutro: [
        '字节全员在场，就是没人问它们是谁家的。',
        { t: '就这？对，就这。互联网上一大半乱码都是这么来的。', if: (c) => c.topPair === 'utf-8>windows-1252' || c.topPair === 'utf-8>iso-8859-1' },
        { t: '就这？对，就这。两套东亚编码互相串门，事故天天有。', if: (c) => /^(gbk|big5|shift_jis|euc-jp|euc-kr)>(gbk|big5|shift_jis|euc-jp|euc-kr)$/.test(c.topPair || '') },
        '看懂了吧：不是电脑坏了，是有人懒得写编码。',
      ],
      mechOutroLossy: ['顺便，这一路上还丢了东西。丢了的，神仙也补不回来，只能猜。', '而且有字节在路上掉了——所以有些字是我推出来的，不是还原的。'],
      mechOutroUnrepaired: ['而且有字节在路上掉了，我也补不回来——结果里那个 `�` 就是它的空位。', '丢了的字节没能补回来，结果里仍留着 `�`，别指望我编一个出来。'],
      memIntro: ['怎么来的？简单：', '这些字的来历，三句话说完：', '别找编码表了，看内存：'],
      mechOutroLost: ['字节早就没了，剩下的都是"遗照"。', '能挖的我都挖了，底下是空的。', '误读可以倒回去，丢掉的字节倒不回去。'],
      mechOutroEscape: ['这不叫乱码，这叫没拆快递。', '东西一点没坏，就是包装拆都没拆就拿来找我。', '转义而已，换个工具一键还原，下次自己拆。'],
      specimenIntro: ['既然你都送来了，顺便看看正常文本长什么样：', '给你看看健康的字节长什么样，下次对照着来：', '免费附赠一份正常标本：'],
      lostIntro: ['死因如下：', '事故经过：', '验伤报告：'],
      unknownMech: ['手上的线索就这些：', '能确定的东西不多：', '目前只有这些蛛丝马迹：'],
      dating: [
        '测年这事不难：{evidence}所以是**{era}**的货。产地？大概率是{site}。别问我怎么知道的，见多了。',
        '{evidence}结论：**{era}**。出土地点我猜是{site}——十有八九。',
        '年代？**{era}**。依据：{evidence}地点？{site}，跑不了。',
      ],
      datingUnknown: ['测年？**{era}**。{evidence}我不编故事。', '{evidence}证据不够，我不瞎猜：**{era}**。'],
      datingClean: ['测什么年，它就是**{eraShort}**的正常文本。{evidence}', '**{era}**。{evidence}没什么好测的。'],
      suspects: ['嫌疑人名单：{culprits}。', '该拉出来挨骂的：{culprits}。'],
      repairIntro: ['缺了几块，我给你补上了：', '抢救记录，看完记得说谢谢：', '有破损。补丁清单如下：'],
      conservationIntro: ['不想再收到这种东西，就照着做：', '防再犯指南，抄十遍：', '以下建议，爱听不听，不听下次还见：'],
      easterIntro: ['顺便科普一句，免得你出去丢人：', '冷知识，爱听不听：', '附送一条，不收费：'],
      closing: {
        restored: [
          '就这样。修好了，拿走，下次记得写 charset。',
          '鉴定完毕。友情提示："在我电脑上是好的"不是编码声明。',
          { t: '收工。这锅我分 {W} 一半，剩下一半给那个没声明编码的人。', if: (c) => c.transcodes.length > 0 && c.status === 'restored' },
          { t: '收工。能修的修好了，剩下的别找我。', if: (c) => c.status === 'partial' },
        ],
        irrecoverable: ['收工。下次记得备份原始文件——我是说真的。', '就这样吧。节哀，然后去把你的字符集配置改了。', '结束。别再问我能不能修，不能。'],
        clean: ['收工。下次请带真乱码来。', '退回，不收鉴定费。真碰上乱码再来找我。', '就这样。你的文本很健康，放心用吧——这句是真心的。'],
        unknown: ['今天先到这。找到原始文件再来找我。', '悬案归档。有新线索再说。', '我认栽一次。下回带点更有用的线索来。'],
        partialClean: ['收工。就那么一小段，修好了，拿走。', '鉴定完毕。下次拼接文本前，先确认每一段的编码。', '就这样。坏的那一小块是 {W} 干的，剩下的没毛病。'],
        debugMemory: ['收工。回去把变量初始化了吧。', '就这样。不是编码的锅，是你代码的锅。', '结束。下次在 Debug 构建里看到这种字，先查内存，别查编码。'],
        escape: ['收工。下次自己拆包装。', '就这样。转义而已，没坏，拿走。', '鉴定完毕：没有乱码，只有没拆的快递。'],
      },
    },
  };

  // Style-neutral fact sentences for the true (source) encoding of a layer.
  const TRUE_DESC = {
    utf8: '{E} 是变长编码：ASCII 占 1 个字节，带音标的拉丁字母{two}占 2 个字节，常用汉字{three}占 3 个字节，emoji 占 4 个字节。',
    double: '{E} 是双字节编码：一个汉字（或假名、韩文音节）占 2 个字节，ASCII 仍是 1 个字节。',
    single: '{E} 是单字节编码，一个字符对应一个字节。',
    utf16: '{E} 中基本平面的字符各占 2 个字节，emoji 之类的增补字符则用 4 个字节的代理对。',
  };
  // Per-encoding wording where the generic "double" sentence would be wrong (half-width kana are
  // one byte in Shift_JIS; EUC-KR is about Hangul, not Hanzi).
  const TRUE_DESC_BY_ID = {
    gbk: '{E} 是双字节编码：一个汉字占 2 个字节，ASCII 仍是 1 个字节。',
    big5: '{E} 是双字节编码：一个汉字占 2 个字节，ASCII 仍是 1 个字节。',
    shift_jis: '{E} 是双字节编码：假名和汉字占 2 个字节，ASCII 与半角片假名只占 1 个字节。',
    'euc-jp': '{E} 是日文的多字节编码：假名和汉字占 2 个字节（两个字节都落在 0xA1–0xFE），ASCII 占 1 个字节；半角片假名要加 `8E` 前缀凑成 2 个字节，补充汉字则占 3 个字节。',
    'euc-kr': '{E} 是双字节编码：一个韩文音节（或汉字）占 2 个字节，ASCII 仍是 1 个字节。',
  };
  // Scripts that the generic UTF-8 sentence would otherwise leave out.
  const UTF8_SCRIPTS = [
    { re: /[Ѐ-ӿ]/, name: '西里尔字母', len: 2 },
    { re: /[Ͱ-Ͽ]/, name: '希腊字母', len: 2 },
    { re: /[֐-׿]/, name: '希伯来字母', len: 2 },
    { re: /[؀-ۿ]/, name: '阿拉伯字母', len: 2 },
    { re: /[぀-ヿ]/, name: '日文假名', len: 3 },
    { re: /[가-힯]/, name: '韩文音节', len: 3 },
    { re: /[฀-๿]/, name: '泰文字母', len: 3 },
  ];

  function trueDesc(c, layer) {
    const E = encName(layer.E);
    if (TRUE_DESC_BY_ID[layer.E]) return fill(TRUE_DESC_BY_ID[layer.E], { E }, c.strict);
    const type = encType(layer.E);
    if (type === 'utf8') {
      const text = layer.after || c.output;
      const two = [];
      const three = [];
      for (const s of UTF8_SCRIPTS) if (s.re.test(text)) (s.len === 2 ? two : three).push(s.name);
      return fill(TRUE_DESC.utf8, { E, two: two.map((x) => '、' + x).join(''), three: three.map((x) => '、' + x).join('') }, c.strict);
    }
    return fill(TRUE_DESC[type] || TRUE_DESC.single, { E }, c.strict);
  }

  /* ======================================================================
   * 6. Reading the AnalysisResult
   * ==================================================================== */

  const STATUSES = ['restored', 'clean', 'irrecoverable', 'partial', 'unknown'];
  const STATUS_TAGS = { restored: '已还原', partial: '部分还原', irrecoverable: '不可逆', clean: '真品', unknown: '待考' };

  // Fallback segmentation for steps that come without segments (defensive only:
  // the engine contract always supplies them).
  function deriveSegments(text, bytes, encId) {
    if (!bytes || typeof text !== 'string') return null;
    const type = encType(encId);
    const segs = [];
    let off = 0;
    for (const ch of cps(text)) {
      const cp = ch.codePointAt(0);
      let len;
      if (type === 'utf8') len = cp === 0xfffd ? 1 : utf8Of(cp).length;
      else if (type === 'utf16') len = cp > 0xffff ? 4 : 2;
      else if (type === 'double') len = cp < 0x80 ? 1 : 2;
      else len = 1;
      segs.push({ ch, start: off, end: off + len });
      off += len;
    }
    return off === bytes.length ? segs : null;
  }

  function prepStep(st) {
    const kind = st.kind === 'unescape' ? 'unescape' : 'transcode';
    const bytes = st.bytes && typeof st.bytes.length === 'number' ? st.bytes : null;
    const before = typeof st.before === 'string' ? st.before : '';
    const after = typeof st.after === 'string' ? st.after : '';
    let segsAfter = Array.isArray(st.segmentsAfter) ? st.segmentsAfter : deriveSegments(after, bytes, st.trueEncoding);
    if (!segsAfter && kind === 'unescape' && !bytes) {
      // No bytes to point at: index-based pseudo segments are enough to quote characters.
      segsAfter = cps(after).map((ch, i) => ({ ch, start: i, end: i + 1, pseudo: true }));
    }
    const segsBefore = Array.isArray(st.segmentsBefore)
      ? st.segmentsBefore
      : kind === 'transcode' ? deriveSegments(before, bytes, st.wrongDecoder) : null;
    const layer = {
      raw: st, kind, bytes, before, after, segsAfter, segsBefore,
      E: st.trueEncoding || null,
      W: kind === 'transcode' ? st.wrongDecoder || null : null,
      scheme: st.scheme || null,
      repairs: Array.isArray(st.repairs) ? st.repairs : [],
      lossy: !!st.lossy,
      partial: !!st.partial,
    };
    layer.identity = identityKeys(layer);
    return layer;
  }

  /* ---------- kept (untouched) characters of a partial layer ---------- */

  // A character that passed through the layer untouched: the engine marks it `kept: true`; until
  // every engine build does, a zero-width segment that is neither a lost marker nor a repair counts
  // too (the wrong decoder could not encode it, so it was left as it was).
  function isKept(layer, s) {
    if (!s) return false;
    if (s.kept === true) return true;
    if (s.error || s.lost || s.repaired || s.end !== s.start) return false;
    return layer.partial || s.ch !== '�';
  }

  // In a partial layer, a character whose bytes decode to itself on both sides (same span, same
  // character — ASCII spaces around a garbled run, or untouched text the tolerant decoder kept
  // byte for byte) was not misread either.
  function identityKeys(layer) {
    if (!layer.partial || !layer.segsBefore || !layer.segsAfter) return null;
    const after = new Set();
    for (const s of layer.segsAfter) if (s && s.end > s.start) after.add(s.start + ':' + s.end + ':' + s.ch);
    const keys = new Set();
    for (const s of layer.segsBefore) {
      const k = s && s.end > s.start ? s.start + ':' + s.end + ':' + s.ch : null;
      if (k && after.has(k)) keys.add(k);
    }
    return keys;
  }
  const isIdentity = (layer, s) => !!(layer.identity && s && s.end > s.start && layer.identity.has(s.start + ':' + s.end + ':' + s.ch));
  const isChanged = (layer, s) => !!s && !isKept(layer, s) && !isIdentity(layer, s);
  const hasKept = (layer) => [layer.segsBefore, layer.segsAfter].some((segs) => Array.isArray(segs) && segs.some((s) => isKept(layer, s)));

  // The garbled runs of a layer that really were misread: [{ before: 'å¤§', after: '大' }].
  function changedRuns(layer) {
    const segsB = layer.segsBefore;
    const segsA = layer.segsAfter;
    if (!segsB || !segsA) return [];
    const runs = [];
    let cur = null;
    segsB.forEach((s) => {
      if (isChanged(layer, s)) {
        if (!cur) { cur = { before: '', start: s.start, end: s.end }; runs.push(cur); }
        cur.before += s.ch;
        if (s.end > cur.end) cur.end = s.end;
        if (s.start < cur.start) cur.start = s.start;
      } else cur = null;
    });
    for (const run of runs) {
      run.after = segsA.filter((s) => isChanged(layer, s) && s.end > s.start && s.start >= run.start && s.end <= run.end)
        .map((s) => s.ch).join('');
    }
    return runs.filter((r) => r.before);
  }

  function langNameOf(r, best) {
    if (best && best.lang && LANG_NAMES[best.lang.lang]) return LANG_NAMES[best.lang.lang];
    if (best && best.lang && best.lang.name) return safe(best.lang.name);
    const sc = r.inputScore;
    if (sc && LANG_NAMES[sc.lang]) return LANG_NAMES[sc.lang];
    try {
      if (MBX.Scorer && typeof MBX.Scorer.detectLang === 'function') {
        const d = MBX.Scorer.detectLang(r.input);
        if (d && d.name) return safe(d.name);
      }
    } catch (_) { /* scorer optional here */ }
    if (/[\u4e00-\u9fff]/.test(r.input)) return '中文';
    if (isAsciiText(r.input)) return '英语';
    return '文本';
  }

  function seedValue(seed) {
    // Math.random()-style fractional seeds must not all collapse to 0.
    if (isNum(seed)) return Number.isInteger(seed) ? seed >>> 0 : fnv1a(String(seed));
    if (typeof seed === 'string' && seed) return fnv1a(seed);
    return 0;
  }

  // Everything the section builders need, computed once.
  function buildContext(result, style, seed, strict) {
    const r = result && typeof result === 'object' ? result : {};
    const input = typeof r.input === 'string' ? r.input : '';
    const best = r.best && typeof r.best === 'object' ? r.best : null;
    let status = STATUSES.indexOf(r.status) >= 0 ? r.status : best ? 'restored' : 'unknown';
    if ((status === 'restored' || status === 'partial') && !best) status = 'unknown';

    const steps = best && Array.isArray(best.steps) ? best.steps.filter(Boolean).map(prepStep) : [];
    const layers = steps.slice().reverse(); // formation order: deepest first
    if (status === 'restored' && !layers.length) status = best && best.output !== input ? 'restored' : 'clean';

    const sigMap = new Map();
    for (const s of Array.isArray(r.signatures) ? r.signatures : []) {
      if (!s || !s.id) continue;
      if (!sigMap.has(s.id)) sigMap.set(s.id, { sig: s, count: 0 });
      sigMap.get(s.id).count++;
    }
    const signatures = Array.from(sigMap.values()).map(({ sig, count }) => {
      const fact = SIGNATURE_FACTS[sig.id] || null;
      let occurrences = Math.max(count, sig.match ? countMatches(input, sig.match) : 0);
      // The engine may report one match spanning a whole run ("锟斤拷锟斤拷锟斤拷"): count the
      // signature itself when it literally appears, or the runs of its glyph.
      if (fact && fact.title && input.indexOf(fact.title) >= 0) occurrences = countMatches(input, fact.title);
      else if (fact && fact.glyph && input.indexOf(fact.glyph + fact.glyph) >= 0) {
        occurrences = (input.match(new RegExp(fact.glyph + '{2,}', 'g')) || []).length;
      }
      return { id: sig.id, sig, fact, count: occurrences || 1, title: safe(fact ? fact.title : sig.title || sig.id) };
    });

    let repairs = best && Array.isArray(best.repairs) ? best.repairs.filter(Boolean) : [];
    if (!repairs.length) for (const st of steps) repairs = repairs.concat(st.repairs);

    const voice = VOICES[style];
    const keyBase = input + '\u241f' + style + '\u241f' + seed;
    const styleInfo = STYLES.find((s) => s.id === style);
    const docentIdx = (fnv1a(input + style) + seed) % styleInfo.docents.length;

    const c = {
      r, input, best, status, steps, layers, signatures, repairs, style, seed, strict, voice,
      styleInfo,
      docent: styleInfo.docents[docentIdx],
      output: best && typeof best.output === 'string' ? best.output : '',
      confidence: best && isNum(best.confidence) ? Math.max(0, Math.min(1, best.confidence)) : null,
      alternatives: Array.isArray(r.alternatives) ? r.alternatives.filter((a) => a && typeof a.output === 'string') : [],
      signals: Array.isArray(r.signals) ? r.signals.filter(Boolean) : [],
      rng: (key) => makeRng(keyBase + '\u241f' + key),
      siteRng: makeRng(input + '\u241f' + seed + '\u241fsite'),
      // The contract: the ID is determined by the input hash alone (never by today's date).
      exhibitId: 'MBX-2026-' + (fnv1a(input) & 0xffff).toString(16).toUpperCase().padStart(4, '0'),
    };
    c.lang = langNameOf(r, best);
    c.langCode = best && best.lang && best.lang.lang ? best.lang.lang : r.inputScore && r.inputScore.lang ? r.inputScore.lang : null;
    c.langText = /文本$/.test(c.lang) ? c.lang : c.lang + (/[A-Za-z0-9]$/.test(c.lang) ? ' 文本' : '文本');
    c.transcodes = layers.filter((l) => l.kind === 'transcode');
    c.escapeOnly = !c.transcodes.length && layers.length > 0;
    c.deepE = layers.length ? layers[0].E : null;
    c.pairs = c.transcodes.map((l) => pairFactsFor(l.E, l.W, l.after));
    c.topPair = c.pairs.length ? c.pairs[c.pairs.length - 1].key : null;
    c.debugMemory = (status === 'irrecoverable' || status === 'unknown') && signatures.length > 0 &&
      signatures.every((s) => s.fact && s.fact.kind === 'debug-memory');
    c.flags = computeFlags(c);
    c.part = computePartial(c);
    c.analogy = computeAnalogy(c);
    c.traces = computeTraces(c);
    c.era = computeEra(c);
    c.site = computeSite(c);
    return c;
  }

  // What a partial result really did: which garbled runs were restored, and whether the rest of
  // the text is simply original text that never was garbled ("clean").
  function computePartial(c) {
    if (c.status !== 'partial' || !c.steps.length) return null;
    const surface = c.steps.find((st) => st.kind === 'transcode') || null;
    const deep = c.layers.find((st) => st.kind === 'transcode') || null;
    if (!surface || !deep) return null;
    const runsB = changedRuns(surface);
    const runsA = changedRuns(deep);
    const frags = runsB.map((r, i) => ({
      before: r.before,
      after: runsA.length === runsB.length ? runsA[i].after : null,
    }));
    if (!frags.length && surface.before && surface.before !== c.input) frags.push({ before: surface.before, after: deep.after });
    const changedOut = runsA.length ? runsA.reduce((n, r) => n + cps(r.after).length, 0) : frags.reduce((n, f) => n + cps(f.after || '').length, 0);
    const total = cps(c.output).length;
    const keptN = Math.max(0, total - changedOut);
    let garbledLeft = false;
    try {
      const S = MBX.Scorer;
      if (S && typeof S.mojibakeSignals === 'function') garbledLeft = (S.mojibakeSignals(c.output) || []).length > 0;
      // the scorer's own verdict on the output: odd script mixes mean garbage is left somewhere
      if (c.best && c.best.score && isNum(c.best.score.badness) && c.best.score.badness > 0) garbledLeft = true;
    } catch (_) { garbledLeft = false; }
    const clean = frags.length > 0 && c.output.indexOf('�') < 0 && !garbledLeft;
    // e.g. 用 has no Windows-1252 byte: the one-liner only works on the garbled run itself.
    const unencodable = surface.segsBefore ? surface.segsBefore.some((s) => isKept(surface, s) && s.end === s.start) : false;
    return { frags, clean, keptN, changedN: changedOut, total, unencodable };
  }

  // "把中文菜谱用法语念出来" only when the two languages really differ.
  function computeAnalogy(c) {
    const top = c.transcodes.length ? c.transcodes[c.transcodes.length - 1] : null;
    if (!top) return null;
    const L1 = LANG_SHORT[c.langCode];
    const f = ENCODING_FACTS[top.W];
    const L2 = f ? REGION_SPEECH[f.region] : null;
    if (!L1 || !L2 || L1.charAt(0) === L2.charAt(0)) return null;
    return { L1, L2 };
  }

  function fragsText(c, n) {
    const frags = c.part ? c.part.frags : [];
    const list = frags.slice(0, n || 2).map((f) => quote(f.before, 16));
    return list.join('、') + (frags.length > (n || 2) ? ' 等 ' + frags.length + ' 段' : '');
  }

  function computeFlags(c) {
    const out = cps(c.output);
    const f = {
      emoji: out.find((ch) => { const cp = ch.codePointAt(0); return cp >= 0x1f000 && cp <= 0x1faff; }) || null,
      astral: out.some((ch) => ch.codePointAt(0) > 0xffff),
      euro: out.indexOf('€') >= 0,
      garbledEuro: c.transcodes.some((l) => l.W === 'windows-1252' && l.before.indexOf('€') >= 0),
      koi8: c.layers.some((l) => l.E === 'koi8-r' || l.W === 'koi8-r'),
      crossStrait: c.transcodes.some((l) => (l.E === 'big5' && l.W === 'gbk') || (l.E === 'gbk' && l.W === 'big5')),
      zip: c.transcodes.some((l) => l.W === 'cp437'),
      multi: c.transcodes.length >= 2,
      samePair: c.transcodes.length >= 2 && c.transcodes.every((l) => l.E === c.transcodes[0].E && l.W === c.transcodes[0].W),
      lossy: c.steps.some((s) => s.lossy) || c.repairs.length > 0,
      schemes: c.layers.filter((l) => l.kind === 'unescape').map((l) => l.scheme).filter(Boolean),
      nFFFD: countOf(c.input, '\uFFFD'),
      nQ: countOf(c.input, '?'),
    };
    return f;
  }

  /* ---------- byte tracing: original char → bytes → garbled pieces ---------- */

  // byte offset → index of the segment covering it; built once per Seg[] so long
  // relics stay linear instead of scanning every segment for every lookup.
  const byteIndexCache = new WeakMap();
  function segIndexCovering(segs, byteIdx) {
    let idx = byteIndexCache.get(segs);
    if (!idx) {
      let max = 0;
      for (const s of segs) if (s && s.end > max) max = s.end;
      idx = new Int32Array(max).fill(-1);
      segs.forEach((s, i) => {
        if (!s || !(s.end > s.start)) return;
        for (let b = s.start; b < s.end; b++) if (idx[b] === -1) idx[b] = i;
      });
      byteIndexCache.set(segs, idx);
    }
    return byteIdx >= 0 && byteIdx < idx.length ? idx[byteIdx] : -1;
  }

  // The only byte sequence a Unicode encoding can produce for a code point (null for the legacy
  // encodings, whose tables the narrator does not second-guess).
  function canonicalBytes(E, cp) {
    if (E === 'utf-8') return utf8Of(cp);
    if (E !== 'utf-16le' && E !== 'utf-16be') return null;
    const units = cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp];
    const out = [];
    for (const u of units) {
      if (E === 'utf-16le') out.push(u & 0xff, u >> 8);
      else out.push(u >> 8, u & 0xff);
    }
    return out;
  }
  const BOM_BYTES = { 'utf-8': [0xef, 0xbb, 0xbf], 'utf-16le': [0xff, 0xfe], 'utf-16be': [0xfe, 0xff] };

  function sameBytes(bytes, start, list) {
    if (start + list.length > bytes.length) return false;
    for (let i = 0; i < list.length; i++) if (bytes[start + i] !== list[i]) return false;
    return true;
  }

  function traceAt(layer, idx) {
    const sa = layer.segsAfter && layer.segsAfter[idx];
    if (!sa || typeof sa.ch !== 'string') return null;
    if (!layer.bytes && layer.kind !== 'unescape') return null;
    if (isKept(layer, sa) || isIdentity(layer, sa)) return null; // untouched text is not a misreading
    const cp = sa.ch.codePointAt(0);
    let start = sa.start;
    const end = sa.end;
    let bomHex = null;
    // Never claim bytes the stated encoding cannot produce for this character: a BOM folded into
    // the first character is split off and named; anything else rules the character out.
    const canon = layer.bytes && !sa.repaired && !sa.pseudo ? canonicalBytes(layer.E, cp) : null;
    if (canon) {
      const len = end - start;
      if (!(len === canon.length && sameBytes(layer.bytes, start, canon))) {
        const bom = BOM_BYTES[layer.E];
        if (bom && len === bom.length + canon.length && sameBytes(layer.bytes, start, bom) && sameBytes(layer.bytes, start + bom.length, canon)) {
          bomHex = hex(layer.bytes, start, start + bom.length);
          start += bom.length;
        } else return null;
      }
    }
    const t = {
      idx, ch: sa.ch, cp, start, end,
      hex: hex(layer.bytes, start, end),
      repaired: !!sa.repaired,
      pieces: [],
      bomHex,
      bomPieces: [],
    };
    if (t.repaired && layer.E === 'utf-8') t.fullHex = utf8Of(cp).map(hex2).join(' ');
    if (layer.kind === 'transcode' && layer.segsBefore) {
      layer.segsBefore.forEach((b, j) => {
        if (!b || !(b.end > b.start) || b.start >= end || b.end <= sa.start || isKept(layer, b)) return;
        if (bomHex && b.end <= start) { t.bomPieces.push({ j, ch: b.ch, hex: hex(layer.bytes, b.start, b.end) }); return; }
        const p = { j, ch: b.ch, hex: hex(layer.bytes, b.start, b.end), error: !!b.error || b.ch === '\uFFFD', cross: null };
        if (b.start < start) {
          const k = segIndexCovering(layer.segsAfter, b.start);
          p.cross = 'prev';
          p.borrowHex = hex(layer.bytes, b.start, start);
          p.neighbor = k >= 0 ? layer.segsAfter[k].ch : null;
        } else if (b.end > end) {
          const k = segIndexCovering(layer.segsAfter, end);
          p.cross = 'next';
          p.borrowHex = hex(layer.bytes, end, b.end);
          p.neighbor = k >= 0 ? layer.segsAfter[k].ch : null;
        }
        t.pieces.push(p);
      });
    }
    // "\u00EF\u00BB\u00BFH": the only story is the BOM; the ASCII letter after it reads the same either way.
    t.bomOnly = !!bomHex && cp < 0x80 && t.pieces.length === 1 && t.pieces[0].ch === t.ch;
    return t;
  }

  // Picks the representative characters of each layer: the first notable original
  // character always (so the narration matches what the visitor sees first), plus
  // up to two "interesting" others (different byte length, emoji…). Upper layers
  // follow the first garbled piece upward so the strata tell one continuous story.
  function computeTraces(c) {
    const res = [];
    const want = c.style === 'academic' ? 3 : c.style === 'humor' ? 2 : 1;
    const rng = c.rng('samples');
    let follow = null;
    c.layers.forEach((layer, li) => {
      const segs = layer.segsAfter;
      const entry = { layer, li, traces: [] };
      res.push(entry);
      if (!segs || (!layer.bytes && layer.kind !== 'unescape')) { follow = null; return; }
      const traceable = (s) => s && typeof s.ch === 'string' && s.end > s.start && !isKept(layer, s) && !isIdentity(layer, s);
      if (li > 0 && follow != null) {
        let idx = follow.j;
        if (!traceable(segs[idx]) || segs[idx].ch !== follow.ch) idx = segs.findIndex((s) => traceable(s) && s.ch === follow.ch);
        const t = idx >= 0 ? traceAt(layer, idx) : null;
        if (t) entry.traces.push(t);
      }
      if (!entry.traces.length) {
        const seen = new Set();
        const cand = [];
        segs.forEach((s, i) => {
          if (!traceable(s) || s.error) return;
          if (s.ch.codePointAt(0) < 0x80 || seen.has(s.ch)) return;
          seen.add(s.ch);
          cand.push(i);
        });
        // prefer intact characters; fall back to repaired ones only if nothing else
        let pool = cand.filter((i) => !segs[i].repaired);
        if (!pool.length) pool = cand;
        // the first character whose bytes check out leads; the others are scored for variety
        let firstT = null;
        let at = 0;
        while (!firstT && at < pool.length) firstT = traceAt(layer, pool[at++]);
        if (firstT) {
          const first = firstT.idx;
          const firstLen = segs[first].end - segs[first].start;
          const rest = pool.slice(at).map((i) => {
            const s = segs[i];
            const len = s.end - s.start;
            const score = (len !== firstLen ? 2 : 0) + (s.ch.codePointAt(0) >= 0x10000 ? 3 : 0) + rng.next() * 1.5;
            return { i, score };
          }).sort((a, b) => b.score - a.score);
          const n = li === 0 ? want : 1;
          const picked = [firstT];
          for (const x of rest) {
            if (picked.length >= n) break;
            const t = traceAt(layer, x.i);
            if (t) picked.push(t);
          }
          picked.sort((a, b) => a.idx - b.idx).forEach((t) => entry.traces.push(t));
        } else if (layer.kind === 'transcode' && layer.segsBefore) {
          // ASCII-only originals (e.g. "Bush hid the facts"): start from the garbled side.
          const j = layer.segsBefore.findIndex((b) => b && b.end > b.start && b.ch && b.ch.codePointAt(0) >= 0x80 && !isKept(layer, b) && !isIdentity(layer, b));
          if (j >= 0) {
            const k = segIndexCovering(segs, layer.segsBefore[j].start);
            const t = k >= 0 ? traceAt(layer, k) : null;
            if (t) entry.traces.push(t);
          }
        }
      }
      const lead = entry.traces[0];
      const piece = lead && lead.pieces.find((p) => !p.error);
      follow = piece ? { j: piece.j, ch: piece.ch } : null;
    });
    return res;
  }

  /* ---------- dating ("字节测年法") ---------- */

  const eraSpan = (start, end) => (end == null ? start + ' 年至今' : start + '–' + end + ' 年');

  function eraLabel(start, end) {
    if (start == null) return '年代不详';
    if (end == null) return '约 ' + start + ' 年至今';
    if (end <= start) return '约 ' + start + ' 年前后';
    return '约 ' + start + '–' + end + ' 年';
  }

  function computeEra(c) {
    const ev = [];
    if (c.status === 'clean') {
      ev.push(isAsciiText(c.input)
        ? 'ASCII（1963）至今通用，单凭字节无法断代。'
        : '它的字节在今天主流的 UTF-8 环境下一切正常，没有任何"地层"可供测年。');
      return { start: null, end: null, label: '当代（无需测年）', evidence: ev };
    }

    let start = null;
    let end = null;
    let open = false;
    let override = null;
    const bound = (era) => {
      if (!era) return;
      start = start == null ? era[0] : Math.max(start, era[0]);
      if (era[1] == null) open = true;
      else end = end == null ? era[1] : Math.max(end, era[1]);
    };

    const seenPairs = new Set();
    c.pairs.forEach((p, i) => {
      if (seenPairs.has(p.key)) return;
      seenPairs.add(p.key);
      const f = p.facts;
      bound(f.era);
      const l = c.transcodes[i];
      const tag = encName(l.E) + '→' + encName(l.W);
      if (f.era) ev.push(tag + ' 型乱码的高发期大约在 ' + eraSpan(f.era[0], f.era[1]) + '。' + f.eraWhy + '。');
      else ev.push(f.eraWhy + '。');
    });

    const seenWhy = new Set(c.pairs.map((p) => p.facts.eraWhy));
    for (const s of c.signatures) {
      const f = s.fact;
      if (!f) continue;
      if (f.era) bound(f.era);
      if (f.eraLabel && !c.pairs.length) override = f.eraLabel;
      if (seenWhy.has(f.eraWhy)) continue; // UTF-16 BOM and NUL signatures share one story
      seenWhy.add(f.eraWhy);
      ev.push('就名器「' + f.title + '」而言，' + f.eraWhy + '。');
    }
    if (c.escapeOnly && c.deepE && ENCODING_FACTS[c.deepE] && SCHEMES[c.layers[0].scheme] && SCHEMES[c.layers[0].scheme].byte) {
      const e = ENCODING_FACTS[c.deepE];
      bound([e.born, null]);
      ev.push('转义里包着的是 ' + e.name + ' 字节，而 ' + e.name + ' 诞生于' + (/^\d/.test(e.bornLabel) ? ' ' : '') + e.bornLabel + '，所以它不会早于这个年代。');
    }

    const floor = (year, text) => {
      ev.push(text);
      if (start == null || start < year) start = year;
    };
    if (c.flags.emoji) {
      floor(2010, '原文里出现了 emoji' + showChar(c.flags.emoji) + '——Unicode 6.0（2010）才大批收录 emoji，所以它不会早于 2010 年。');
      if (c.transcodes.some((l) => l.E === 'utf-8' && (l.W === 'windows-1252' || l.W === 'iso-8859-1'))) {
        ev.push('而且 emoji 是 4 字节 UTF-8，MySQL 直到 5.5.3（2010）才有能存它的 utf8mb4。');
      }
    }
    if (c.flags.euro) floor(1998, '原文含有欧元符号 €，它在 1998 年前后才进入 Unicode 与 Windows-1252（0x80），因此年代不早于 1998 年。');
    if (c.flags.garbledEuro) floor(1998, '乱码里出现了 `€`——说明误读它的是 1998 年之后、已在 0x80 放进欧元符号的 Windows-1252。');
    const curated = (pred) => c.pairs.some((p, i) => !p.generic && pred(c.transcodes[i]));
    if (c.flags.koi8 && !curated((l) => l.E === 'koi8-r' || l.W === 'koi8-r')) {
      ev.push('KOI8-R 是上世纪 90 年代俄语 Unix、Usenet 与电子邮件的通用编码（RFC 1489，1993）。');
    }
    if (c.flags.crossStrait && !curated((l) => /^(big5|gbk)$/.test(l.E) && /^(big5|gbk)$/.test(l.W))) {
      ev.push('简繁两种编码互相误读，是 1990–2000 年代两岸 BBS 与电子邮件往来时的常见事故。');
    }
    if (c.flags.zip) {
      const zipLayer = c.transcodes.find((l) => l.W === 'cp437');
      const box = cps(zipLayer.before).find((ch) => /[\u2500-\u259f]/.test(ch));
      ev.push(box
        ? '文字里冒出了 DOS 制表符' + showGlyph(box) + '——CP437 的这类字形出现在文件名里，几乎就是 ZIP 压缩包的指纹。'
        : 'CP437 出现在误读链路里，几乎就是 ZIP 文件名的指纹。');
    }
    for (const sch of c.flags.schemes) {
      if (sch === 'percent') ev.push('外层的百分号编码说明它曾在网址或表单参数里旅行——2005 年的 RFC 3986 建议非 ASCII 字符先转 UTF-8 再做百分号编码。');
      else if (sch === 'quoted-printable') ev.push('Quoted-Printable 是 MIME 电子邮件（1992 年起）的传输编码，说明它曾在邮件里旅行。');
      else if (sch === 'html-entity') ev.push('它被包在 HTML 字符实体里，说明曾栖身于网页源码。');
      else if (sch === 'unicode-escape') ev.push('`\\u` 转义说明它曾躺在 JSON、JavaScript 或 Java 源码里。');
      else if (sch === 'hex-escape') ev.push('`\\x` 转义多见于程序日志、调试输出和 Python/C 源码，说明它曾以字节串的形式被原样打印出来。');
      else if (sch === 'hex-dump') ev.push('十六进制转储是调试与取证时查看原始字节的常用形式，说明有人曾直接盯着它的字节看。');
    }
    if (c.flags.multi && start != null) {
      const extra = 2 * (c.transcodes.length - 1);
      ev.push('它被误读了 ' + c.transcodes.length + ' 次，说明至少经历了 ' + c.transcodes.length + ' 次迁移或转存（比如导出、导入、再导出），起始年份相应推后约 ' + extra + ' 年。');
      start += extra;
    }
    if (!open && end != null && start != null && end < start) end = start + 2; // conflicting evidence: trust the floors
    if (open) end = null;
    if (start == null && !ev.length) {
      ev.push(c.layers.length ? '这条链路本身不带年代信息，字节测年无从下手。' : '没有找到可信的编码链路，字节测年无从下手。');
    }
    const label = override || eraLabel(start, end);
    return { start, end, label, evidence: ev };
  }

  function computeSite(c) {
    const rng = c.siteRng;
    if (c.status === 'clean') return '无需发掘——它一直好好地待在地表';
    let site = null;
    if (c.pairs.length) {
      const deep = c.pairs[0];
      site = rng.pick(deep.facts.sites);
      const top = c.pairs[c.pairs.length - 1];
      if (c.pairs.length > 1) {
        site += top.key === deep.key
          ? '，并在之后的一次数据迁移或导入导出中被再次误读'
          : '，后又辗转流入' + rng.pick(top.facts.sites);
      }
    } else if (c.signatures.length && c.signatures[0].fact) {
      site = c.signatures[0].fact.site;
    }
    const outer = c.layers.length ? c.layers[c.layers.length - 1] : null;
    if (outer && outer.kind === 'unescape' && SCHEMES[outer.scheme]) {
      site = site ? site + '，最后被封装进' + SCHEMES[outer.scheme].habitat : SCHEMES[outer.scheme].habitat;
    }
    if (!site) site = c.status === 'unknown' ? '出土地点不明' : '某次没有留下记录的有损转换现场';
    return safe(site);
  }

  /* ======================================================================
   * 7. Section builders
   * ==================================================================== */

  function T(c, list, vars, rngKey) {
    const rng = typeof rngKey === 'object' ? rngKey : c.rng(rngKey || 'misc');
    return fill(rng.pick(usable(list, c)), vars, c.strict);
  }

  // Which template group fits: debug-memory relics and partial results whose untouched text was
  // never garbled get their own wording instead of the generic status lists.
  function voiceGroup(c, lists) {
    const g = c.debugMemory ? 'debugMemory'
      : c.status === 'partial' && c.part && c.part.clean ? 'partialClean'
        : c.status === 'restored' && c.escapeOnly ? 'escape'
          : c.status;
    return lists && lists[g] ? g : c.status;
  }

  function memVars(c) {
    const sigs = c.signatures.filter((s) => s.fact && s.fact.kind === 'debug-memory');
    const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
    return {
      mem: uniq(sigs.map((s) => s.fact.memory)).join('和') || '未初始化的内存',
      fill: uniq(sigs.map((s) => '`' + s.fact.fillByte + '`')).join('、'),
      glyph: uniq(sigs.map((s) => '「' + s.fact.glyph + '」')).join(''),
      detail: sigs.length ? '文物上共检出' + sigs.map((s) => '名器「' + s.title + '」' + s.count + ' 处').join('、') + '。' : '',
    };
  }

  function confText(c) {
    return c.confidence == null ? '（尚未评估）' : '**' + Math.round(c.confidence * 100) + '%**';
  }

  function chainPath(c) {
    if (!c.layers.length) return '链路不明';
    return c.layers.map((l, i) => {
      if (l.kind === 'unescape') {
        const sch = SCHEMES[l.scheme] ? SCHEMES[l.scheme].name : '某种转义';
        const sp = /^[A-Za-z0-9\\]/.test(sch) ? ' ' : '';
        if (i === 0) return (SCHEMES[l.scheme] && !SCHEMES[l.scheme].byte ? '文字' : '`' + encName(l.E) + '` 字节') + '被写成了' + sp + sch;
        return '最后又被写成了' + sp + sch;
      }
      if (i === 0) return '原本以 `' + encName(l.E) + '` 编码的文字被 `' + encName(l.W) + '` 误读';
      return '又按 `' + encName(l.E) + '` 编码后被 `' + encName(l.W) + '` 误读';
    }).join('，');
  }

  // The deepest layer's encoding name. Code-point escapes (\u, &#…;) wrap characters rather than
  // bytes, so the engine leaves trueEncoding null for them; "Unicode" is the honest name there.
  function originName(c, fallbackId) {
    const id = c.deepE || fallbackId;
    if (id) return encName(id);
    const deep = c.layers[0];
    const scheme = deep && deep.kind === 'unescape' ? SCHEMES[deep.scheme] : null;
    return scheme && !scheme.byte ? 'Unicode' : encName(null);
  }

  function buildTitle(c) {
    if (c.status === 'clean') return '『现代真品 · ' + c.lang + '』';
    if (c.status === 'unknown') return '『未定名文物 · 来历待考』';
    if (c.debugMemory) return '『' + c.signatures[0].title + ' · 名器 · 调试内存』';
    if (!c.layers.length) {
      return c.signatures.length ? '『' + c.signatures[0].title + ' · 名器 · 不可逆』' : '『无名残片 · 不可逆』';
    }
    const parts = [originName(c)];
    const kinds = [];
    for (const l of c.transcodes) {
      const f = ENCODING_FACTS[l.W];
      const k = f ? f.misread : encName(l.W);
      if (kinds.indexOf(k) < 0) kinds.push(k);
    }
    const joined = kinds.join('/');
    if (kinds.length) parts.push(joined + (/[A-Za-z0-9]$/.test(joined) ? ' ' : '') + '误读型');
    const sch = c.layers.filter((l) => l.kind === 'unescape').map((l) => (SCHEMES[l.scheme] ? SCHEMES[l.scheme].short : '转义封装'));
    if (sch.length) parts.push(sch.join('/') + (kinds.length ? '' : '型'));
    if (c.status === 'irrecoverable') parts.push('不可逆');
    else parts.push(layerWord(c.layers.length) + '地层' + (c.status === 'partial' ? (c.part && c.part.clean ? ' · 局部误读' : ' · 残件') : ''));
    return '『' + parts.join(' · ') + '』';
  }

  // Escape-only relics were wrapped, not mis-read, so they get their own subtitles.
  const ESCAPE_SUBTITLES = {
    humor: ['一段穿着{S}外衣的 {E} 文字', '{E} 文字的{S}伪装术', '拆开{S}，里面是好好的 {E}'],
    academic: ['经{S}封装的 {E} 文本标本', '一例{S}层包覆的 {E} 遗存', '{S}型可逆封装标本'],
    snark: ['没拆包装的 {E} 文字', '{S}而已，别大惊小怪', '包得严严实实的 {E}'],
  };

  function buildSubtitle(c) {
    const top = c.transcodes.length ? c.transcodes[c.transcodes.length - 1] : null;
    const outer = c.layers.length ? c.layers[c.layers.length - 1] : null;
    const vars = {
      E: originName(c, top && top.E),
      W: top ? encName(top.W) : encName(c.layers.length ? c.layers[0].E : null),
      S: outer && SCHEMES[outer.scheme] ? SCHEMES[outer.scheme].name : '转义',
    };
    if (/^[A-Za-z\\]/.test(vars.S)) vars.S = ' ' + vars.S; // space a Latin-initial name off from the Chinese before it
    Object.assign(vars, memVars(c), { progress: progressText(c) });
    const group = voiceGroup(c, c.voice.subtitle);
    const list = c.status === 'restored' && !top && outer ? ESCAPE_SUBTITLES[c.style] : c.voice.subtitle[group];
    let s = stripMarkup(T(c, list, vars, 'subtitle')).replace(/\s+/g, ' ').trim();
    if (c.signatures.length && c.status !== 'restored') s = '名器「' + c.signatures[0].title + '」 · ' + s;
    return s;
  }

  // "修复进度" from the share of the text that really was misread and restored.
  function progressText(c) {
    if (!c.part || !c.part.total) return '部分完成';
    const pct = Math.round((c.part.changedN / c.part.total) * 100);
    return pct > 0 ? '约 ' + pct + '% 的文字经过还原' : '部分完成';
  }

  function buildOpening(c) {
    const rng = c.rng('opening');
    const hook = fill(rng.pick(usable(c.voice.hooks[voiceGroup(c, c.voice.hooks)], c)), memVars(c), c.strict);
    return fill(rng.pick(c.voice.opening), {
      docent: c.docent, exhibitId: c.exhibitId, relic: quote(c.input, 24), relicLen: cps(c.input).length, hook,
    }, c.strict);
  }

  function fixedNote(c) {
    if (c.part && c.part.frags.length) {
      const frags = c.part.frags.slice(0, 2).map((f) => quote(f.before, 16) + (f.after ? '被还原成了' + quote(f.after, 16) : '得到了还原'));
      return '乱码片段' + frags.join('、') + (c.part.frags.length > 2 ? '，另有 ' + (c.part.frags.length - 2) + ' 段同样处理' : '');
    }
    const surface = c.layers.length ? c.layers[c.layers.length - 1] : null;
    const deep = c.layers.length ? c.layers[0] : null;
    if (surface && deep && surface.before && surface.before !== c.input) {
      return quote(surface.before, 16) + '被还原成了' + quote(deep.after, 16);
    }
    return null;
  }

  function partNote(c) {
    const fixed = fixedNote(c);
    return fixed ? '其中' + fixed + '，其余部分保持原样' : '只有部分片段找到了可信的还原链路，其余部分保持原样';
  }

  // "第 5 个字" / "第 5、9 个字" for the characters a repair had to guess.
  function repairedPositions(c) {
    const pos = [];
    for (const rep of c.repairs) if (isNum(rep.index) && rep.index >= 0 && pos.indexOf(rep.index + 1) < 0) pos.push(rep.index + 1);
    pos.sort((a, b) => a - b);
    if (!pos.length) return c.repairs.length + ' 处字符';
    return '第 ' + pos.slice(0, 4).join('、') + (pos.length > 4 ? ' 等' : '') + ' 个字';
  }

  function lossDetail(c) {
    const bits = [];
    if (c.flags.nFFFD) bits.push(c.flags.nFFFD + ' 个替换字符 `�`');
    if (c.flags.nQ >= 3) bits.push(c.flags.nQ + ' 个问号 `?`');
    for (const s of c.signatures) {
      if (s.id === 'replacement' || s.id === 'question-marks') continue;
      bits.push('名器「' + s.title + '」' + s.count + ' 处');
    }
    let reason = '';
    const withNote = c.signatures.find((s) => s.fact && s.fact.lossNote);
    if (withNote) reason = withNote.fact.lossNote;
    else if (c.flags.nFFFD) reason = '替换字符出现的那一刻，原字节就被丢弃了。';
    else if (c.flags.nQ >= 3) reason = '问号是编码器在"装不下"时顶替原字符留下的。';
    else reason = '关键字节在某次有损转换中丢失了。';
    const lead = bits.length && /^\d/.test(bits[0]) ? ' ' : '';
    return (bits.length ? '文物上共检出' + lead + bits.join('、') + '。' : '') + reason;
  }

  // Signals grouped by clue: each distinct hint once, with up to `max` distinct matches.
  function groupedSignals(c, max) {
    const groups = [];
    const byHint = new Map();
    for (const s of c.signals) {
      const hint = safe(s.hint || s.type || '');
      if (!hint) continue;
      let g = byHint.get(hint);
      if (!g) { g = { hint, matches: [] }; byHint.set(hint, g); groups.push(g); }
      const m = s.match == null ? '' : String(s.match);
      if (m && g.matches.indexOf(m) < 0 && g.matches.length < (max || 3)) g.matches.push(m);
    }
    return groups;
  }

  function signalNote(c) {
    const items = groupedSignals(c, 2).slice(0, 2).map((g) => g.hint + (g.matches.length ? '（如 ' + g.matches.map(showGlyphRun).join('、') + '）' : ''));
    return items.length ? '检出的可疑特征：' + items.join('；') + '。' : '它没有表现出典型的乱码特征。';
  }

  // A matched fragment as inline code; invisible characters (C1 controls, NUL…) are spelled out
  // as code points instead of being shown as an anonymous ▫.
  function showGlyphRun(s) {
    const t = clip(s, 8);
    const chars = cps(t);
    const invisible = (ch) => ch !== ' ' && !!invisibleKind(ch.codePointAt(0));
    if (chars.length && chars.every(invisible)) return chars.map((ch) => '`' + uplus(ch.codePointAt(0)) + '`').join(' ');
    if (/[`*]/.test(t) || chars.some(invisible)) {
      const inv = chars.filter(invisible).map((ch) => '`' + uplus(ch.codePointAt(0)) + '`');
      return quote(t, 8) + '（含 ' + inv.filter((x, i) => inv.indexOf(x) === i).slice(0, 2).join('、') + '）';
    }
    return '`' + t + '`';
  }

  function altVars(c) {
    const a = c.alternatives[0];
    if (!a) return null;
    return {
      altOutput: quote(a.output, 20),
      altLabel: safe(a.label || '另一条链路'),
      altConf: isNum(a.confidence) ? '置信度 ' + Math.round(a.confidence * 100) + '%' : '置信度未评估',
    };
  }

  function buildIdentify(c) {
    const v = c.voice;
    const rng = c.rng('identify');
    const av = altVars(c);
    const vars = Object.assign(memVars(c), {
      lang: c.lang,
      langText: c.langText,
      output: quote(c.output, 40),
      chainPath: chainPath(c),
      conf: confText(c),
      depth: c.layers.length,
      partNote: partNote(c),
      fixedNote: fixedNote(c) || '我们抢救出了其中一部分片段',
      frags: fragsText(c, 2) || '乱码片段',
      keptN: c.part ? c.part.keptN : 0,
      lossDetail: lossDetail(c),
      outputNote: c.output && c.output !== c.input && !/^[�\s]*$/.test(c.output) ? '目前能勉强读出的是' + quote(c.output, 30) + '。' : '',
      signalNote: signalNote(c),
      altNote: av ? '最接近的猜测是' + av.altOutput + '（' + av.altLabel + '），但' + av.altConf + '。' : '',
    });
    const parts = [fill(rng.pick(usable(v.identify[voiceGroup(c, v.identify)], c)), vars, c.strict)];
    // Inferred characters are never presented as plain restoration.
    if ((c.status === 'restored' || c.status === 'partial') && c.repairs.length) {
      parts.push('其中' + repairedPositions(c) + '是根据残存字节推断补全的，并非原样还原。');
    }
    if ((c.status === 'restored' || c.status === 'partial') && av && c.confidence != null && c.confidence < 0.6 && altWorthMentioning(c)) {
      parts.push(fill(rng.pick(v.lowConfidence), av, c.strict));
    }
    if (c.signatures.length && c.status !== 'irrecoverable' && !c.debugMemory) {
      const family = c.signatures.every((s) => s.fact && s.fact.family);
      const sigTitle = family ? c.signatures.map((s) => '「' + s.title + '」').join('、') : c.signatures.map((s) => s.title).join('、');
      parts.push(fill(rng.pick(usable(family ? v.sigMentionFamily : v.sigMention, c)), { sigTitle }, c.strict));
    }
    return parts.join('');
  }

  // A competing reading is worth a sentence only when it is not hopeless next to the winner.
  function altWorthMentioning(c) {
    const a = c.alternatives[0];
    if (!a || !isNum(a.confidence)) return false;
    return a.confidence >= 0.15 || (c.confidence != null && a.confidence * 3 >= c.confidence);
  }

  /* ---------- mechanism ---------- */

  function glyphList(t) {
    return t.pieces.map((p) => showGlyph(p.ch)).join(' ');
  }

  function pieceMap(t) {
    return t.pieces.map((p) => {
      let s = '`' + p.hex + '`→' + showGlyph(p.ch);
      if (p.cross === 'next') s += '（`' + p.borrowHex + '` 借自下一个字' + (p.neighbor ? showChar(p.neighbor) : '') + '）';
      else if (p.cross === 'prev') s += '（`' + p.borrowHex + '` 来自上一个字' + (p.neighbor ? showChar(p.neighbor) : '') + '）';
      else if (p.error) s += '（凑不成合法字符）';
      return s;
    }).join('、');
  }

  function actionFor(c, layer, t) {
    const type = encKnown(layer.W) ? encType(layer.W) : 'unknown';
    const crossing = t.pieces.some((p) => p.cross);
    if (!t.pieces.length) return '读成了别的样子';
    if (type === 'unknown') return c.style === 'academic' ? pieceMap(t) : '读成了 ' + pieceMap(t);
    if (type === 'single' && !crossing) {
      return c.style === 'academic' ? pieceMap(t) : '逐字节读成了 ' + glyphList(t);
    }
    if (type === 'utf16') return c.style === 'academic' ? pieceMap(t) : '两个字节一组拼成了 ' + pieceMap(t);
    if (type === 'utf8') return c.style === 'academic' ? pieceMap(t) : '解出了 ' + pieceMap(t);
    return c.style === 'academic' ? pieceMap(t) : '分组读成了 ' + pieceMap(t);
  }

  function traceSentence(c, layer, t, li, rng, first) {
    const v = c.voice;
    const hexTxt = t.hex + (t.repaired && t.fullHex && t.fullHex !== t.hex ? '（完整应为 ' + t.fullHex + '，缺失的字节由修复推断）' : '');
    const vars = {
      orig: showChar(t.ch), cp: uplus(t.cp), hex: hexTxt, E: encName(layer.E), W: encName(layer.W),
      origCp: invisibleKind(t.cp) ? showChar(t.ch) : showChar(t.ch) + '（`' + uplus(t.cp) + '`）',
      action: actionFor(c, layer, t), mapping: pieceMap(t),
      glyphs: encKnown(layer.W) && encType(layer.W) === 'single' && !t.pieces.some((p) => p.cross) ? glyphList(t) : pieceMap(t),
      glyph: showGlyph(t.ch),
    };
    const bom = t.bomHex
      ? '开头的 `' + t.bomHex + '` 是 ' + encName(layer.E) + ' 的 BOM（字节顺序标记 `U+FEFF`），不是任何文字' +
        (t.bomPieces.length && layer.W ? '，' + encName(layer.W) + ' 却把它读成了 ' + t.bomPieces.map((p) => showGlyph(p.ch)).join(' ') : '') + '。'
      : '';
    if (t.bomOnly) return bom + '后面的 ASCII 字母在两种编码里字节相同，原样保留。';
    let s = bom + fill(rng.pick(li === 0 ? v.trace : v.traceUp), vars, c.strict);
    // Bit-level anatomy for the academic voice (and occasionally the humorous one).
    if (first && li === 0 && layer.E === 'utf-8' && !t.repaired && (c.style === 'academic' || (c.style === 'humor' && rng.chance(0.35)))) {
      const lay = utf8Layout(t.cp);
      if (lay && utf8Of(t.cp).map(hex2).join(' ') === t.hex) {
        s += c.style === 'academic'
          ? '按 UTF-8 规则，码位 `' + uplus(t.cp) + '` 的二进制 `' + lay.binary + '` 按 ' + lay.split + ' 位切开，填入模板 `' + lay.template + '`，即得 `' + lay.filled + '`，也就是 `' + t.hex + '`。'
          : '（技术宅专享：`' + uplus(t.cp) + '` 的二进制按 ' + lay.split + ' 位切开，塞进 `' + lay.template + '`，正好得到 `' + t.hex + '`。）';
      }
    }
    return s;
  }

  function escapedForm(layer, t) {
    const b = layer.bytes;
    const sch = layer.scheme;
    let form = null;
    if (b && SCHEMES[sch] && SCHEMES[sch].byte) {
      const hs = [];
      for (let i = t.start; i < t.end; i++) hs.push(hex2(b[i]));
      if (sch === 'percent') form = hs.map((h) => '%' + h).join('');
      else if (sch === 'hex-escape') form = hs.map((h) => '\\x' + h).join('');
      else if (sch === 'quoted-printable') form = hs.map((h) => '=' + h).join('');
      else form = hs.join(' ');
    } else if (sch === 'unicode-escape') {
      const units = [];
      for (let i = 0; i < t.ch.length; i++) units.push('\\u' + t.ch.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0'));
      form = units.join('');
    } else if (sch === 'html-entity') {
      const dec = '&#' + t.cp + ';';
      const hx = '&#x' + t.cp.toString(16).toUpperCase() + ';';
      const lower = layer.before.toLowerCase();
      form = lower.indexOf(hx.toLowerCase()) >= 0 ? hx : lower.indexOf(dec) >= 0 ? dec : null;
    }
    if (form && layer.before) {
      // Echo the case actually used in the relic (e.g. %e5 vs %E5).
      const at = layer.before.toLowerCase().indexOf(form.toLowerCase());
      if (at >= 0) form = layer.before.slice(at, at + form.length);
    }
    return form && !/[`*]/.test(form) ? form : null;
  }

  const SCHEME_DESC = {
    percent: '这一层是**百分号编码**（URL 编码）：每个字节写成 `%` 加两位十六进制。',
    'hex-escape': '这一层是 `\\x` **十六进制转义**（C、Python 字符串和日志里很常见）：每个字节写成 `\\x` 加两位十六进制。',
    'quoted-printable': '这一层是 **Quoted-Printable** 编码（MIME 电子邮件的传输编码）：非 ASCII 字节写成 `=` 加两位十六进制。',
    'hex-dump': '这一层是一份**十六进制转储**：字节被直接写成两位十六进制数。',
    'unicode-escape': '这一层是 `\\u` **Unicode 转义**（JSON、JavaScript、Java 源码的写法）：`\\u` 后面的四位十六进制就是一个 UTF-16 码元。',
    'html-entity': '这一层是 **HTML 字符实体**：`&#十进制;` 或 `&#x十六进制;` 直接写出码位，`&amp;` 之类则是具名实体。',
  };

  function unescapeParagraph(c, layer, entry) {
    const out = [SCHEME_DESC[layer.scheme] || '这一层是某种转义封装，剥开后才露出真正的文字。'];
    const isByte = SCHEMES[layer.scheme] && SCHEMES[layer.scheme].byte;
    for (const t of entry.traces.slice(0, 2)) {
      const form = escapedForm(layer, t);
      const who = entry.li === 0 ? showChar(t.ch) : showGlyph(t.ch);
      if (isByte && t.hex) {
        out.push(who + '的 ' + encName(layer.E) + ' 字节是 `' + t.hex + '`' + (form ? '，写出来就是 `' + form + '`' : '') + '。');
      } else if (form) {
        out.push(who + (invisibleKind(t.cp) ? '' : '（`' + uplus(t.cp) + '`）') + '写作 `' + form + '`。');
      }
    }
    if (isByte && layer.E === 'gbk') out.push('注意，这些字节要按 GBK 解读——早年不少中文网站的 URL 参数用的就是 GBK。');
    if (layer.scheme === 'unicode-escape') {
      const astral = cps(layer.after).find((ch) => ch.codePointAt(0) > 0xffff);
      if (astral) {
        const form = escapedForm(layer, { ch: astral, cp: astral.codePointAt(0) });
        out.push('超出基本平面的字符要用一对代理项表示' + (form ? '，比如' + showChar(astral) + '写作 `' + form + '`' : '') + '——这是 Unicode 2.0（1996）为 UTF-16 引入的机制。');
      }
    }
    return out.join('');
  }

  // Contract numbering (steps[0] = 第 1 层 = 地表层) for a layer given in formation order.
  function layerNo(c, li) { return c.layers.length - li; }
  function layerTitle(c, li) {
    const n = layerNo(c, li);
    return '第 ' + n + ' 层（' + (n === c.layers.length ? '最深层' : n === 1 ? '地表层' : '中间层') + '）';
  }

  // Zero-width U+FFFD in a layer's garbled text: either this layer's wrong decoder could not pair
  // the leftover byte(s) (formation time), or the layer above handed down a character whose bytes
  // were already incomplete. Returns { self, inherited } counts.
  function gapOrigins(c, layer, li, gaps) {
    const upper = li < c.layers.length - 1 ? c.layers[li + 1] : null;
    const out = { self: [], inherited: [] };
    for (const g of gaps) {
      const k = layer.segsBefore.indexOf(g);
      const u = upper && upper.segsAfter ? upper.segsAfter[k] : null;
      if (u && u.ch === g.ch && (u.error || u.lost)) out.inherited.push(g);
      else out.self.push(g);
    }
    return out;
  }

  function layerHasRepair(c, li) {
    const stepIdx = c.steps.length - 1 - li;
    return c.repairs.some((rep) => (Number.isInteger(rep.step) ? rep.step === stepIdx : rep.reason === 'gap'));
  }

  function layerNotes(c, layer, entry, rng) {
    const notes = [];
    const allB = layer.segsBefore || [];
    const allA = layer.segsAfter || [];
    // untouched (kept) characters of a partial layer are original text: no gaps, no ratios
    const segsB = allB.filter((s) => s && !isKept(layer, s) && !isIdentity(layer, s));
    const segsA = allA.filter((s) => s && !isKept(layer, s) && !isIdentity(layer, s));
    const wType = encType(layer.W);
    if (!layer.bytes) return notes;

    // Misaligned "bites": garbled characters made of bytes from two original characters.
    if ((wType === 'double' || wType === 'utf16') && segsA.length) {
      const bounds = new Set(segsA.filter((s) => s.end > s.start).map((s) => s.start));
      const k = segsB.filter((b) => {
        if (!(b.end > b.start)) return false;
        for (let x = b.start + 1; x < b.end; x++) if (bounds.has(x)) return true;
        return false;
      }).length;
      if (k > 0 && wType === 'double') notes.push(fill(rng.pick(c.voice.crossNote), { k }, c.strict));
      const multi = segsA.filter((s) => s.end - s.start >= 2 && !s.repaired);
      const bites = segsB.filter((b) => b.end > b.start && layer.bytes[b.start] >= 0x80);
      if (wType === 'double' && layer.E === 'utf-8' && multi.length >= 2 && multi.every((s) => s.end - s.start === 3) &&
          bites.length && bites.every((b) => b.end - b.start === 2)) {
        notes.push('UTF-8 里这些字符都是 3 个字节一组，' + encName(layer.W) + ' 却是 2 个字节一口——3 和 2 的最小公倍数是 6，每 6 个字节（两个字）才重新对齐一次。');
      }
    }
    // Shift_JIS half-width katakana: single bytes 0xA1–0xDF that escaped a bite.
    if (layer.W === 'shift_jis') {
      const kana = segsB.filter((b) => b.ch && /[\uff61-\uff9f]/.test(b.ch));
      if (kana.length) {
        const why = layer.E === 'utf-8'
          ? 'UTF-8 的续字节恰好落在这个区间、又没被前一个字节"咬走"时，就会单独成字。'
          : layer.E === 'euc-jp'
            ? 'EUC-JP 的每个字节都在 0xA1–0xFE，其中落在 0xA1–0xDF 的，就被 Shift_JIS 当成了单字节的半角片假名。'
            : encName(layer.E) + ' 的字节恰好落在这个区间、又没被前一个字节"咬走"时，就会单独成字。';
        notes.push('其中 ' + kana.length + ' 个半角片假名（如 ' + showGlyph(kana[0].ch) + '）来自 Shift_JIS 的单字节区 0xA1–0xDF：' + why);
      }
    }
    // Invisible C1 controls (Windows-1252 undefined bytes / Latin-1 C1 range).
    if (wType === 'single') {
      const c1 = segsB.map((s) => s.ch || '').filter((ch) => { const cp = ch ? ch.codePointAt(0) : 0; return cp >= 0x80 && cp <= 0x9f; });
      if (c1.length) notes.push('这一层还藏着 ' + c1.length + ' 个看不见的 C1 控制符（如 `' + uplus(c1[0].codePointAt(0)) + '`），复制粘贴时极易被吞掉。');
    }
    if (encType(layer.E) === 'utf16' && wType === 'single') {
      const nul = cps(layer.before).filter((ch) => ch === '\u0000').length;
      if (nul) notes.push('还有 ' + nul + ' 个 `U+0000`（空字符）：ASCII 字母在 UTF-16 里都要带一个 `00` 字节，单字节解码器把它们读成了看不见的空字符——所以这类文物常显示成"字母之间隔着空格"。');
    }
    // Lone bytes that became U+FFFD, and gaps where bytes had already vanished.
    const errs = segsB.filter((b) => b.end > b.start && (b.error || b.ch === '\uFFFD'));
    if (errs.length) {
      notes.push('有 ' + errs.length + ' 处字节（如 `' + hex(layer.bytes, errs[0].start, errs[0].end) + '`）凑不成合法字符，只好变成 `\uFFFD`——信息就是从这里开始丢失的。');
    }
    const gaps = segsB.filter((b) => b.end === b.start);
    if (gaps.length) {
      const W = encName(layer.W);
      const promise = layerHasRepair(c, entry.li) ? '，稍后的修复环节会处理' : '';
      const o = gapOrigins(c, layer, entry.li, gaps);
      if (o.self.length) {
        notes.push('乱码里有 ' + o.self.length + ' 处缺口（' + showGlyph(o.self[0].ch || '\uFFFD') + '）：那里的字节在 ' + W + ' 解码时落了单（凑不成合法字符），被换成了 `\uFFFD`，原字节随之丢失' + promise + '。');
      }
      if (o.inherited.length) {
        notes.push('这一层还有 ' + o.inherited.length + ' 处缺口（' + showGlyph(o.inherited[0].ch || '\uFFFD') + '）是' + layerTitle(c, entry.li + 1) + '留下的：那里的字节已经残缺，解不出合法字符，对应的原字节在那次转换中丢失了' + promise + '。');
      }
    }

    // Lead-byte fingerprint for UTF-8 read by a single-byte decoder.
    if (layer.E === 'utf-8' && wType === 'single') {
      const hist = new Map();
      for (const s of segsA) {
        if (s.end - s.start < 2 || s.repaired) continue;
        const lead = layer.bytes[s.start];
        const k = segIndexCovering(allB, s.start);
        if (k < 0 || isKept(layer, allB[k])) continue;
        const e = hist.get(lead) || { n: 0, glyph: allB[k].ch, second: layer.bytes[s.start + 1] };
        e.n++;
        hist.set(lead, e);
      }
      let top = null;
      hist.forEach((e, lead) => { if (!top || e.n > top.n) top = { lead, n: e.n, glyph: e.glyph, second: e.second }; });
      if (top && top.n >= 2) {
        const meaning = leadMeaning(top.lead, top.second, layer.W);
        notes.push('顺带一提，这件文物里 ' + showGlyph(top.glyph) + ' 打头的组合出现了 ' + top.n + ' 次——它就是 UTF-8 前导字节 `' + hex2(top.lead) + '` 在 ' + encName(layer.W) + ' 里的样子' + (meaning ? '：' + meaning : '') + '。');
      }
    }
    if (layer.E === 'utf-8' && layer.W === 'gbk' && segsB.some((b) => b.ch === '锛')) {
      notes.push('「锛」几乎是这类乱码的身份证：中文全角标点（，！？：）的 UTF-8 都以 `EF BC` 开头，被 GBK 对齐咬下时就是「锛」。');
    }
    return notes;
  }

  // Every garbled character covers exactly the bytes of one original character.
  function groupsAligned(layer) {
    if (!layer.segsBefore || !layer.segsAfter) return true;
    const spans = new Set(layer.segsAfter.filter((s) => s && s.end > s.start).map((s) => s.start + ':' + s.end));
    return layer.segsBefore.every((b) => !b || !(b.end > b.start) || spans.has(b.start + ':' + b.end));
  }

  function transcodeParagraph(c, layer, entry, seenE, seenW, rng) {
    const intro = [];
    const E = encName(layer.E);
    const W = encName(layer.W);
    if (layer.E && !seenE.has(layer.E)) {
      seenE.add(layer.E);
      intro.push(encKnown(layer.E)
        ? trueDesc(c, layer)
        : E + ' 是本馆尚未收录的编码，我们只能从字节本身观察它。');
    }
    if (layer.W && !seenW.has(layer.W) && !encKnown(layer.W)) {
      seenW.add(layer.W);
      intro.push(W + ' 同样不在本馆的码表档案里，下面只陈述字节与字符的对应关系。');
    }
    if (layer.W && !seenW.has(layer.W)) {
      seenW.add(layer.W);
      const wT = encType(layer.W);
      const eT = encType(layer.E);
      // "same width, just another table" only when the byte groups really line up
      let slot = wT === eT && (wT === 'single' || wT === 'double') ? 'same' : wT;
      if (slot === 'same' && wT === 'double' && !groupsAligned(layer)) slot = 'shift';
      intro.push(fill(rng.pick(c.voice.wrong[slot] || c.voice.wrong.single), { E, W }, c.strict));
    }
    // Layout: what the two encodings are → one line per traced character → data-driven notes.
    const lines = [];
    if (intro.length) lines.push(intro.join(''));
    if (entry.traces.length) {
      entry.traces.forEach((t, i) => lines.push(traceSentence(c, layer, t, entry.li, rng, i === 0)));
    } else if (layer.bytes && layer.bytes.length) {
      // quote the first run that really was misread, not untouched text around it
      const run = changedRuns(layer)[0];
      const from = run && run.end > run.start ? run.start : 0;
      const to = run && run.end > run.start ? Math.min(run.end, from + 6) : Math.min(6, layer.bytes.length);
      lines.push((from ? '这一层里被误读的字节从 `' : '这一层开头的几个字节是 `') + hex(layer.bytes, from, to) + '`' + (from ? ' 开始' : '') + '，' + W + ' 把它们读成了' + quote(run ? run.before : layer.before, 8) + '。');
    } else {
      lines.push(E + ' 写下的文字被 ' + W + ' 误读，变成了' + quote(layer.before, 12) + '。');
    }
    const notes = layerNotes(c, layer, entry, rng);
    if (notes.length) lines.push(notes.join(''));
    return lines.join('\n');
  }

  function specimen(c) {
    const chars = [];
    for (const ch of cps(c.input)) {
      if (ch.codePointAt(0) >= 0x80 && !invisibleKind(ch.codePointAt(0)) && chars.indexOf(ch) < 0) chars.push(ch);
      if (chars.length >= 2) break;
    }
    if (!chars.length) {
      const first = cps(c.input).find((ch) => /[A-Za-z0-9]/.test(ch)) || 'A';
      return '它是纯 ASCII 文本：比如' + showChar(first) + '就是 `' + hex2(first.charCodeAt(0)) + '`。0x00–0x7F 这 128 个字符在 UTF-8、GBK、Big5、Shift_JIS、Windows-1252 里的字节完全相同，所以纯英文几乎不会乱码——这也是乱码总爱欺负非英语用户的原因。';
    }
    const lines = chars.map((ch) => {
      const cp = ch.codePointAt(0);
      let s = showChar(ch) + '（`' + uplus(cp) + '`）在 UTF-8 中是 `' + utf8Of(cp).map(hex2).join(' ') + '`';
      try {
        const C = MBX.Codecs;
        const gbk = C && typeof C.encodeChar === 'function' ? C.encodeChar('gbk', ch) : null;
        if (gbk && gbk.length) s += '，在 GBK 中则是 `' + gbk.map(hex2).join(' ') + '`';
      } catch (_) { /* codecs optional */ }
      return s;
    });
    return lines.join('；') + '。同一个字，不同的编码给出完全不同的字节——字节本身不带"编码说明书"，这正是乱码的根源。';
  }

  function buildMechanism(c) {
    const v = c.voice;
    const rng = c.rng('mechanism');
    const parts = [];

    if (c.status === 'clean') {
      return rng.pick(v.specimenIntro) + specimen(c);
    }

    if (!c.layers.length) {
      if (c.status === 'irrecoverable' || c.signatures.length) {
        parts.push(rng.pick(c.debugMemory ? v.memIntro : v.lostIntro));
        const used = c.signatures.filter((s) => s.fact).slice(0, 2);
        for (const s of used) parts.push(s.fact.mechanism);
        if (!used.length) {
          if (c.flags.nFFFD) parts.push(SIGNATURE_FACTS.replacement.mechanism);
          else if (c.flags.nQ >= 3) parts.push(SIGNATURE_FACTS['question-marks'].mechanism);
          else parts.push('关键字节在某次有损转换中被替换或丢弃，剩下的字符已经不足以推断原貌。');
        }
        return parts.join('\n');
      }
      // unknown: show the clues we have
      parts.push(rng.pick(v.unknownMech));
      // each distinct clue once, its matches listed inside it
      const clues = groupedSignals(c, 3).slice(0, 3).map((g) => (g.matches.length ? '片段 ' + g.matches.map(showGlyphRun).join('、') + ' —— ' : '') + g.hint);
      if (clues.length) parts.push(clues.join('；') + '。');
      else parts.push('它不像任何已知的乱码：既没有 `Ã`、`â€` 这类西欧误读指纹，也没有「锟」「縺」这类东亚误读指纹。');
      const alt = c.alternatives[0];
      if (alt && Array.isArray(alt.steps) && alt.steps.length) {
        const deep = prepStep(alt.steps[alt.steps.length - 1]);
        if (deep.kind === 'transcode' && deep.bytes) {
          parts.push('如果硬要猜，最接近的假说是"' + safe(alt.label || '另一条链路') + '"：' + openingBytes(deep) + '，但可读性仍不达标。');
        }
      }
      parts.push(c.input && !isAsciiText(c.input) ? '要确认真相，最好拿到原始文件的字节，而不是复制粘贴后的文字。' : '要确认真相，最好拿到原始文件的字节。');
      return parts.join('\n');
    }

    parts.push(c.status === 'irrecoverable' ? rng.pick(v.lostIntro) : rng.pick(v.mechIntro));
    if (c.layers.length > 1) {
      const k = c.transcodes.length;
      const esc = c.layers.length - k;
      parts.push(fill(rng.pick(usable(v.multiIntro, c)), {
        n: c.layers.length, k, escNote: esc ? '、' + esc + ' 层转义封装' : '', escAnd: esc ? '与 ' + esc + ' 层转义封装' : '',
      }, c.strict));
    }
    const seenE = new Set();
    const seenW = new Set();
    c.traces.forEach((entry) => {
      const layer = entry.layer;
      const head = c.layers.length > 1 ? '**' + layerTitle(c, entry.li) + '**——' : '';
      const body = layer.kind === 'unescape'
        ? unescapeParagraph(c, layer, entry)
        : transcodeParagraph(c, layer, entry, seenE, seenW, rng);
      parts.push(head + body);
    });

    // Growth ratio across the mis-decoding strata only (escape wrappers would inflate it), and
    // only over the characters that really were misread (kept text of a partial result is not).
    const tc = c.transcodes;
    const partialish = tc.some((l) => l.partial || hasKept(l));
    const countChanged = (l, segs, text) => (partialish && segs ? segs.filter((s) => isChanged(l, s)).length : cps(text).length);
    const n0 = tc.length ? countChanged(tc[0], tc[0].segsAfter, tc[0].after) : 0;
    let n1 = tc.length ? countChanged(tc[tc.length - 1], tc[tc.length - 1].segsBefore, tc[tc.length - 1].before) : 0;
    // a BOM read as ï»¿ is not text that grew: leave its glyphs out of the count
    if (tc.length === 1) for (const e of c.traces) for (const t of e.traces) if (t.bomHex && e.layer === tc[0]) n1 -= t.bomPieces.length;
    if (n0 > 0 && n1 > 0 && n0 !== n1) {
      const ratio = n1 / n0;
      parts.push('整体看，' + n0 + ' 个原字符经过误读，' + (ratio > 1 ? '膨胀' : '压缩') + '成了 ' + n1 + ' 个字符（约 ' + ratio.toFixed(1) + ' 倍）。');
    }
    if (c.part && c.part.keptN > 0) {
      parts.push(c.part.clean
        ? '其余 ' + c.part.keptN + ' 个字符原本就是正常文字，从没被误读过，原样保留。'
        : '其余 ' + c.part.keptN + ' 个字符没有经过这条链路，保持原样。');
    }
    if (c.status === 'irrecoverable') {
      // the signature story only when the byte traces above have not told it already
      const shown = new Set();
      for (const e of c.traces) for (const t of e.traces) for (const p of t.pieces) shown.add(p.ch);
      for (const s of c.signatures.filter((x) => x.fact).slice(0, 1)) {
        if (!cps(s.fact.title).some((ch) => shown.has(ch))) parts.push(s.fact.mechanism);
      }
    }
    const lostOutput = c.output.indexOf('�') >= 0;
    const outro = c.status === 'irrecoverable' ? v.mechOutroLost
      : c.flags.lossy && c.repairs.length ? v.mechOutroLossy
        : c.flags.lossy && lostOutput ? v.mechOutroUnrepaired
          : tc.length ? v.mechOutro : v.mechOutroEscape;
    parts.push(fill(rng.pick(usable(outro, c)), c.analogy || {}, c.strict));
    return parts.join('\n');
  }

  // "它把开头的字节 `81 40 81 41` 解释成「丂丄」" with the quoted characters matching the bytes.
  function openingBytes(layer) {
    const segs = layer.segsAfter;
    let end = Math.min(6, layer.bytes.length);
    let chars = null;
    if (Array.isArray(segs) && segs.length) {
      const whole = [];
      for (const s of segs) {
        if (!s || !(s.end > s.start)) continue;
        if (s.end > end && whole.length) break;
        whole.push(s);
        if (s.end >= end) break;
      }
      if (whole.length) {
        end = whole[whole.length - 1].end;
        chars = whole.map((s) => s.ch).join('');
      }
    }
    const bytes = '`' + hex(layer.bytes, 0, end) + '`';
    return chars ? '它把开头的字节 ' + bytes + ' 解释成' + quote(chars, 10) : '它从开头是 ' + bytes + ' 的字节读起';
  }

  /* ---------- dating / repair / conservation / easter / closing ---------- */

  function buildDating(c) {
    const v = c.voice;
    const rng = c.rng('dating');
    const evidence = c.era.evidence.join('');
    const vars = { evidence, era: c.era.label, site: c.site, eraShort: c.era.label.replace(/（[^）]*）$/, '') };
    if (c.status === 'clean') return fill(rng.pick(v.datingClean), vars, c.strict);
    if (c.era.start == null) {
      let s = fill(rng.pick(v.datingUnknown), vars, c.strict);
      if (c.site && c.status !== 'unknown') s += '推测出土地点：' + c.site + '。';
      return s;
    }
    let s = fill(rng.pick(v.dating), vars, c.strict);
    const culprits = [];
    for (const p of c.pairs) for (const x of p.facts.culprits || []) if (culprits.indexOf(x) < 0) culprits.push(x);
    if (culprits.length) {
      const pickN = rng.shuffle(culprits).slice(0, Math.min(culprits.length, c.style === 'snark' ? 3 : 2));
      s += fill(rng.pick(v.suspects), { culprits: pickN.map(safe).join('、') }, c.strict);
    }
    return s;
  }

  function reprFrom(from) {
    if (from === '�') return '一个 `�`';
    if (from === '?') return '一个 `?`';
    if (from === ' ') return '一个空格';
    if (!from) return '一处空缺';
    return showGlyph(from);
  }

  // The layer (prepared step) a repair belongs to: Repair.step indexes best.steps, which is the
  // same surface-first order as c.steps. best.repairs are copies, so identity lookups fail.
  function repairLayer(c, rep) {
    if (Number.isInteger(rep.step) && c.steps[rep.step]) return c.steps[rep.step];
    for (const st of c.steps) if (st.repairs.indexOf(rep) >= 0) return st;
    return c.transcodes.find((l) => l.E === 'utf-8') || null;
  }

  function repairWrongDecoder(c, rep) {
    const st = Number.isInteger(rep.step) ? c.steps[rep.step] : null;
    if (st && st.W) return st.W;
    for (const s of c.steps) if (s.repairs.indexOf(rep) >= 0 && s.W) return s.W;
    const t = c.transcodes.find((l) => l.E === 'utf-8');
    return t ? t.W : null;
  }

  // A candidate character: invisible ones as a bare code point (no nested parentheses).
  function candShow(ch) {
    const cp = ch.codePointAt(0);
    return invisibleKind(cp) ? '`' + uplus(cp) + '`' : '「' + safe(ch) + '」';
  }

  // Which bytes of a gap-repaired character survived, and where they hide in the mojibake.
  function gapSurvivors(c, rep, layer) {
    if (!layer || !layer.bytes || !layer.segsAfter || !rep.to) return null;
    let seg = isNum(rep.index) && rep.index >= 0 ? layer.segsAfter[rep.index] : null;
    if (!seg || !seg.repaired || seg.ch !== rep.to) seg = layer.segsAfter.find((s) => s && s.repaired && s.ch === rep.to) || null;
    if (!seg || !(seg.end > seg.start)) return null;
    const full = canonicalBytes(layer.E, rep.to.codePointAt(0));
    const n = seg.end - seg.start;
    if (!full || n >= full.length || !sameBytes(layer.bytes, seg.start, full.slice(0, n))) return null;
    const hosts = (layer.segsBefore || []).filter((b) => b && b.end > b.start && b.start < seg.end && b.end > seg.start && !isKept(layer, b));
    return { n, missing: full.length - n, hex: hex(layer.bytes, seg.start, seg.end), hosts: hosts.map((b) => b.ch) };
  }

  function buildRepair(c) {
    if (!c.repairs.length) return null;
    const rng = c.rng('repair');
    const lines = [rng.pick(c.voice.repairIntro)];
    let hasCands = false;
    c.repairs.slice(0, 5).forEach((rep) => {
      const layer = repairLayer(c, rep);
      const stepIdx = Number.isInteger(rep.step) ? rep.step : c.steps.indexOf(layer);
      // A repair in an upper layer guesses an intermediate mojibake character, not a final one.
      const intermediate = stepIdx >= 0 && stepIdx !== c.steps.length - 1;
      // The engine reports index -1 when a deeper-layer repair cannot be traced to the output.
      const at = isNum(rep.index) && rep.index >= 0 ? '第 ' + (rep.index + 1) + ' 个字' : null;
      const pos = intermediate
        ? layerTitle(c, c.steps.length - 1 - stepIdx) + '的一个中间字符'
        : at || '某个字';
      const to = intermediate ? showGlyph(rep.to || '') + (at ? '（它最终落在原文' + at + '上）' : '') : showChar(rep.to || '');
      const others = (Array.isArray(rep.candidates) ? rep.candidates : []).filter((x) => x && x !== rep.to).slice(0, 3);
      if (others.length) hasCands = true;
      const cands = others.length ? '（备选：' + others.map(candShow).join('') + '）' : '';
      const W = repairWrongDecoder(c, rep);
      const Wn = encName(W);
      const En = layer && layer.E ? encName(layer.E) : 'UTF-8';
      let line;
      if (rep.reason === 'gap') {
        const sv = intermediate ? null : gapSurvivors(c, rep, layer);
        const surface = stepIdx === 0;
        if (sv) {
          line = pos + '只剩下前 ' + sv.n + ' 个字节 `' + sv.hex + '`' +
            (sv.hosts.length ? '（藏在乱码' + quote(sv.hosts.join(''), 8) + '里）' : '') +
            '，其余 ' + sv.missing + ' 个字节' + (surface && W ? '在 ' + Wn + ' 解码时落了单、变成了 `�`' : '在转换中丢失了') +
            '，原字节随之丢失。根据前后字节的 ' + En + ' 结构，修复师推断它是' + to + cands + '。';
        } else {
          line = pos + '的位置只剩下' + reprFrom(rep.from) + '，它的字节' + (surface && W ? '在 ' + Wn + ' 解码时落了单、被换成了 `�`' : '在转换中丢失了') +
            '。根据前后字节的 ' + En + ' 结构，修复师推断它是' + to + cands + '。';
        }
      } else if (rep.reason === 'nbsp') {
        line = pos + '的一个续字节被"降级"了：UTF-8 续字节 `A0` 在 ' + Wn + ' 里是不换行空格（NBSP），复制粘贴时变成了普通空格 `20`。把它换回 `A0` 后，复原出' + to + cands + '。';
      } else if (rep.reason === 'dropped') {
        const inv = invisibleBytes(W);
        line = pos + '少了一个字节：' + (inv.length
          ? Wn + ' 会把 ' + formatByteList(inv) + ' 解成看不见的控制符，复制时最容易被吞掉。修复师逐一试了这些候选字节，补回了'
          : Wn + ' 解出的某个看不见的字符在复制时被吞掉了。修复师逐一试了可能的字节，补回了') + to + cands + '。';
      } else {
        line = pos + '由' + reprFrom(rep.from) + '修复为' + to + cands + '。';
      }
      lines.push(CIRCLED[lines.length - 1] + ' ' + line);
    });
    if (c.repairs.length > 5) lines.push('……另有 ' + (c.repairs.length - 5) + ' 处修复，此处从略。');
    if (hasCands) lines.push('（带备选的字是根据字频与上下文推断出的最可能结果，并非百分之百确定。）');
    return lines.join('\n');
  }

  // ftfy's "sloppy" codecs accept the bytes Python's own cp125x tables leave undefined.
  const SLOPPY = {
    'windows-1250': 'sloppy-windows-1250', 'windows-1251': 'sloppy-windows-1251', 'windows-1252': 'sloppy-windows-1252',
    'windows-1253': 'sloppy-windows-1253', 'windows-1254': 'sloppy-windows-1254', 'windows-1255': 'sloppy-windows-1255',
    'windows-1256': 'sloppy-windows-1256', 'windows-1257': 'sloppy-windows-1257', 'windows-1258': 'sloppy-windows-1258',
  };

  // The garbled characters of a layer that really pass through its encode step.
  function garbledText(layer) {
    if (!layer.segsBefore) return layer.before;
    return layer.segsBefore.filter((s) => s && !isKept(layer, s) && !isIdentity(layer, s)).map((s) => s.ch).join('');
  }

  function decodesCleanly(E, bytes) {
    try {
      const C = MBX.Codecs;
      if (C && typeof C.decode === 'function' && typeof C.get === 'function' && C.get(E)) {
        const d = C.decode(E, bytes);
        return { ok: !d.errors, text: d.text };
      }
    } catch (_) { /* fall through */ }
    return null;
  }

  // A relic-specific Python one-liner that peels every stratum, surface first. It is labelled a
  // recipe only when the standard library can run it; otherwise the sentence says why not.
  function pythonRecipe(c) {
    if (!c.steps.length) return null;
    let expr = 's';
    let tolerant = 's';
    let needSloppy = false;
    let needTolerant = false;
    const notes = [];
    const why = [];
    let blocked = null;
    const deepT = c.transcodes.length ? c.transcodes[0] : null;
    for (const st of c.steps) {
      const e = ENCODING_FACTS[st.E];
      if (st.kind === 'unescape') {
        const enc = e ? e.py : 'utf-8';
        let wrap;
        switch (st.scheme) {
          case 'percent': wrap = (x) => "urllib.parse.unquote(" + x + ", encoding='" + enc + "')"; break;
          case 'html-entity': wrap = (x) => 'html.unescape(' + x + ')'; break;
          case 'unicode-escape': wrap = (x) => "json.loads('\"' + " + x + " + '\"')"; break;
          case 'quoted-printable': wrap = (x) => 'quopri.decodestring(' + x + ").decode('" + enc + "')"; break;
          case 'hex-dump': wrap = (x) => 'bytes.fromhex(' + x + ").decode('" + enc + "')"; break;
          case 'hex-escape': wrap = (x) => x + ".encode('latin-1').decode('unicode_escape').encode('latin-1').decode('" + enc + "')"; break;
          default: return null;
        }
        expr = wrap(expr);
        tolerant = wrap(tolerant);
        continue;
      }
      const w = ENCODING_FACTS[st.W];
      if (!e || !w) return null;
      const garbled = garbledText(st);
      let wpy = w.py;
      // Bytes WHATWG decodes to C1 controls but Python's cp125x table leaves undefined.
      if (/^windows-/.test(st.W)) {
        const hit = invisibleBytes(st.W).find((b) => b >= 0x80 && b <= 0x9f && garbled.indexOf(String.fromCharCode(b)) >= 0);
        if (hit != null) {
          if (SLOPPY[st.W]) {
            wpy = SLOPPY[st.W];
            needSloppy = true;
            notes.push('乱码里含 `' + uplus(hit) + '` 这类 ' + encName(st.W) + ' 未定义字节变成的控制符，标准库的 `' + w.py + '` 编不回去会报错，所以借用 ftfy 的 `' + wpy + '`（需先 `pip install ftfy`）');
          } else {
            notes.push('乱码里含 `' + uplus(hit) + '` 这类 ' + encName(st.W) + ' 未定义字节变成的控制符，Python 的 `' + w.py + '` 编不回去，这一步会报错');
          }
        }
      }
      // GBK / Big5 / EUC-KR private-use characters have no mapping in Python's tables.
      if (/^(gbk|big5|euc-kr)$/.test(st.W) && !blocked) {
        const pua = cps(garbled).find((ch) => { const cp = ch.codePointAt(0); return cp >= 0xe000 && cp <= 0xf8ff; });
        if (pua) blocked = '乱码里含私用区字符（如 `' + uplus(pua.codePointAt(0)) + '`），Python 标准库的 `' + w.py + '` 编解码器无法把它们编回字节，这行会报错——只能回到原始文件';
      }
      // A BOM at the head of the deepest layer: decode it away, as the narration shows the text.
      let epy = e.py;
      if (st === deepT && st.bytes && BOM_BYTES[st.E] && sameBytes(st.bytes, 0, BOM_BYTES[st.E])) epy = st.E === 'utf-8' ? 'utf-8-sig' : 'utf-16';
      // Lossy strata: which half of the one-liner raises.
      const encodeFails = st.W !== 'utf-8' && !!st.segsBefore && st.segsBefore.some((s) => s && s.end === s.start && !isKept(st, s));
      const dec = st.bytes ? decodesCleanly(st.E, st.bytes) : null;
      const decodeFails = dec ? !dec.ok : (st.segsAfter || []).some((s) => s && (s.error || s.repaired));
      if (encodeFails) why.push('乱码里的 `�` 编不回 ' + encName(st.W) + ' 字节（UnicodeEncodeError）');
      if (decodeFails) why.push('残缺的 ' + encName(st.E) + ' 字节序列解不出来（UnicodeDecodeError）');
      if (encodeFails || decodeFails) needTolerant = true;
      expr += ".encode('" + wpy + "').decode('" + epy + "')";
      tolerant += ".encode('" + wpy + "'" + (encodeFails ? ", errors='ignore'" : '') + ").decode('" + epy + "'" + (decodeFails ? ", errors='replace'" : '') + ')';
    }
    const prefix = needSloppy ? 'import ftfy.bad_codecs; ' : '';
    const code = '`' + prefix + expr + '`';
    if (blocked) return '理论上的 Python 还原咒语是 ' + code + '，但' + blocked + '。';
    const lossy = c.repairs.length > 0 || c.steps.some((st) => st.lossy);
    if (needTolerant) {
      const single = c.steps.length === 1 && c.steps[0].kind === 'transcode';
      const sim = single && c.steps[0].bytes ? decodesCleanly(c.steps[0].E, c.steps[0].bytes) : null;
      notes.push('它带有缺口，直接运行会因' + why.filter((x, i) => why.indexOf(x) === i).join('、') + '而抛出异常；可改用 `' + prefix + tolerant + '`' +
        (sim && sim.text ? '（得到' + quote(sim.text, 24) + '）' : '') +
        (c.repairs.length ? '，丢失的字节仍需像本馆这样做修复推断' : '，丢失的字节会以 `�` 标出'));
    } else if (lossy) {
      notes.push('它带有缺口，这行代码只能还原没丢的部分，缺失的字节需要像本馆这样做修复推断');
    }
    // A partial result: only the garbled run(s) go through the spell, never the whole text.
    let target = '';
    if (c.status === 'partial' && c.part && c.part.frags.length) {
      target = '对乱码片段' + fragsText(c, 2) + '执行 ';
      notes.unshift(c.part.unencodable
        ? '只对乱码片段执行：其余文字里有 ' + encName(c.transcodes.length ? c.transcodes[c.transcodes.length - 1].W : null) + ' 编不了的字符，整段执行会报错'
        : '只对乱码片段执行：其余文字本来就是好的，整段执行反而会把它们弄坏');
    }
    return '本件文物的 Python 还原咒语：' + target + code + (notes.length ? '（' + notes.join('；') + '）' : '') + '。';
  }

  // `.encode('x').decode('y')` pairs named in a piece of advice.
  function commandsIn(text) {
    const out = [];
    const re = /\.encode\('([^']+)'[^)]*\)\.decode\('([^']+)'/g;
    let m;
    while ((m = re.exec(text))) out.push(m[1] + '>' + m[2]);
    return out;
  }

  // "例如 open(path, encoding='cp1252')" for a relic whose bytes were replaced by U+FFFD.
  function replacementExample(c) {
    if (c.deepE && ENCODING_FACTS[c.deepE]) return ENCODING_FACTS[c.deepE].py;
    const text = c.input.replace(/�/g, '');
    const count = (re) => (text.match(re) || []).length;
    const scores = [
      ['cp1252', count(/[A-Za-zÀ-ÿ]/g)],
      ['gbk', count(/[一-鿿]/g) * 2],
      ['cp932', count(/[぀-ヿ]/g) * 2],
      ['cp1251', count(/[Ѐ-ӿ]/g)],
      ['cp949', count(/[가-힯]/g) * 2],
    ].sort((a, b) => b[1] - a[1]);
    return scores[0][1] >= 2 ? scores[0][0] : null;
  }

  function signatureTips(c, s) {
    let tips = s.fact.tips.slice();
    if (s.id === 'replacement') {
      const ex = replacementExample(c);
      if (ex) tips[0] = "回到源头：用正确的编码重新读取原始文件（这件文物多半要用 Python `open(path, encoding='" + ex + "')`），而不是在已经出现 `�` 的文本上修修补补。";
    }
    // utf-16-le would keep the BOM as U+FEFF; with a BOM present, encoding='utf-16' is the right call
    if (s.id === 'utf16-nul' && c.signatures.some((x) => x.id === 'utf16-bom')) tips = tips.filter((t) => t.indexOf('utf-16-le') < 0);
    return tips;
  }

  function buildConservation(c) {
    const rng = c.rng('conservation');
    const max = c.style === 'academic' ? 4 : 3;
    const tips = [];
    const add = (t) => { if (t && tips.indexOf(t) < 0) tips.push(t); };

    if (c.status === 'clean') {
      rng.shuffle([
        '保持全链路 UTF-8：文件、数据库、HTTP 头与终端用同一种编码。',
        "读写文件时显式声明编码，例如 Python 的 `open(path, encoding='utf-8')`。",
        '网页在 `<head>` 开头写 `<meta charset="utf-8">`。',
        '数据库用 `utf8mb4`，别用最多 3 字节的 MySQL `utf8`。',
        '导出 CSV 给 Excel 时，用"CSV UTF-8"格式或带上 BOM。',
      ]).slice(0, max).forEach(add);
    } else if (c.status === 'unknown' && !c.debugMemory) {
      rng.shuffle([
        '尽量找到原始文件，而不是复制粘贴后的文字——字节才是第一手证据。',
        '用 `xxd`（Linux/macOS）或 `Format-Hex`（PowerShell）查看原始字节，十六进制里的规律往往比字符更诚实。',
        '提供更长的样本：统计特征越多，判断越可靠。',
        '去赝品工坊试试：看看哪一种"原编码 → 误读为"的组合能造出同款乱码。',
        '确认它真的是文本：压缩包、图片或加密数据被当成文本打开，也会显示成一堆乱码。',
      ]).slice(0, max).forEach(add);
    } else {
      const recipe = c.status === 'irrecoverable' ? null : pythonRecipe(c);
      const covered = recipe ? commandsIn(recipe) : [];
      // a tip that is little more than the recipe's own command would only repeat it
      const repeatsRecipe = (t) => {
        const cmds = commandsIn(t);
        return cmds.length > 0 && cmds.every((x) => covered.indexOf(x) >= 0) && stripMarkup(t.replace(/`[^`]*`/g, '')).length <= 24;
      };
      const pairTips = [];
      c.pairs.forEach((p) => { for (const t of p.facts.tips || []) if (pairTips.indexOf(t) < 0) pairTips.push(t); });
      const plain = pairTips.filter((t) => !(recipe && (t.indexOf('急救') >= 0 || repeatsRecipe(t))));
      if (plain.length) add(plain[0]);
      if (recipe) add(recipe);
      if (c.flags.samePair && c.transcodes[0].E === 'utf-8' && /^(windows-1252|iso-8859-1)$/.test(c.transcodes[0].W)) {
        add('多层乱码要逐层剥：上面的咒语里每一对 encode/decode 剥掉一层；如果是 MySQL 里的双重编码，可以用 ' + MYSQL_DOUBLE_FIX + ' 剥掉一层（先备份！）。');
      }
      if (c.flags.astral) add('原文含有 4 字节 UTF-8 字符（如 emoji）：MySQL 必须用 `utf8mb4`（5.5.3 起提供），`utf8`（utf8mb3）存不下。');
      for (const s of c.signatures) if (s.fact) for (const t of signatureTips(c, s)) if (!(recipe && repeatsRecipe(t))) add(t);
      rng.shuffle(plain.slice(1)).forEach((t) => { if (tips.length < max) add(t); });
      if (!tips.length) add('文件、数据库、网页与终端统一使用 UTF-8，并且每一处都显式声明编码。');
    }
    // signature-specific advice may push the list one item past the usual length
    const list = tips.slice(0, max + (c.signatures.length ? 1 : 0));
    return rng.pick(c.voice.conservationIntro) + '\n' + list.map((t, i) => CIRCLED[i] + ' ' + t).join('\n');
  }

  function easterCandidates(c) {
    const data = []; // facts computed from this relic's bytes: preferred
    const lore = [];
    for (const layer of c.layers) {
      if (!layer.bytes || !layer.segsAfter) continue;
      // Shift_JIS "dame-moji" and Big5 "許功蓋": trail byte 0x5C is a backslash.
      if (layer.E === 'shift_jis' || layer.E === 'big5') {
        const hit = layer.segsAfter.find((s) => s.end - s.start === 2 && layer.bytes[s.start + 1] === 0x5c);
        if (hit) {
          const h = hex(layer.bytes, hit.start, hit.end);
          data.push(layer.E === 'shift_jis'
            ? '这件文物里的' + showChar(hit.ch) + '是 Shift_JIS 著名的"ダメ文字"：它的字节 `' + h + '` 第二个字节 `5C` 恰好是反斜杠 `\\`，在 C 字符串和文件路径里会被当成转义符——日本程序员为此头疼了几十年。'
            : '这件文物里的' + showChar(hit.ch) + '属于 Big5 的"許功蓋"家族：它的字节 `' + h + '` 第二个字节 `5C` 恰好是反斜杠 `\\`，在程序里经常被当成转义符吞掉。');
        }
      }
      if (layer.E === 'koi8-r') {
        let s = '';
        for (let i = 0; i < Math.min(layer.bytes.length, 24); i++) {
          const b = layer.bytes[i] & 0x7f;
          s += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·';
        }
        if (/[A-Za-z]{2}/.test(s)) data.push('KOI8-R 的设计彩蛋：把这件文物原始字节的最高位抹掉，会得到' + quote(s, 24) + '——正是俄文的拉丁转写（大小写颠倒）。当年这样设计，是为了让俄文在只认 7 位的网关里也能勉强读懂。');
      }
    }
    if (c.output.indexOf('\uFEFF') >= 0 && !c.signatures.some((s) => s.id === 'utf8-bom-1252')) data.push(SIGNATURE_FACTS['utf8-bom-1252'].lore);
    if (c.flags.euro) data.push('欧元符号 € 的 UTF-8 是 `E2 82 AC`；在 Windows-1252 里它只占一个字节 `80`——那是 1998 年专门腾出来的位置。');
    if (c.flags.emoji) data.push('emoji' + showChar(c.flags.emoji) + '的 UTF-8 是 `' + utf8Of(c.flags.emoji.codePointAt(0)).map(hex2).join(' ') + '`，足足 4 个字节；在 UTF-16 里它需要一对代理项——这正是很多老系统"吃不下"emoji 的原因。');
    if (c.transcodes.some((l) => l.W === 'macintosh' || l.E === 'macintosh')) lore.push(ENCODING_FACTS.macintosh.trivia[0]);
    const ids = [];
    for (const l of c.layers) { if (l.E && ids.indexOf(l.E) < 0) ids.push(l.E); if (l.W && ids.indexOf(l.W) < 0) ids.push(l.W); }
    for (const id of ids) for (const t of (ENCODING_FACTS[id] && ENCODING_FACTS[id].trivia) || []) if (lore.indexOf(t) < 0) lore.push(t);
    lore.push('"Mojibake"（文字化け）来自日语：moji 是"文字"，bake 是"变身、妖怪化"——字变成了妖怪。中文叫"乱码"，俄语叫 кракозябры，意思都差不多。');
    if (c.status === 'clean' && isAsciiText(c.input)) lore.unshift(ENCODING_FACTS.ascii.trivia[0]);
    return { data, lore };
  }

  function buildEaster(c) {
    const rng = c.rng('easter');
    const parts = [rng.pick(c.voice.easterIntro)];
    const sigs = c.signatures.filter((s) => s.fact).slice(0, 2);
    if (sigs.length) {
      const mechanismUsed = !c.layers.length || c.status === 'irrecoverable';
      for (const s of sigs) {
        const story = mechanismUsed ? s.fact.lore : s.fact.mechanism + s.fact.lore;
        parts.push('**' + s.fact.title + '**：' + story + rng.pick(s.fact.quips[c.style]));
      }
      for (const s of c.signatures.filter((x) => !x.fact).slice(0, 1)) {
        parts.push('**' + s.title + '**：' + safe(s.sig.note || '一种本馆尚未详细记录的乱码签名。'));
      }
      return parts.join('\n');
    }
    const unknownSig = c.signatures[0];
    if (unknownSig) {
      parts.push('**' + unknownSig.title + '**：' + safe(unknownSig.sig.note || '一种本馆尚未详细记录的乱码签名。'));
      return parts.join('\n');
    }
    const { data, lore } = easterCandidates(c);
    const pool = data.length ? data : lore;
    if (!pool.length) return null;
    const picks = rng.shuffle(pool).slice(0, c.style === 'academic' && pool.length > 1 ? 2 : 1);
    return parts.concat(picks).join('\n');
  }

  function buildClosing(c) {
    let group = voiceGroup(c, c.voice.closing);
    if (group === 'partial') group = 'restored';
    const top = c.transcodes.length ? c.transcodes[c.transcodes.length - 1] : null;
    return T(c, c.voice.closing[group], { W: top ? encName(top.W) : '那个解码器' }, 'closing');
  }

  function buildTags(c) {
    const tags = [];
    const add = (t) => { if (t && tags.indexOf(t) < 0) tags.push(t); };
    if (c.deepE) add(encName(c.deepE));
    for (const l of c.transcodes) add(encName(l.W));
    for (const l of c.layers) if (l.kind === 'unescape' && SCHEMES[l.scheme]) add(SCHEMES[l.scheme].name);
    if (c.layers.length) add(layerWord(c.layers.length));
    // no language tag when there is no language to speak of ("未知" reads like a status)
    const noLang = c.langCode === 'unknown' || /^未知/.test(c.lang) || (c.best && /^[�\s]*$/.test(c.output));
    if ((c.status !== 'irrecoverable' || c.output) && !noLang && !c.debugMemory) add(c.lang);
    add(c.debugMemory ? '调试内存' : STATUS_TAGS[c.status]);
    for (const s of c.signatures) add('名器：' + s.title);
    if (c.flags.emoji) add('emoji');
    if (c.repairs.length) add('含修复');
    return tags.map((t) => stripMarkup(t));
  }

  /* ======================================================================
   * 8. Public API
   * ==================================================================== */

  function narrate(result, opts) {
    const o = opts || {};
    const style = VOICES[o.style] ? o.style : 'humor';
    const c = buildContext(result, style, seedValue(o.seed), !!o.strict);
    const H = c.voice.headings;
    const sections = [];
    const push = (id, text) => { if (text) sections.push({ id, heading: H[id], text }); };

    push('opening', buildOpening(c));
    push('identify', buildIdentify(c));
    push('mechanism', buildMechanism(c));
    push('dating', buildDating(c));
    if (c.status !== 'clean' && c.status !== 'unknown') push('repair', buildRepair(c));
    push('conservation', buildConservation(c));
    push('easter', buildEaster(c));
    push('closing', buildClosing(c));

    const title = buildTitle(c);
    const subtitle = buildSubtitle(c);
    const plainText = [title, subtitle, '']
      .concat(sections.map((s) => '【' + s.heading + '】\n' + plainOf(s.text)).join('\n\n'))
      .join('\n');
    return {
      exhibitId: c.exhibitId,
      title,
      subtitle,
      era: { label: c.era.label, reason: stripMarkup(c.era.evidence.join('')) },
      site: c.site,
      tags: buildTags(c),
      sections,
      plainText,
      style,
      docent: { name: c.docent, styleName: c.styleInfo.name, avatar: c.styleInfo.avatar },
    };
  }

  // Compact, JSON-serialisable grounding for the LLM prompt: only facts we can
  // stand behind (real bytes from the analysis + curated history), no prose.
  function factsFor(result) {
    const c = buildContext(result, 'academic', 0, false);
    const encFacts = (id) => {
      if (!id) return null;
      const f = ENCODING_FACTS[id];
      return f ? { id, name: f.name, born: f.bornLabel, story: stripMarkup(f.story) } : { id, name: encName(id), born: null, story: null };
    };
    const layers = c.traces.map((entry) => {
      const l = entry.layer;
      const p = l.kind === 'transcode' ? pairFactsFor(l.E, l.W, l.after) : null;
      return {
        order: entry.li + 1, // formation order (1 = deepest), kept for compatibility
        formationOrder: entry.li + 1,
        layer: layerNo(c, entry.li), // contract numbering: 1 = surface (steps[0])
        kind: l.kind,
        partial: l.partial,
        trueEncoding: encFacts(l.E),
        wrongDecoder: encFacts(l.W),
        scheme: l.scheme,
        pair: p ? p.key : null,
        lossy: l.lossy,
        before: clip(l.before, 60),
        after: clip(l.after, 60),
        samples: entry.traces.slice(0, 3).map((t) => ({
          original: t.ch,
          codePoint: uplus(t.cp),
          bytes: t.hex,
          misreadAs: t.pieces.map((p2) => ({ bytes: p2.hex, char: p2.ch, crossesBoundary: !!p2.cross })),
        })),
      };
    });
    const seen = new Set();
    const pairFacts = [];
    c.pairs.forEach((p) => {
      if (seen.has(p.key)) return;
      seen.add(p.key);
      pairFacts.push({
        pair: p.key,
        generic: p.generic,
        era: p.facts.era ? [p.facts.era[0], p.facts.era[1]] : null,
        eraWhy: p.facts.eraWhy,
        habitats: p.facts.sites.slice(),
        culprits: (p.facts.culprits || []).slice(),
        tips: (p.facts.tips || []).map(stripMarkup),
      });
    });
    const recipe = c.status === 'irrecoverable' ? null : pythonRecipe(c);
    return {
      exhibitId: c.exhibitId,
      status: c.status,
      input: clip(c.input, 300),
      output: c.best ? clip(c.output, 300) : null,
      confidence: c.confidence == null ? null : Math.round(c.confidence * 100) / 100,
      label: c.best && c.best.label ? String(c.best.label) : null,
      language: c.lang,
      layers,
      era: { label: c.era.label, start: c.era.start, end: c.era.end, evidence: c.era.evidence.map(stripMarkup) },
      site: c.site,
      pairFacts,
      repairs: c.repairs.slice(0, 8).map((r) => ({
        position: isNum(r.index) && r.index >= 0 ? r.index + 1 : null,
        layer: Number.isInteger(r.step) && r.step >= 0 ? r.step + 1 : null,
        intermediate: Number.isInteger(r.step) ? r.step !== c.steps.length - 1 : false,
        from: r.from == null ? null : String(r.from),
        to: r.to == null ? null : String(r.to),
        reason: r.reason || null,
        candidates: Array.isArray(r.candidates) ? r.candidates.slice(0, 6).map(String) : [],
      })),
      signatures: c.signatures.map((s) => ({
        id: s.id,
        title: s.fact ? s.fact.title : String(s.sig.title || s.id),
        match: s.sig.match == null ? null : String(s.sig.match),
        count: s.count,
        fact: s.fact ? stripMarkup(s.fact.mechanism) : (s.sig.note ? String(s.sig.note) : null),
      })),
      fixRecipe: recipe ? stripMarkup(recipe) : null,
      alternatives: c.alternatives.slice(0, 3).map((a) => ({
        label: a.label ? String(a.label) : null,
        output: clip(a.output, 60),
        confidence: isNum(a.confidence) ? Math.round(a.confidence * 100) / 100 : null,
      })),
      signals: c.signals.slice(0, 5).map((s) => ({ type: s.type || null, match: s.match == null ? null : String(s.match), hint: s.hint || null })),
    };
  }

  const Narrator = {
    narrate,
    factsFor,
    ENCODING_FACTS,
    PAIR_FACTS,
    SIGNATURE_FACTS,
    SCHEMES,
    STYLES,
    // exposed for tests and for app.js (e.g. rendering a hex dump consistently)
    _internals: { fnv1a, mulberry32, hex, safe, stripMarkup, plainOf, utf8Layout, pairFactsFor, leadMeaning, canonicalBytes, VOICES },
  };

  MBX.Narrator = Narrator;
  if (typeof module === 'object' && module.exports) module.exports = Narrator;
})(typeof globalThis !== 'undefined' ? globalThis : this);
