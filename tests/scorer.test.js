'use strict';
// Tests for MBX.Lexicon and MBX.Scorer.
//
// The core property: for every genuine text T and every *real* wrong
// reinterpretation V of it (encode T with one encoding, decode the bytes with
// another), score(T) must beat score(V) by a clear margin. That is exactly the
// comparison the restoration engine makes, in both directions: the original
// must win when we restore mojibake, and normal input must not be "restored"
// into garbage.
//
// All transforms use the platform TextDecoder plus reverse maps derived from it
// right here, so these tests do not depend on MBX.Codecs.

const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const { Scorer, Lexicon } = MBX;

// Required gap between a genuine text and any of its mojibake variants, in
// ScoreInfo.value units (average log-likelihood per code point). ScoreInfo.value
// is length-normalised, so when a transform only touches a few characters of a
// long, mostly-ASCII text ("... springt über den ...") the average necessarily
// moves by (per-character gap × changed / length). The margin is therefore
// MARGIN per *affected* code point: the full MARGIN for CJK/Cyrillic text and
// for UTF-16 reinterpretations (every character changes), proportionally less
// when only the non-ASCII characters of a Latin text change.
const MARGIN = 0.5;

function requiredGap(original, via) {
  const chars = [...original];
  if (via.startsWith('utf-16le')) return MARGIN;
  const changed = chars.filter((ch) => ch.codePointAt(0) >= 0x80).length;
  return MARGIN * Math.min(1, changed / chars.length);
}

// ---------------------------------------------------------------------------
// Corpus of genuine texts. `lang` is the expected detectLang() result (an array
// lists acceptable answers; null = not checked).
// ---------------------------------------------------------------------------

