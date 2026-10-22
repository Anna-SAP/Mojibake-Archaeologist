'use strict';
// i18n of the core modules (docs/ARCHITECTURE.md §11.3): Codecs, Scorer, Engine and Forge text in
// zh-CN and en-US. The search must not care about the language: only text fields may differ.

const { test, assert, loadAll } = require('./harness');
const MBX = loadAll();
const C = MBX.Codecs;
const S = MBX.Scorer;
const E = MBX.Engine;
const F = MBX.Forge;

const EN = { locale: 'en-US' };
const ZH = { locale: 'zh-CN' };
const B = '\\';

// Han, kana, Hangul, CJK punctuation and full-/half-width forms (U+FFFD is not among them).
const CJK = /[⺀-⿟　-〿぀-ヿ㄀-ㇿ㐀-䶿一-鿿ꥠ-꥿가-힯豈-﫿︰-﹏＀-￯]|[\uD840-\uD87F][\uDC00-\uDFFF]/;
const HAN = /[一-鿿]/;

/** The descriptive part of an English text: quoted specimens ("锟斤拷", “Don’t panic!”) are data. */
const descriptive = (s) => String(s).replace(/"[^"]*"/g, '""').replace(/“[^”]*”/g, '“”');

function assertEnglish(text, what, data) {
  assert.ok(typeof text === 'string' && text.length > 0, `${what}: has text`);
  let rest = descriptive(text);
  for (const d of data || []) if (d) rest = rest.split(d).join('');
  assert.ok(!CJK.test(rest), `${what}: no CJK outside quoted data in ${JSON.stringify(text)}`);
}

// ---------------------------------------------------------------------------
// Inputs: every gallery relic, every preset accident, and a varied set of extra shapes
// (escapes, nested escapes, multi-layer, partial, lossy, signatures, clean, unknown, long text).
// ---------------------------------------------------------------------------

function corpus() {
  const list = F.GALLERY.map((g) => g.relic);
  for (const p of F.PRESETS) {
    const r = F.corrupt(p.sample, p.chain, p.opts);
    if (r.ok) list.push(r.output);
  }
  const mix = F.corrupt('你好', [{ encoding: 'gbk', misreadAs: 'windows-1252' }, { encoding: 'utf-8', misreadAs: 'gbk' }]);
  const koi = F.corrupt('Привет мир', [{ encoding: 'koi8-r', misreadAs: 'windows-1251' }, { encoding: 'utf-8', misreadAs: 'windows-1252' }]);
  const pct = F.escape('å¤§å®¶å¥½', 'percent');
  const longText = ('Le cafÃ© est trÃ¨s bon. ' + 'The quick brown fox jumps over the lazy dog. '.repeat(3)).repeat(12);
  return list.concat([
    mix.output, koi.output, pct.output,
    '', '   ', 'Hello world', '今天天气很好，我们去公园散步吧。', 'ÉCOLE NATIONALE', '©', '冇',
    'Ã¥Â¤Â§Ã¥Â®Â¶Ã¥Â¥Â½', 'ÃƒÂ¤Ã‚Â½Ã‚Â ',
    '%25E4%25BD%25A0%25E5%25A5%25BD', '%5Cu4f60%5Cu597d', B + 'xe4' + B + 'xbd' + B + 'xa0' + B + 'xe5' + B + 'xa5' + B + 'xbd',
    '=E4=BD=A0=E5=A5=BD', '&#20320;&#22909;', '&#x4f60;&#x597d;', 'E4 BD A0 E5 A5 BD', 'C4 E3 BA C3',
    '锟斤拷锟斤拷', '嚙踝蕭嚙踝蕭', '烫烫烫烫', '屯屯屯', '葺葺葺葺', '密码正确锟斤拷', 'ï»¿Hello', 'ÿþH\u0000i\u0000',
    'H\u0000e\u0000l\u0000l\u0000o\u0000', '????????', 'Hello ????, Name: ??', 'xq7#@!kz', '³×', 'Ã…',
    'Le cafÃ© est trÃ¨s bon, mais le café est fermé.', 'ä½ å¥', 'R�sum� caf�',
    'Thanks for the update. ' + 'a'.repeat(30) + ' cafÃ© here', 'ðŸ˜€ å¼€å¿ƒ', 'görüþmek nasýlsýnýz',
    'Szczêœliwego Nowego Roku', '–¼‘O', longText,
  ]);
}
const INPUTS = corpus();

/** Everything an analysis decides, minus the localized text fields (and the wall clock). */
function decision(r) {
  const TEXT = new Set(['label', 'name', 'title', 'note', 'hint', 'locale', 'ms']);
  return JSON.stringify(r, (k, v) => (TEXT.has(k) ? undefined : v));
}