const CORPUS = [
  // Simplified Chinese: short words, sentences, a long paragraph.
  { id: 'zh-nihao', text: '你好', lang: 'zh-Hans' },
  { id: 'zh-dajiahao', text: '大家好', lang: 'zh-Hans' },
  { id: 'zh-zhongwen', text: '中文', lang: 'zh-Hans' },
  { id: 'zh-shijie', text: '世界', lang: 'zh-Hans' },
  { id: 'zh-xiexie', text: '谢谢', lang: 'zh-Hans' },
  { id: 'zh-weather', text: '今天天气很好，我们一起去公园散步吧！', lang: 'zh-Hans' },
  { id: 'zh-server', text: '这个问题已经解决了，请重新启动服务器。', lang: 'zh-Hans' },
  { id: 'zh-beijing', text: '北京是中华人民共和国的首都。', lang: 'zh-Hans' },
  { id: 'zh-hongloumeng', text: '《红楼梦》是中国古典小说的巅峰之作，作者曹雪芹。', lang: 'zh-Hans' },
  {
    id: 'zh-paragraph',
    text: '字符编码是计算机存储和传输文字的基础。当一段文字用一种编码写入，却用另一种编码读取时，就会出现乱码。' +
      '程序员们经常在调试数据库、网页和文件名时遇到这种问题，有时需要花费几个小时才能找到原因。' +
      '理解字节与字符之间的关系，是解决这类问题的关键。',
    lang: 'zh-Hans',
  },
  { id: 'zh-punct', text: '“引号”与‘单引号’——破折号……省略号。', lang: 'zh-Hans' },
  // Traditional Chinese.
  { id: 'zh-hant-sentence', text: '這是一個測試，我們說的話會被記錄下來。', lang: 'zh-Hant' },
  { id: 'zh-hant-taiwan', text: '臺灣', lang: 'zh-Hant' },
  { id: 'zh-hant-db', text: '繁體中文的資料庫編碼問題讓工程師們頭痛了很多年。', lang: 'zh-Hant' },
  // Japanese: kana-heavy and kanji-heavy.
  { id: 'ja-konnichiwa', text: 'こんにちは', lang: 'ja' },
  { id: 'ja-test', text: 'これはテストです。ありがとうございます。', lang: 'ja' },
  { id: 'ja-mojibake', text: '日本語の文字化けは本当に厄介な問題です。', lang: 'ja' },
  { id: 'ja-kanji', text: '東京都千代田区丸の内一丁目', lang: 'ja' },
  { id: 'ja-katakana', text: 'カタカナのメッセージを表示します', lang: 'ja' },
  // Korean.
  { id: 'ko-hello', text: '안녕하세요', lang: 'ko' },
  { id: 'ko-sentence', text: '한국어 문자 인코딩 문제를 해결했습니다.', lang: 'ko' },
  { id: 'ko-hanguk', text: '한국', lang: 'ko' },
  // Cyrillic, Greek, Hebrew, Arabic, Thai.
  { id: 'ru-hello', text: 'Привет, мир!', lang: 'ru' },
  { id: 'ru-pangram', text: 'Съешь же ещё этих мягких французских булок, да выпей чаю.', lang: 'ru' },
  { id: 'ru-moskva', text: 'Москва', lang: 'ru' },
  { id: 'uk-sentence', text: 'Привіт, як справи? Їжак і ґудзик.', lang: 'uk' },
  { id: 'el-hello', text: 'Καλημέρα κόσμε', lang: 'el' },
  { id: 'he-hello', text: 'שלום עולם', lang: 'he' },
  { id: 'ar-hello', text: 'مرحبا بالعالم', lang: 'ar' },
  { id: 'th-hello', text: 'สวัสดีครับ', lang: 'th' },
  // Latin-script languages.
  { id: 'fr-cafe', text: 'Le café est très chaud, à bientôt !', lang: 'fr' },
  { id: 'fr-gare', text: "Où est la gare ? Ça coûte combien d'euros ?", lang: 'fr' },
  { id: 'de-groesse', text: 'Größe und Übergröße für Mädchen', lang: 'de' },
  { id: 'de-fox', text: 'Der schnelle braune Fuchs springt über den faulen Hund.', lang: 'de' },
  { id: 'es-biblioteca', text: '¿Dónde está la biblioteca? Mañana es el cumpleaños de mi niño.', lang: 'es' },
  { id: 'pt-info', text: 'A informação não está disponível nesta região.', lang: 'pt' },
  { id: 'it-citta', text: 'Perché la città è così bella?', lang: 'it' },
  { id: 'pl-pangram', text: 'Zażółć gęślą jaźń', lang: 'pl' },
  { id: 'tr-chars', text: 'Türkçe karakterler: ş, ğ, ı, İ, ö, ü, ç', lang: 'tr' },
  { id: 'cs-pangram', text: 'Příliš žluťoučký kůň úpěl ďábelské ódy.', lang: 'cs' },
  { id: 'en-hello', text: 'Hello world', lang: 'en' },
  { id: 'en-fox', text: 'The quick brown fox jumps over the lazy dog.', lang: 'en' },
  { id: 'en-accents', text: 'A naïve résumé from the café', lang: ['en', 'fr'] },
  // Emoji, mixed technical text, code, URLs, numbers.
  { id: 'emoji-only', text: '😀👍🎉', lang: 'emoji' },
  { id: 'emoji-zh', text: '今天很开心😄🎉', lang: 'zh-Hans' },
  { id: 'emoji-zwj', text: '👨‍👩‍👧 family ❤️', lang: null },
  { id: 'mixed-react', text: '我们使用 React 18 和 TypeScript 构建前端，API 返回 JSON 格式。', lang: 'zh-Hans' },
  { id: 'mixed-python', text: '用Python写一个函数', lang: 'zh-Hans' },
  { id: 'code-js', text: 'function add(a, b) { return a + b; }', lang: null },
  { id: 'code-template', text: 'if (x > 0 && y < 10) { console.log(`ok: ${x}`); }', lang: null },
  { id: 'code-sql', text: 'SELECT * FROM users WHERE id = 42;', lang: null },
  { id: 'url', text: 'https://example.com/path?q=%E4%BD%A0&lang=zh-CN#top', lang: null },
  { id: 'numbers-zh', text: '2024-10-21 12:34:56 价格：¥1,299.00（含税）', lang: 'zh-Hans' },
  { id: 'numbers-math', text: '3.14159 + 2.71828 = 5.85987', lang: null },
];

// ---------------------------------------------------------------------------
// Real transforms, built from TextDecoder only.
// ---------------------------------------------------------------------------

const DOUBLE_BYTE = {
  gbk: { leads: [[0x81, 0xfe]], trails: [[0x40, 0x7e], [0x80, 0xfe]] },
  // Pointers below lead 0xA1 are HKSCS; the WHATWG Big5 encoder never emits them.
  big5: { leads: [[0xa1, 0xfe]], trails: [[0x40, 0x7e], [0xa1, 0xfe]] },
  // Leads 0xED/0xEE (NEC-selected IBM extensions) are skipped by the WHATWG
  // Shift_JIS encoder in favour of the IBM 0xFA-0xFC duplicates.
  shift_jis: { leads: [[0x81, 0x9f], [0xe0, 0xec], [0xef, 0xfc], [0xed, 0xee]], trails: [[0x40, 0x7e], [0x80, 0xfc]] },
  'euc-kr': { leads: [[0x81, 0xfe]], trails: [[0x41, 0x5a], [0x61, 0x7a], [0x81, 0xfe]] },
};
const SINGLE_BYTE = ['windows-1251', 'koi8-r', 'windows-1252', 'macintosh'];
const reverseCache = new Map();

function reverseMap(label) {
  if (reverseCache.has(label)) return reverseCache.get(label);
  const map = new Map();
  const dec = new TextDecoder(label);
  if (SINGLE_BYTE.includes(label)) {
    for (let b = 0x80; b <= 0xff; b++) {
      const ch = dec.decode(Uint8Array.of(b));
      if (ch !== '�' && !map.has(ch)) map.set(ch, [b]);
    }
  } else {
    const spec = DOUBLE_BYTE[label];
    // Single high bytes that decode on their own (GBK 0x80 = €, Shift_JIS half-width kana).
    for (let b = 0x80; b <= 0xff; b++) {
      const ch = dec.decode(Uint8Array.of(b));
      if (ch.length === 1 && ch !== '�' && !map.has(ch)) map.set(ch, [b]);
    }
    // One decode call per lead range; LF after every pair keeps pairs aligned.
    for (const [lo, hi] of spec.leads) {
      const pairs = [];
      for (let l = lo; l <= hi; l++) {
        for (const [tlo, thi] of spec.trails) for (let t = tlo; t <= thi; t++) pairs.push([l, t]);
      }
      const bytes = new Uint8Array(pairs.length * 3);
      pairs.forEach(([l, t], i) => { bytes[i * 3] = l; bytes[i * 3 + 1] = t; bytes[i * 3 + 2] = 0x0a; });
      const parts = dec.decode(bytes).split('\n');
      pairs.forEach((pair, i) => {
        const ch = parts[i];
        if (ch && ch !== '�' && [...ch].length === 1 && !ch.includes('�') && !map.has(ch)) map.set(ch, pair);
      });
    }
  }
  reverseCache.set(label, map);
  return map;
}

/** Encodes text with a legacy encoding; null if some character is not representable. */
function encodeLegacy(text, label) {
  const map = reverseMap(label);
  const out = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) { out.push(cp); continue; }
    const bytes = map.get(ch);
    if (!bytes) return null;
    out.push(...bytes);
  }
  return Uint8Array.from(out);
}

function decode(label, bytes) {
  return new TextDecoder(label).decode(bytes);
}

const UTF8_MISREADS = ['windows-1252', 'gbk', 'big5', 'shift_jis', 'euc-kr', 'windows-1251', 'koi8-r', 'macintosh', 'utf-16le'];
const LEGACY_ENCODINGS = ['gbk', 'big5', 'shift_jis', 'euc-kr', 'windows-1251', 'koi8-r', 'windows-1252', 'macintosh'];
const LEGACY_MISREADS = ['gbk', 'big5', 'shift_jis', 'euc-kr', 'windows-1252', 'windows-1251', 'koi8-r', 'macintosh', 'utf-8'];