let PAIRS = null;
function pairs() {
  if (!PAIRS) PAIRS = INPUTS.map((input) => ({ input, zh: E.analyze(input, ZH), en: E.analyze(input, EN) }));
  return PAIRS;
}

// ---------------------------------------------------------------------------
// Engine: the search is locale-independent
// ---------------------------------------------------------------------------

test('core-i18n: analyze() decides identically in zh-CN and en-US (outputs, chains, scores, confidences)', () => {
  const statuses = new Set();
  for (const { input, zh, en } of pairs()) {
    const tag = JSON.stringify(input.slice(0, 40));
    assert.equal(en.status, zh.status, `${tag} status`);
    assert.equal(decision(en), decision(zh), `${tag} same decision`);
    assert.equal(en.stats.explored, zh.stats.explored, `${tag} same search cost`);
    assert.equal(zh.locale, 'zh-CN', `${tag} zh locale`);
    assert.equal(en.locale, 'en-US', `${tag} en locale`);
    const hz = [zh.best].concat(zh.alternatives).filter(Boolean);
    const he = [en.best].concat(en.alternatives).filter(Boolean);
    assert.equal(he.length, hz.length, `${tag} same number of hypotheses`);
    he.forEach((h, k) => {
      assert.equal(h.output, hz[k].output, `${tag} output ${k}`);
      assert.equal(h.confidence, hz[k].confidence, `${tag} confidence ${k}`);
      assert.equal(h.score.value, hz[k].score.value, `${tag} score ${k}`);
      assert.deepEqual(h.steps.map((s) => [s.kind, s.wrongDecoder, s.trueEncoding, s.scheme]),
        hz[k].steps.map((s) => [s.kind, s.wrongDecoder, s.trueEncoding, s.scheme]), `${tag} chain ${k}`);
      assert.equal(h.lang.lang, hz[k].lang.lang, `${tag} language code ${k}`);
      assert.equal(h.lang.confidence, hz[k].lang.confidence, `${tag} language confidence ${k}`);
    });
    statuses.add(zh.status);
  }
  for (const s of ['restored', 'clean', 'partial', 'irrecoverable', 'unknown']) assert.ok(statuses.has(s), `corpus exercises ${s}`);
});

test('core-i18n: every gallery relic restores the same way in both languages', () => {
  for (const g of F.GALLERY) {
    const zh = E.analyze(g.relic, ZH);
    const en = E.analyze(g.relic, EN);
    assert.equal(decision(en), decision(zh), g.id);
    if (g.expect) assert.equal(en.best && en.best.output, g.expect, `${g.id} restored in en-US`);
  }
});

// ---------------------------------------------------------------------------
// Engine: en-US text fields
// ---------------------------------------------------------------------------

test('core-i18n: en-US labels, language names, signatures and hints are English', () => {
  let labels = 0;
  let sigs = 0;
  let hints = 0;
  for (const { input, zh, en } of pairs()) {
    const tag = JSON.stringify(input.slice(0, 40));
    const hz = [zh.best].concat(zh.alternatives).filter(Boolean);
    [en.best].concat(en.alternatives).filter(Boolean).forEach((h, k) => {
      // Labels carry no data at all: encoding and scheme names only.
      assertEnglish(h.label, `${tag} label ${k}`);
      assert.ok(!CJK.test(h.label), `${tag} label ${k} has no CJK: ${h.label}`);
      assert.ok(HAN.test(hz[k].label), `${tag} zh label ${k} stays Chinese: ${hz[k].label}`);
      assert.equal(h.lang.name, S.LANG_NAMES_EN[h.lang.lang], `${tag} lang name ${k}`);
      assert.equal(hz[k].lang.name, S.LANG_NAMES[hz[k].lang.lang], `${tag} zh lang name ${k}`);
      labels++;
    });
    en.signatures.forEach((s, k) => {
      const z = zh.signatures[k];
      assert.equal(s.id, z.id, `${tag} signature ${k}`);
      assert.equal(s.match, z.match, `${tag} signature match ${k}`);
      assertEnglish(s.title, `${tag} signature title ${s.id}`, [z.title]);
      assertEnglish(s.note, `${tag} signature note ${s.id}`);
      sigs++;
    });
    en.signals.forEach((s, k) => {
      assert.equal(s.type, zh.signals[k].type, `${tag} signal ${k}`);
      assert.equal(s.match, zh.signals[k].match, `${tag} signal match ${k}`);
      assertEnglish(s.hint, `${tag} signal hint ${s.type}`);
      hints++;
    });
  }
  assert.ok(labels >= 100 && sigs >= 10 && hints >= 50, `checked ${labels} labels, ${sigs} signatures, ${hints} hints`);
});

test('core-i18n: chain labels in every shape (layers, re-saves, escapes, nested escapes, repairs, partial)', () => {
  const T = (E1, W, extra) => Object.assign({ kind: 'transcode', trueEncoding: E1, wrongDecoder: W, scheme: null, repairs: [] }, extra);
  const U = (scheme, E1) => ({ kind: 'unescape', scheme, trueEncoding: E1 || null, wrongDecoder: null, repairs: [] });
  const both = (steps, partial, zh, en) => {
    assert.equal(E.chainLabel(steps, { partial, locale: 'zh-CN' }), zh);
    assert.equal(E.chainLabel(steps, { partial, locale: 'en-US' }), en);
  };
  both([T('utf-8', 'windows-1252')], false, 'UTF-8 被误读为 Windows-1252', 'UTF-8 misread as Windows-1252');
  both([T('utf-8', 'windows-1252'), T('utf-8', 'windows-1252')], false,
    'UTF-8 被误读为 Windows-1252（两层）', 'UTF-8 misread as Windows-1252 (2 layers)');
  both([T('utf-8', 'windows-1252'), T('utf-8', 'windows-1252'), T('utf-8', 'windows-1252')], false,
    'UTF-8 被误读为 Windows-1252（三层）', 'UTF-8 misread as Windows-1252 (3 layers)');
  // steps[0] is the surface layer; labels tell the story in formation order (deepest first).
  both([T('utf-8', 'gbk'), T('gbk', 'windows-1252')], false,
    'GBK 被误读为 Windows-1252，再以 UTF-8 保存后被误读为 GBK',
    'GBK misread as Windows-1252, then saved as UTF-8 and misread as GBK');
  both([T('windows-1251', 'windows-1252'), T('koi8-r', 'windows-1251')], false,
    'KOI8-R 被误读为 Windows-1251，又被误读为 Windows-1252',
    'KOI8-R misread as Windows-1251, then misread as Windows-1252');
  both([U('percent', 'utf-8')], false, 'URL 百分号编码（UTF-8 字节）', 'URL percent-encoding (UTF-8 bytes)');
  both([U('hex-dump', 'gbk')], false, '十六进制字节串（GBK 字节）', 'Hex byte string (GBK bytes)');
  both([U('html-entity')], false, 'HTML 实体', 'HTML entities');
  both([U('percent', 'utf-8'), U('unicode-escape')], false,
    'URL 百分号编码（UTF-8 字节） + \\u Unicode 转义', 'URL percent-encoding (UTF-8 bytes) + \\u Unicode escapes');
  both([U('percent', 'utf-8'), T('utf-8', 'windows-1252')], false,
    'URL 百分号编码（UTF-8 字节），内含乱码：UTF-8 被误读为 Windows-1252',
    'URL percent-encoding (UTF-8 bytes), containing mojibake: UTF-8 misread as Windows-1252');
  both([T('utf-8', 'gbk', { repairs: [{}] })], false, 'UTF-8 被误读为 GBK，修复 1 处残缺', 'UTF-8 misread as GBK, 1 gap repaired');
  both([T('utf-8', 'windows-1252', { repairs: [{}, {}] })], true,
    '局部还原：UTF-8 被误读为 Windows-1252，修复 2 处残缺', 'Partial restoration: UTF-8 misread as Windows-1252, 2 gaps repaired');
  for (const scheme of ['percent', 'hex-escape', 'quoted-printable', 'hex-dump', 'unicode-escape', 'html-entity']) {
    assert.equal(E.schemeName(scheme, 'zh-CN'), E.SCHEME_NAMES[scheme], scheme);
    assertEnglish(E.schemeName(scheme, 'en-US'), `scheme ${scheme}`);
    assert.ok(!CJK.test(E.schemeName(scheme, 'en-US')), scheme);
  }
});