/** All distinct mojibake variants of a genuine text, as [{ via, text }]. */
function variantsOf(text) {
  const out = [];
  const seen = new Set([text]);
  const add = (via, v) => {
    if (seen.has(v)) return;
    seen.add(v);
    out.push({ via, text: v });
  };
  const utf8 = Buffer.from(text, 'utf8');
  for (const wrong of UTF8_MISREADS) add(`utf-8>${wrong}`, decode(wrong, utf8));
  if (/[^\x00-\x7f]/.test(text)) {
    for (const enc of LEGACY_ENCODINGS) {
      const bytes = encodeLegacy(text, enc);
      if (!bytes) continue;
      for (const wrong of LEGACY_MISREADS) if (wrong !== enc) add(`${enc}>${wrong}`, decode(wrong, bytes));
    }
  }
  const utf16 = Buffer.from(text, 'utf16le');
  add('utf-16le>windows-1252', decode('windows-1252', utf16));
  add('utf-16le>utf-8', decode('utf-8', utf16));
  return out;
}

// ---------------------------------------------------------------------------
// Lexicon
// ---------------------------------------------------------------------------

test('Lexicon: inline data meets the minimum sizes', () => {
  assert.ok(Lexicon.LISTS['zh-Hans'].length >= 1000, `zh-Hans ${Lexicon.LISTS['zh-Hans'].length}`);
  const tradOnly = Lexicon.LISTS['zh-Hant'].filter((c) => !(Lexicon.flagsOf(c) & (Lexicon.FLAGS.GB1 | Lexicon.FLAGS.GB2)));
  assert.ok(tradOnly.length >= 500, `traditional-only forms ${tradOnly.length}`);
  assert.ok(Lexicon.LISTS.ko.length >= 300, `hangul ${Lexicon.LISTS.ko.length}`);
  assert.ok(Lexicon.LISTS.ko.every((c) => Lexicon.isHangulCode(c.codePointAt(0))), 'ko list holds only syllables');
  assert.ok(new Set(Lexicon.EN_WORDS).size >= 300, 'english words');
  for (const lang of ['fr', 'de', 'es', 'pt', 'it', 'pl', 'tr', 'cs', 'ru', 'uk', 'el']) {
    assert.ok(Lexicon.WORDS[lang] && Lexicon.WORDS[lang].length >= 20, `word list ${lang}`);
  }
  assert.equal(Object.keys(Lexicon.RU_LETTER_FREQ).length, 33, 'russian alphabet');
  assert.equal(Lexicon.EN_BIGRAM_ROWS.length, 26, 'bigram rows');
  for (const row of Lexicon.EN_BIGRAM_ROWS) assert.ok(/^[0-3]{26}$/.test(row.replace(/\s/g, '')), `bigram row ${row}`);
  assert.equal(Lexicon.bigramClass('q', 'u'), 3);
  assert.equal(Lexicon.bigramClass('Q', 'x'), 0);
  assert.equal(Lexicon.bigramClass('t', 'h'), 3);
});

test('Lexicon: frequency lists are ordered and duplicate-free', () => {
  const hans = Lexicon.LISTS['zh-Hans'];
  assert.equal(hans[0], '的');
  assert.equal(new Set(hans).size, hans.length);
  assert.ok(hans.indexOf('是') < hans.indexOf('界'), '是 before 界');
  assert.ok(Lexicon.LISTS['zh-Hant'].slice(0, 5).includes('們'), '們 near the top');
  assert.deepEqual(Lexicon.rankOf('的'), { list: 'zh-Hans', rank: 0 });
  assert.equal(Lexicon.rankOf('們').list, 'zh-Hant');
  assert.equal(Lexicon.rankOf('a'), null);
  assert.deepEqual(Lexicon.wordLangs('the'), ['en']);
  assert.ok(Lexicon.wordLangs('Привет').includes('ru'));
  assert.ok(Lexicon.isZhPair('世', '界') && Lexicon.isZhPair('數', '據'), 'frequent word pairs');
  assert.ok(!Lexicon.isZhPair('界', '世'), 'pairs are ordered');
  assert.ok(Lexicon.RU_PAIRS.has('с'.charCodeAt(0) * 0x10000 + 'т'.charCodeAt(0)), 'ст is a typical Russian pair');
});