test('core-i18n: real results carry the same label as chainLabel() of their steps', () => {
  for (const input of ['Ã¥Â¤Â§Ã¥Â®Â¶Ã¥Â¥Â½', '%E4%BD%A0%E5%A5%BD', '浣犲ソ锛屼笘鐣�', '脛茫潞脙']) {
    for (const opts of [ZH, EN]) {
      const r = E.analyze(input, opts);
      assert.equal(r.best.label, E.chainLabel(r.best.steps, opts), `${input} ${opts.locale}`);
    }
  }
  assert.equal(E.analyze('Ã¥Â¤Â§Ã¥Â®Â¶Ã¥Â¥Â½', EN).best.label, 'UTF-8 misread as Windows-1252 (2 layers)');
  assert.equal(E.analyze('%E4%BD%A0%E5%A5%BD', EN).best.label, 'URL percent-encoding (UTF-8 bytes)');
  assert.equal(E.analyze('浣犲ソ锛屼笘鐣�', EN).best.label, 'UTF-8 misread as GBK, 1 gap repaired');
  const partial = E.analyze('Le cafÃ© est trÃ¨s bon, mais le café est fermé.', EN);
  assert.equal(partial.status, 'partial');
  assert.ok(/^Partial restoration: /.test(partial.best.label), partial.best.label);
});

test('core-i18n: signature table in both languages', () => {
  const zh = E.signatures('zh-CN');
  const en = E.signatures('en-US');
  assert.equal(zh, E.SIGNATURES, 'zh-CN view is the original table');
  assert.equal(en.length, E.SIGNATURES.length);
  en.forEach((s, k) => {
    const z = E.SIGNATURES[k];
    assert.equal(s.id, z.id);
    assert.equal(s.glyph, z.glyph, `${s.id} glyph is data`);
    assert.equal(s.bytes, z.bytes, `${s.id} bytes are data`);
    assert.equal(s.title, z.en.title);
    assert.equal(s.note, z.en.note);
    assert.ok(HAN.test(z.note), `${s.id} zh note stays Chinese`);
    assertEnglish(s.title, `${s.id} title`, [z.title]);
    assertEnglish(s.note, `${s.id} note`);
  });
  // The famous relic keeps its name; a pronunciation helps an English visitor.
  assert.ok(en.find((s) => s.id === 'kunjinkao').title.startsWith('锟斤拷'));
  const bush = E.analyze('畂桳栠摩琠敨映捡獴', EN).signatures.find((s) => s.id === 'notepad-bush');
  assert.ok(bush && /Notepad/.test(bush.note), 'chain-revealed signature is localized too');
  const bushZh = E.analyze('畂桳栠摩琠敨映捡獴', ZH).signatures.find((s) => s.id === 'notepad-bush');
  assert.ok(bushZh && HAN.test(bushZh.note));
});

// ---------------------------------------------------------------------------
// Codecs and Scorer
// ---------------------------------------------------------------------------

test('core-i18n: every encoding has an English description; describe() picks by locale', () => {
  assert.equal(C.ENCODINGS.length, 21);
  for (const e of C.ENCODINGS) {
    assertEnglish(e.en, `${e.id} en`);
    assert.ok(!CJK.test(e.en), `${e.id}: ${e.en}`);
    assert.ok(HAN.test(e.zh), `${e.id} zh stays Chinese`);
    assert.equal(C.describe(e.id, 'en-US'), e.en);
    assert.equal(C.describe(e.id.toUpperCase(), { locale: 'en' }), e.en);
    assert.equal(C.describe(e.id, 'zh-CN'), e.zh);
    assert.equal(C.get(e.id).en, e.en);
  }
  assert.equal(C.describe('windows-1252', 'en-US'), 'Western European (Windows-1252)');
  assert.equal(C.describe('gbk', 'en-US'), 'Simplified Chinese (GBK / GB18030)');
  assert.equal(C.describe('shift_jis', 'en-US'), 'Japanese (Shift_JIS)');
  assert.equal(C.describe('iso-8859-1', 'en-US'), 'True Latin-1 (bytes = code points)');
  assert.equal(C.describe('cp437', 'en-US'), 'IBM PC / DOS (US), the default for ZIP file names');
  assert.equal(C.describe('utf-16le', 'en-US'), 'Windows "Unicode" (UTF-16LE)');
  assert.equal(C.describe('no-such-encoding', 'en-US'), undefined);
  assert.equal(C.describe(null), undefined);
});