test('Lexicon: runtime-derived charset blocks have their documented sizes', () => {
  const F = Lexicon.FLAGS;
  const count = (bit, from, to) => {
    let n = 0;
    for (let cp = from; cp <= to; cp++) if (Lexicon.flagsOf(cp) & bit) n++;
    return n;
  };
  assert.equal(count(F.GB1, 0x4e00, 0x9fff), 3755, 'GB2312 level 1');
  assert.equal(count(F.GB2, 0x4e00, 0x9fff), 3008, 'GB2312 level 2');
  assert.equal(count(F.J1, 0x4e00, 0x9fff), 2965, 'JIS level 1');
  assert.equal(count(F.B5C, 0x4e00, 0x9fff), 5401, 'Big5 common');
  assert.equal(count(F.KS, 0xac00, 0xd7a3), 2350, 'KS X 1001 hangul');
});

test('Lexicon: tierOf ranks Han and Hangul sensibly', () => {
  assert.equal(Lexicon.tierOf('的'), 0);
  assert.equal(Lexicon.tierOf('們'), 0);
  assert.equal(Lexicon.tierOf('가'), 0);
  assert.equal(Lexicon.tierOf('힣'), 4, 'not in KS X 1001');
  assert.ok(Lexicon.tierOf('畍') > Lexicon.tierOf('界'));
  assert.ok(Lexicon.tierOf('奿') >= 2);
  assert.equal(Lexicon.tierOf('㐀'), 4, 'extension A');
  assert.equal(Lexicon.tierOf('𠀀'), 5, 'extension B');
  assert.equal(Lexicon.tierOf('a'), -1);
  assert.equal(Lexicon.hanVariant('们'), 'simplified');
  assert.equal(Lexicon.hanVariant('們'), 'traditional');
  assert.equal(Lexicon.hanVariant('中'), 'shared');
});

// ---------------------------------------------------------------------------
// Scorer: the core property
// ---------------------------------------------------------------------------

test('Scorer: corpus is large and every variant is a real transform', () => {
  assert.ok(CORPUS.length >= 45, `corpus has ${CORPUS.length} texts`);
  // Spot-check the transform helpers against well-known mojibake.
  assert.equal(decode('windows-1252', Buffer.from('大家好', 'utf8')), 'å¤§å®¶å¥½');
  assert.equal(decode('windows-1251', Buffer.from('Привет', 'utf8')), 'РџСЂРёРІРµС‚');
  assert.equal(decode('windows-1252', encodeLegacy('你好', 'gbk')), 'ÄãºÃ');
  assert.equal(decode('big5', encodeLegacy('大家好', 'big5')), '大家好');
  assert.equal(decode('windows-1252', Buffer.from('你好', 'utf16le')), '`O}Y');
});

test('Scorer: genuine text beats every mojibake variant by the margin', () => {
  const failures = [];
  const gaps = [];
  for (const item of CORPUS) {
    const original = Scorer.score(item.text).value;
    for (const v of variantsOf(item.text)) {
      const value = Scorer.score(v.text).value;
      const gap = original - value;
      const need = requiredGap(item.text, v.via);
      gaps.push({ id: item.id, via: v.via, gap, need, slack: gap - need, variant: v.text });
      if (!(gap > need)) {
        failures.push(`${item.id} vs ${v.via}: ${original.toFixed(2)} vs ${value.toFixed(2)} (need ${need.toFixed(2)}) ${JSON.stringify(v.text.slice(0, 40))}`);
      }
    }
  }
  gaps.sort((a, b) => a.slack - b.slack);
  const minGap = Math.min(...gaps.map((g) => g.gap));
  const tight = gaps.slice(0, 5).map((g) => `${g.id} ${g.via} gap=${g.gap.toFixed(3)} need=${g.need.toFixed(3)} ${JSON.stringify(g.variant.slice(0, 24))}`);
  if (process.env.MBX_VERBOSE) console.log(`  [scorer] ${gaps.length} pairs, min gap ${minGap.toFixed(3)}, min slack ${gaps[0].slack.toFixed(3)}\n    ${tight.join('\n    ')}`);
  assert.ok(gaps.length >= 500, `only ${gaps.length} pairs`);
  assert.ok(minGap > 0, 'the genuine text always wins outright');
  assert.ok(!failures.length, `${failures.length} pairs within the required margin:\n    ${failures.slice(0, 40).join('\n    ')}`);
});