test('core-i18n: language names and detectLang() in both languages', () => {
  const codes = Object.keys(S.LANG_NAMES);
  assert.equal(codes.length, 23);
  assert.deepEqual(Object.keys(S.LANG_NAMES_EN).sort(), codes.slice().sort(), 'same language codes');
  for (const code of codes) {
    assert.ok(!CJK.test(S.LANG_NAMES_EN[code]), code);
    assert.equal(S.langName(code, 'en-US'), S.LANG_NAMES_EN[code]);
    assert.equal(S.langName(code, 'zh-CN'), S.LANG_NAMES[code]);
  }
  assert.equal(S.langName('zh-Hans', 'en'), 'Simplified Chinese');
  assert.equal(S.langName('latin', 'en'), 'Latin script');
  assert.equal(S.langName('unknown', 'en'), 'Unknown');
  assert.equal(S.langName('xx', 'en'), 'xx', 'unrecognised codes pass through');
  for (const text of ['简体中文', '繁體中文的文字', 'こんにちは世界', '안녕하세요', 'Привет мир', 'Hello world, how are you?', '🎉😀', '']) {
    const zh = S.detectLang(text);
    const en = S.detectLang(text, EN);
    assert.equal(en.lang, zh.lang, text);
    assert.equal(en.confidence, zh.confidence, text);
    assert.equal(zh.name, S.LANG_NAMES[zh.lang], text);
    assert.equal(en.name, S.LANG_NAMES_EN[en.lang], text);
  }
  assert.deepEqual(S.detectLang('简体中文', ZH), { lang: 'zh-Hans', name: '简体中文', confidence: S.detectLang('简体中文').confidence });
});

test('core-i18n: every mojibake signal type has an English hint', () => {
  const types = ['bom', 'utf16-bom', 'utf8-as-1252', 'utf8-as-1251', 'utf8-as-mac', 'sjis-as-1252', 'utf8-as-gbk', 'utf8-as-sjis',
    'half-width-kana', 'cyrillic-case', 'latin1-run', 'cp1254-as-1252', 'cp1250-as-1252', 'kunjinkao', 'kunjinkao-big5', 'tangtang',
    'tuntun', 'fffd', 'c1', 'control', 'pua', 'question-marks'];
  assert.deepEqual(Object.keys(S.SIGNAL_HINTS_EN).sort(), types.slice().sort(), 'hint table covers every documented type');
  for (const type of types) {
    assertEnglish(S.signalHint(type, 'en-US'), `hint ${type}`);
    assert.ok(HAN.test(S.signalHint(type, 'zh-CN')), `zh hint ${type} stays Chinese`);
  }
  for (const text of ['å¤§å®¶å¥½ â€™', 'РџСЂРёРІРµС‚', 'caf√©', '‚±‚ñ‚É‚¿‚Í', '浣犲ソ锛屼笘鐣', '縺薙ｓ縺ｫ縺｡縺ｯ', 'рТЙЧЕФ',
    'ÄãºÃ£¬ÊÀ½ç', 'görüþmek', 'siê', '锟斤拷 嚙踝蕭 烫烫 屯屯 � \u0085 \u0001\u0002  ????', 'ï»¿x', 'ÿþx']) {
    const zh = S.mojibakeSignals(text);
    const en = S.mojibakeSignals(text, EN);
    assert.equal(en.length, zh.length, text);
    en.forEach((s, k) => {
      assert.deepEqual([s.type, s.match, s.index], [zh[k].type, zh[k].match, zh[k].index], text);
      assert.equal(s.hint, S.SIGNAL_HINTS_EN[s.type]);
      assert.equal(zh[k].hint, S.signalHint(zh[k].type, 'zh-CN'));
    });
  }
});

// ---------------------------------------------------------------------------
// Forge
// ---------------------------------------------------------------------------

test('core-i18n: gallery() and presets() localize the text and never touch the data', () => {
  const g = F.gallery('en-US');
  assert.equal(g.length, F.GALLERY.length);
  g.forEach((item, k) => {
    const orig = F.GALLERY[k];
    assert.ok(item !== orig, 'a copy, not the original');
    for (const key of Object.keys(orig)) {
      if (key === 'title' || key === 'blurb') continue;
      assert.deepEqual(item[key], orig[key], `${orig.id}.${key} unchanged`);
    }
    assert.equal(item.title, orig.en.title);
    assert.equal(item.blurb, orig.en.blurb);
    assertEnglish(item.title, `${orig.id} title`);
    assertEnglish(item.blurb, `${orig.id} blurb`);
    assert.ok(HAN.test(orig.title) && HAN.test(orig.blurb), `${orig.id} zh text untouched`);
  });
  const p = F.presets('en');
  assert.equal(p.length, F.PRESETS.length);
  p.forEach((item, k) => {
    const orig = F.PRESETS[k];
    for (const key of Object.keys(orig)) {
      if (key === 'name' || key === 'story') continue;
      assert.deepEqual(item[key], orig[key], `${orig.id}.${key} unchanged`);
    }
    assert.equal(item.name, orig.en.name);
    assertEnglish(item.name, `${orig.id} name`);
    assertEnglish(item.story, `${orig.id} story`);
    assert.ok(item.name.includes('→'), `${orig.id} name keeps the chain arrow`);
  });
  // zh-CN copies keep the original text.
  assert.deepEqual(F.gallery('zh-CN').map((x) => [x.title, x.blurb]), F.GALLERY.map((x) => [x.title, x.blurb]));
  assert.deepEqual(F.presets('zh-CN').map((x) => [x.name, x.story]), F.PRESETS.map((x) => [x.name, x.story]));
  assert.equal(F.GALLERY[0].title, '「大家好」· 西欧误读型', 'the original list is not mutated');
});

test('core-i18n: English gallery copy: curly-quoted specimen titles and byte counts that add up', () => {
  for (const g of F.GALLERY) {
    // The specimen (or the original text) in curly quotes, a middle dot, then the exhibit name.
    assert.ok(/^“[^”]+” · [A-Z]/.test(g.en.title), `${g.id} title shape: ${g.en.title}`);
    assert.ok(!/"/.test(g.en.title), `${g.id} title has no straight quotes`);
    // "… is N bytes long in UTF-8" must be true of the quoted text.
    const m = /"([^"]+)" is (\d+) bytes long in UTF-8/.exec(g.en.blurb);
    if (m) assert.equal(Buffer.byteLength(m[1], 'utf8'), Number(m[2]), `${g.id} byte count`);
  }
  const lossy = F.GALLERY.find((g) => g.id === 'nihao-gbk-lossy');
  assert.ok(/is 15 bytes long in UTF-8/.test(lossy.en.blurb), 'the odd byte count is explained');
  // The 1252 trait also fires on GBK / EUC-KR read as Windows-1252: it must not insist on UTF-8.
  for (const relic of ['ÄãºÃ£¬ÊÀ½ç', '¾È³çÇÏ¼¼¿ä']) {
    const r = E.analyze(relic, EN);
    assert.ok(!/UTF-8/.test(r.best.label), `${relic}: ${r.best.label}`);
    for (const s of r.signals.filter((x) => x.type === 'utf8-as-1252')) {
      assert.ok(!/^The telltale shape of UTF-8/.test(s.hint), `${relic}: hint does not claim UTF-8: ${s.hint}`);
    }
  }
});

test('core-i18n: corrupt() and escape() errors follow opts.locale', () => {
  const bad = [{ encoding: 'windows-1252', misreadAs: 'utf-8' }];
  const zh = F.corrupt('大', bad);
  const en = F.corrupt('大', bad, EN);
  assert.equal(zh.ok, false);
  assert.equal(zh.error, '第 1 层：字符「大」（U+5927，第 1 个字符）无法用 Windows-1252 编码，这种事故在现实中不会以这种方式发生。');
  assert.equal(en.layerIndex, zh.layerIndex);
  assert.equal(en.error, 'Layer 1: the character "大" (U+5927, character 1) cannot be encoded in Windows-1252, so this accident could not happen this way in real life.');
  const cases = [
    [42, bad], ['x', []], ['x', [{ encoding: 'nope', misreadAs: 'gbk' }]], ['x', [{ encoding: 'gbk', misreadAs: 'nope' }]],
    ['x', [{ encoding: 'gbk', misreadAs: 'GBK' }]],
  ];
  for (const [text, chain] of cases) {
    const z = F.corrupt(text, chain, ZH);
    const e = F.corrupt(text, chain, EN);
    assert.equal(z.ok, false);
    assert.equal(e.layerIndex, z.layerIndex);
    assert.ok(HAN.test(z.error), z.error);
    assertEnglish(e.error, `corrupt error ${JSON.stringify(chain)}`);
  }
  assertEnglish(F.escape('大', 'percent', { encoding: 'windows-1252', locale: 'en-US' }).error, 'escape error');
  assertEnglish(F.escape('x', 'rot13', EN).error, 'escape scheme error');
  assert.equal(F.escape('x', 'rot13').error, '不支持的转义方式「rot13」。');
  // Successful forgeries are the same in every language.
  const p = F.PRESETS[0];
  assert.equal(F.corrupt(p.sample, p.chain, EN).output, F.corrupt(p.sample, p.chain).output);
});

// ---------------------------------------------------------------------------
// Locale resolution: explicit tag > MBX.I18n current language > zh-CN, read at call time
// ---------------------------------------------------------------------------