// Every single-step candidate the engine would generate from an input: encode
// with W (strictly), decode with E. Results with decoding errors are dropped,
// as the engine does.
const ENGINE_ENCODINGS = ['utf-8', 'windows-1252', 'macintosh', 'windows-1251', 'koi8-r', 'gbk', 'big5', 'shift_jis', 'euc-kr'];
function encodeStrict(label, text) {
  return label === 'utf-8' ? Buffer.from(text, 'utf8') : encodeLegacy(text, label);
}
function candidatesOf(input) {
  const out = new Map();
  for (const w of ENGINE_ENCODINGS) {
    const bytes = encodeStrict(w, input);
    if (!bytes) continue;
    for (const e of ENGINE_ENCODINGS) {
      if (e === w) continue;
      const text = decode(e, bytes);
      if (text.includes('�') || text === input) continue;
      if (!out.has(text)) out.set(text, `${w}>${e}`);
    }
  }
  return out;
}

// Classic exhibits (docs/ARCHITECTURE.md §8): [original, trueEncoding, wrongDecoder].
const CLASSICS = [
  ['大家好', 'utf-8', 'windows-1252'],
  ['乱码考古学家', 'utf-8', 'windows-1252'],
  ['编码问题', 'utf-8', 'gbk'],
  ['你好', 'gbk', 'windows-1252'],
  ['中文测试', 'gbk', 'windows-1252'],
  ['こんにちは', 'utf-8', 'shift_jis'],
  ['こんにちは', 'shift_jis', 'windows-1252'],
  ['Привет', 'utf-8', 'windows-1251'],
  ['Привет, как дела?', 'koi8-r', 'windows-1251'],
  ['Привет, как дела?', 'windows-1251', 'koi8-r'],
  ['大家好', 'big5', 'windows-1252'],
  ['繁體中文', 'big5', 'gbk'],
  ['简体中文', 'gbk', 'big5'],
  ['日本語のテキスト', 'shift_jis', 'gbk'],
  ['안녕하세요', 'euc-kr', 'windows-1252'],
  ['café crème brûlée', 'utf-8', 'macintosh'],
  ['Größe', 'utf-8', 'windows-1252'],
  ['Καλημέρα', 'utf-8', 'windows-1252'],
];

test('Scorer: the true original tops every single-step candidate of classic mojibake', () => {
  const problems = [];
  for (const [original, trueEnc, wrong] of CLASSICS) {
    const bytes = encodeStrict(trueEnc, original);
    const relic = decode(wrong, bytes);
    assert.ok(!relic.includes('�'), `${original} ${trueEnc}>${wrong} is lossless`);
    const cands = candidatesOf(relic);
    assert.ok(cands.has(original), `${original}: the engine's own transform reaches it`);
    const ranked = [...cands.keys()].map((t) => [t, Scorer.score(t).value]).sort((a, b) => b[1] - a[1]);
    const relicScore = Scorer.score(relic).value;
    const best = ranked[0];
    if (best[0] !== original) problems.push(`${original} (${trueEnc}>${wrong}): best is ${JSON.stringify(best[0])} via ${cands.get(best[0])} ${best[1].toFixed(2)} vs ${Scorer.score(original).value.toFixed(2)}`);
    if (!(Scorer.score(original).value > relicScore + 0.5)) problems.push(`${original}: relic ${JSON.stringify(relic)} ${relicScore.toFixed(2)}`);
  }
  assert.ok(!problems.length, problems.join('\n    '));
});