// The locale every core entry point used for one tag ('en-US' / 'zh-CN'), as { where: locale }.
function probeLocales(tag) {
  const o = { locale: tag };
  const of = (en) => (en ? 'en-US' : 'zh-CN');
  const r = E.analyze('cafÃ©', o);
  return {
    'Engine.analyze': r.locale,
    'Engine.analyze label': of(r.best.label === 'UTF-8 misread as Windows-1252'),
    'Engine.chainLabel': of(E.chainLabel(r.best.steps, o) === 'UTF-8 misread as Windows-1252'),
    'Engine.schemeName': of(E.schemeName('percent', tag) === 'URL percent-encoding'),
    'Engine.signatures': of(E.signatures(tag) === E.signatures('en-US')),
    'Scorer.langName': of(S.langName('ja', tag) === 'Japanese'),
    'Scorer.detectLang': of(S.detectLang('Привет, как дела?', o).name === 'Russian'),
    'Scorer.mojibakeSignals': of(!HAN.test(S.mojibakeSignals('cafÃ©', o)[0].hint)),
    'Scorer.signalHint': of(S.signalHint('utf8-as-1252', tag) === S.SIGNAL_HINTS_EN['utf8-as-1252']),
    'Codecs.describe': of(C.describe('euc-jp', tag) === 'Japanese Unix (EUC-JP)'),
    'Forge.gallery': of(F.gallery(tag)[0].title === F.GALLERY[0].en.title),
    'Forge.presets': of(F.presets(tag)[0].name === F.PRESETS[0].en.name),
    'Forge.corrupt': of(!HAN.test(F.corrupt('x', [], o).error)),
    'Forge.escape': of(!HAN.test(F.escape('x', 'rot13', o).error)),
    // Narrator and LLM follow the same rule (they resolve the locale with their own copy of it).
    'Narrator.styles': of(!HAN.test(MBX.Narrator.styles(tag)[0].name)),
    'Narrator.narrate': of(!HAN.test(MBX.Narrator.narrate(r, { style: 'humor', seed: 0, locale: tag }).title)),
    'LLM.listProviders': of(!HAN.test(MBX.LLM.listProviders(tag)[0].name)),
    'LLM.buildPrompt': of(MBX.LLM.buildPrompt(r, null, null, 'humor', o).system.startsWith('You are the ')),
  };
}

function assertLocales(tag, want, why) {
  const got = probeLocales(tag);
  for (const where of Object.keys(got)) assert.equal(got[where], want, `${where} for ${JSON.stringify(tag)} (${why})`);
}

// Supported tags pick their language whatever the UI shows (I18n.normalize: trimmed, '_' or '-').
const SUPPORTED = [['en', 'en-US'], ['EN-gb', 'en-US'], ['en-US', 'en-US'], [' en ', 'en-US'], ['en_us', 'en-US'],
  ['zh', 'zh-CN'], ['zh-TW', 'zh-CN'], ['zh-Hans', 'zh-CN'], [' zh_HK ', 'zh-CN'], ['ZH-cn', 'zh-CN']];
// Anything else is no language choice at all: the current UI language applies.
const UNSUPPORTED = ['fr-FR', 'ja', 'ja-JP', 'english', 'eng', 'zhongwen', '', '   ', null, undefined, 123, {}];

function withI18n(stub, fn) {
  const saved = MBX.I18n;
  if (stub === undefined) delete MBX.I18n;
  else MBX.I18n = stub;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete MBX.I18n;
    else MBX.I18n = saved;
  }
}

test('core-i18n: locale tags follow I18n.resolve: supported tags win, anything else is the UI language', () => {
  const I = MBX.I18n;
  if (!I || typeof I.resolve !== 'function' || typeof I.setLocale !== 'function') return; // src/i18n.js not present
  const before = I.getLocale();
  try {
    for (const current of ['zh-CN', 'en-US']) {
      I.setLocale(current);
      for (const [tag, want] of SUPPORTED) {
        assert.equal(I.resolve({ locale: tag }), want, `I18n.resolve ${JSON.stringify(tag)}`);
        assertLocales(tag, want, `UI in ${current}`);
      }
      for (const tag of UNSUPPORTED) {
        assert.equal(I.resolve({ locale: tag }), current, `I18n.resolve ${JSON.stringify(tag)}`);
        assertLocales(tag, current, `UI in ${current}`);
      }
    }
  } finally {
    I.setLocale(before);
  }
});