test('Scorer: regressions found by an out-of-corpus sweep', () => {
  const wins = (original, other, label) => {
    const a = Scorer.score(original).value;
    const b = Scorer.score(other).value;
    assert.ok(a > b, `${label}: ${JSON.stringify(original)} ${a} should beat ${JSON.stringify(other)} ${b}`);
  };
  // ALL-CAPS Russian must not lose to its (all-lowercase) KOI8-R <-> Windows-1251 swap.
  const headline = 'ВНИМАНИЕ: СИСТЕМА ПЕРЕГРУЖЕНА';
  wins(headline, decode('koi8-r', encodeLegacy(headline, 'windows-1251')), '1251>koi8');
  wins(headline, decode('windows-1251', encodeLegacy(headline, 'koi8-r')), 'koi8>1251');
  // A two-Hanzi word read as UTF-16LE can look like a lowercase ASCII word.
  wins('数据', decode('windows-1252', Buffer.from('数据', 'utf16le')), 'utf-16le>1252');
  // Lone foreign letters glued into Latin words.
  wins('naïve coöperation', decode('windows-1252', encodeLegacy('naïve coöperation', 'macintosh')), 'mac>1252');
  // Real short ASCII words are unaffected by the short-token rule.
  assert.ok(Scorer.score('hello').value > -2, 'hello');
});

test('Scorer: two-layer mojibake scores below one layer', () => {
  for (const text of ['大家好', 'Привет', 'café', '日本語']) {
    const one = decode('windows-1252', Buffer.from(text, 'utf8'));
    const two = decode('windows-1252', Buffer.from(one, 'utf8'));
    const [s0, s1, s2] = [text, one, two].map((t) => Scorer.score(t).value);
    assert.ok(s0 > s1 && s1 > s2 - 0.3, `${text}: ${s0} / ${s1} / ${s2}`);
  }
});

test('Scorer: genuine texts look normal (no mojibake flags, sane value)', () => {
  const badFlags = ['fffd', 'c1', 'control', 'pua', 'surrogate', 'half-kana', 'mojibake-pattern', 'case-flip'];
  for (const item of CORPUS) {
    const s = Scorer.score(item.text);
    assert.ok(s.value > -3.6, `${item.id} value ${s.value}`);
    const bad = s.flags.filter((f) => badFlags.includes(f));
    assert.ok(!bad.length, `${item.id} flags ${bad}`);
  }
});

test('Scorer: ScoreInfo shape and normalisation', () => {
  const s = Scorer.score('Hello world');
  for (const key of ['value', 'total', 'length', 'lang', 'script', 'badness', 'flags']) assert.ok(key in s, key);
  assert.equal(s.length, 11);
  assert.ok(Math.abs(s.value - s.total / s.length) < 0.01, 'value = total / length');
  assert.equal(Scorer.score('😀').length, 1, 'astral characters count once');
  const empty = Scorer.score('');
  assert.equal(empty.length, 0);
  assert.ok(empty.value < -10);
  const short = Scorer.score('你好').value;
  const long = Scorer.score('你好'.repeat(50)).value;
  assert.ok(Math.abs(short - long) < 0.05, 'length-normalised');
  const garbage = Scorer.score('a�\u0081b');
  for (const f of ['fffd', 'c1', 'pua']) assert.ok(garbage.flags.includes(f), f);
  assert.ok(garbage.badness > 3);
  assert.equal(Scorer.score('Hello').badness, 0);
});

test('Scorer: charScore ranks repair candidates sensibly', () => {
  const better = (a, b) => assert.ok(Scorer.charScore(a) > Scorer.charScore(b), `${a} (${Scorer.charScore(a)}) > ${b} (${Scorer.charScore(b)})`);
  better('界', '畍');
  better('界', '畎');
  better('好', '奿');
  better('的', '界');
  better('”', '‱');
  better('’', '‗');
  better('”', '⁇');
  better('é', 'Ã');
  better('é', '\u0081');
  better('가', '힣');
  better('あ', 'ｱ');
  better('e', 'q');
  better('а', 'ђ');
  better('😀', '');
  assert.ok(Scorer.charScore('�') <= -9);
  assert.equal(typeof Scorer.charScore('𠀀'), 'number');
});

// ---------------------------------------------------------------------------
// detectLang / mojibakeSignals / performance
// ---------------------------------------------------------------------------

test('Scorer: detectLang identifies every corpus language', () => {
  const wrong = [];
  for (const item of CORPUS) {
    if (!item.lang) continue;
    const r = Scorer.detectLang(item.text);
    const ok = Array.isArray(item.lang) ? item.lang.includes(r.lang) : r.lang === item.lang;
    if (!ok) wrong.push(`${item.id}: expected ${item.lang}, got ${r.lang}`);
    assert.equal(r.name, Scorer.LANG_NAMES[r.lang]);
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
  }
  assert.ok(!wrong.length, wrong.join('; '));
  assert.equal(Scorer.detectLang('').lang, 'unknown');
  assert.equal(Scorer.detectLang('Привет мир, как дела? Hello world, how are you?').lang, 'mixed');
  assert.equal(Scorer.detectLang('简体中文').name, '简体中文');
});

test('Scorer: mojibakeSignals spots the classic patterns', () => {
  const has = (text, type) => {
    const sig = Scorer.mojibakeSignals(text);
    assert.ok(sig.some((s) => s.type === type), `${type} in ${JSON.stringify(text)}: ${sig.map((s) => s.type)}`);
    for (const s of sig) {
      assert.equal(text.slice(s.index, s.index + s.match.length), s.match, 'match/index agree');
      assert.ok(typeof s.hint === 'string' && s.hint.length > 0, 'hint');
    }
  };
  has('å¤§å®¶å¥½', 'utf8-as-1252');
  has('cafÃ©', 'utf8-as-1252');
  has('donâ€™t', 'utf8-as-1252');
  has('ï»¿Hello', 'bom');
  has('ÿþH', 'utf16-bom');
  has(decode('gbk', Buffer.from('你好，世界的中文', 'utf8')), 'utf8-as-gbk');
  has(decode('shift_jis', Buffer.from('こんにちは', 'utf8')), 'utf8-as-sjis');
  has(decode('shift_jis', Buffer.from('こんにちは', 'utf8')), 'half-width-kana');
  has('РџСЂРёРІРµС‚', 'utf8-as-1251');
  has(decode('windows-1252', encodeLegacy('こんにちは', 'shift_jis')), 'sjis-as-1252');
  has(decode('macintosh', Buffer.from('café', 'utf8')), 'utf8-as-mac');
  has(decode('windows-1252', encodeLegacy('你好世界', 'gbk')), 'latin1-run');
  has(decode('koi8-r', encodeLegacy('Привет, как дела у тебя?', 'windows-1251')), 'cyrillic-case');
  has('锟斤拷锟斤拷', 'kunjinkao');
  has('嚙踝蕭', 'kunjinkao-big5');
  has('烫烫烫', 'tangtang');
  has('屯屯屯', 'tuntun');
  has('a�b', 'fffd');
  has('a\u0081b', 'c1');
  has('H\u0000e\u0000', 'control');
  has('', 'pua');
  has('???? ??', 'question-marks');
});

test('Scorer: mojibakeSignals stays silent on genuine text', () => {
  for (const item of CORPUS) {
    const sig = Scorer.mojibakeSignals(item.text);
    assert.equal(sig.length, 0, `${item.id}: ${sig.map((s) => `${s.type}:${s.match}`).join(', ')}`);
  }
});

test('Scorer: 10k characters score in under 20ms after warm-up', () => {
  const chunk = CORPUS.map((c) => c.text).join(' ');
  let text = '';
  while (text.length < 10000) text += chunk + '\n';
  text = text.slice(0, 10000);
  const garbage = decode('windows-1252', Buffer.from(text, 'utf8')).slice(0, 10000);
  Scorer.score(text);
  Scorer.score(garbage);
  for (const t of [text, garbage]) {
    const runs = 10;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < runs; i++) Scorer.score(t);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
    assert.ok(ms < 20, `average ${ms.toFixed(2)}ms`);
  }
});