test('core-i18n: without src/i18n.js the same tag rule applies and everything else is zh-CN', () => {
  withI18n(undefined, () => {
    for (const [tag, want] of SUPPORTED) assertLocales(tag, want, 'no I18n');
    for (const tag of UNSUPPORTED) assertLocales(tag, 'zh-CN', 'no I18n');
  });
  // An I18n without resolve() (a minimal stub): same tag rule, then its getLocale().
  for (const current of ['zh-CN', 'en-US']) {
    withI18n({ getLocale: () => current }, () => {
      for (const [tag, want] of SUPPORTED) assertLocales(tag, want, `getLocale-only I18n in ${current}`);
      for (const tag of UNSUPPORTED) assertLocales(tag, current, `getLocale-only I18n in ${current}`);
    });
  }
  // A broken I18n never breaks the modules: zh-CN.
  const boom = () => { throw new Error('broken'); };
  withI18n({ getLocale: boom, resolve: boom }, () => {
    assertLocales(undefined, 'zh-CN', 'throwing I18n');
    assertLocales('en', 'en-US', 'throwing I18n, explicit tag');
  });
});

test('core-i18n: without opts.locale the current MBX.I18n language applies, read at call time', () => {
  const saved = MBX.I18n;
  let current = 'en-US';
  // A getLocale-only stub (as other tests use): the modules read it on every call.
  MBX.I18n = { getLocale: () => current };
  try {
    const en = E.analyze('å¤§å®¶å¥½');
    assert.equal(en.locale, 'en-US');
    assert.equal(en.best.label, 'UTF-8 misread as Windows-1252');
    assert.equal(en.best.lang.name, 'Simplified Chinese');
    assert.equal(S.detectLang('简体中文').name, 'Simplified Chinese');
    assert.equal(C.describe('gbk'), 'Simplified Chinese (GBK / GB18030)');
    assert.equal(F.gallery()[0].title, F.GALLERY[0].en.title);
    assert.equal(F.presets()[0].name, F.PRESETS[0].en.name);
    assertEnglish(F.corrupt('x', []).error, 'corrupt error via I18n');
    assert.equal(E.analyze('å¤§å®¶å¥½', ZH).best.label, 'UTF-8 被误读为 Windows-1252', 'explicit locale wins');
    current = 'zh-CN'; // switched: the very next call follows
    assert.equal(E.analyze('å¤§å®¶å¥½').best.label, 'UTF-8 被误读为 Windows-1252');
    assert.equal(C.describe('gbk'), '简体中文（代码页 936）');
  } finally {
    if (saved === undefined) delete MBX.I18n;
    else MBX.I18n = saved;
  }
  // Without any I18n module the modules default to zh-CN.
  const again = MBX.I18n;
  delete MBX.I18n;
  try {
    assert.equal(E.analyze('å¤§å®¶å¥½').locale, 'zh-CN');
    assert.equal(S.detectLang('简体中文').name, '简体中文');
  } finally {
    if (again !== undefined) MBX.I18n = again;
  }
});

test('core-i18n: the real MBX.I18n (when loaded) drives the default language', () => {
  const I = MBX.I18n;
  if (!I || typeof I.setLocale !== 'function' || typeof I.getLocale !== 'function') return; // src/i18n.js not present
  const before = I.getLocale();
  try {
    I.setLocale('en-US');
    assert.equal(E.analyze('å¤§å®¶å¥½').best.label, 'UTF-8 misread as Windows-1252');
    I.setLocale('zh-CN');
    assert.equal(E.analyze('å¤§å®¶å¥½').best.label, 'UTF-8 被误读为 Windows-1252');
  } finally {
    I.setLocale(before);
  }
});

// ---------------------------------------------------------------------------
// zh-CN unchanged (the full byte-for-byte check is the zh snapshot; these are spot checks)
// ---------------------------------------------------------------------------

test('core-i18n: zh-CN text is unchanged by default', () => {
  const r = E.analyze('Ã¥Â¤Â§Ã¥Â®Â¶Ã¥Â¥Â½');
  assert.equal(r.best.label, 'UTF-8 被误读为 Windows-1252（两层）');
  assert.equal(r.best.lang.name, '简体中文');
  const k = E.analyze('锟斤拷');
  assert.deepEqual(k.signatures.map((s) => s.title), ['锟斤拷']);
  assert.ok(k.signatures[0].note.startsWith('两个 U+FFFD'));
  assert.ok(k.signals.every((s) => HAN.test(s.hint)));
  assert.equal(C.get('windows-1252').zh, '西欧（常被误称 Latin-1）');
  assert.equal(C.describe('windows-1252'), '西欧（常被误称 Latin-1）');
  assert.equal(F.GALLERY.find((g) => g.id === 'kunjinkao').title, '「锟斤拷」· 传说级名器');
  assert.equal(F.PRESETS[0].name, 'UTF-8 → Windows-1252（西欧误读）');
  assert.equal(F.corrupt('x', []).error, '至少需要一层"原编码 → 误读为"。');
});
