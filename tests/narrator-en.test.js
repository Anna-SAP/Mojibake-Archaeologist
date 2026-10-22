'use strict';
// Tests for the en-US docent (src/narrator-en.js) and the locale plumbing in src/narrator.js
// (docs/ARCHITECTURE.md §11). Fixtures are hand-built AnalysisResults whose bytes and segments
// come from Node's real TextEncoder/TextDecoder (same helpers as narrator.test.js), plus every
// Forge.GALLERY relic run through the real engine.
//
// The fixtures deliberately keep Chinese engine labels, hints and language names: the English
// narrator must not depend on whether MBX.Engine / MBX.Scorer have been localized.

const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const N = MBX.Narrator;
const EN = { locale: 'en-US' };

/* ------------------------------------------------------------------------- *
 * Fixture helpers (bytes and Seg[] derived from the platform's own codecs)
 * ------------------------------------------------------------------------- */

const CP437_HIGH = Array.from('ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ');
const SINGLE = new Set(['windows-1252', 'iso-8859-1', 'windows-1251', 'windows-1253', 'koi8-r', 'macintosh', 'cp437', 'ascii']);
const DOUBLE = new Set(['gbk', 'big5', 'shift_jis', 'euc-kr']);

function decodeByte(enc, b) {
  if (enc === 'iso-8859-1' || enc === 'ascii') return String.fromCharCode(b);
  if (enc === 'cp437') return b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  return new TextDecoder(enc).decode(Uint8Array.of(b));
}

function decodeSegs(enc, bytes) {
  const segs = [];
  if (SINGLE.has(enc)) {
    bytes.forEach((b, i) => segs.push({ ch: decodeByte(enc, b), start: i, end: i + 1 }));
  } else if (enc === 'utf-16le') {
    for (let i = 0; i + 1 < bytes.length; i += 2) segs.push({ ch: String.fromCharCode(bytes[i] | (bytes[i + 1] << 8)), start: i, end: i + 2 });
  } else if (enc === 'utf-8') {
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      const len = b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
      let ch = null;
      try { ch = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(i, i + len)); } catch (_) { ch = null; }
      segs.push(ch !== null && Array.from(ch).length === 1 ? { ch, start: i, end: i + len } : { ch: '�', start: i, end: i + 1, error: true });
      i = segs[segs.length - 1].end;
    }
  } else if (DOUBLE.has(enc)) {
    let i = 0;
    const dec = new TextDecoder(enc);
    while (i < bytes.length) {
      const b = bytes[i];
      if (b < 0x80 || (enc === 'shift_jis' && b >= 0xa1 && b <= 0xdf)) {
        segs.push({ ch: dec.decode(bytes.subarray(i, i + 1)), start: i, end: i + 1 });
        i += 1;
        continue;
      }
      const pair = i + 1 < bytes.length ? dec.decode(bytes.subarray(i, i + 2)) : '�';
      if (Array.from(pair).length === 1 && pair !== '�') {
        segs.push({ ch: pair, start: i, end: i + 2 });
        i += 2;
      } else {
        segs.push({ ch: '�', start: i, end: i + 1, error: true });
        i += 1;
      }
    }
  } else {
    throw new Error('fixture helper does not know ' + enc);
  }
  return { text: segs.map((s) => s.ch).join(''), segs };
}

const reverseCache = new Map();
function encodeWith(enc, text) {
  if (enc === 'utf-8') return new TextEncoder().encode(text);
  if (enc === 'utf-16le') return Uint8Array.from(Buffer.from(text, 'utf16le'));
  if (!reverseCache.has(enc)) {
    const map = new Map();
    for (let b = 0; b < 0x80; b++) map.set(String.fromCharCode(b), [b]);
    if (SINGLE.has(enc)) {
      for (let b = 0x80; b < 0x100; b++) { const ch = decodeByte(enc, b); if (!map.has(ch)) map.set(ch, [b]); }
    } else {
      const dec = new TextDecoder(enc);
      for (let lead = 0x81; lead <= 0xfe; lead++) {
        for (let trail = 0x40; trail <= 0xfe; trail++) {
          const ch = dec.decode(Uint8Array.of(lead, trail));
          if (Array.from(ch).length === 1 && ch !== '�' && !map.has(ch)) map.set(ch, [lead, trail]);
        }
      }
    }
    reverseCache.set(enc, map);
  }
  const map = reverseCache.get(enc);
  const out = [];
  for (const ch of text) {
    const bs = map.get(ch);
    if (!bs) throw new Error(`cannot encode ${ch} in ${enc}`);
    out.push(...bs);
  }
  return Uint8Array.from(out);
}

function transcodeStep(original, trueEnc, wrongDec) {
  const bytes = encodeWith(trueEnc, original);
  const after = decodeSegs(trueEnc, bytes);
  const before = decodeSegs(wrongDec, bytes);
  assert.equal(after.text, original, `fixture sanity: ${trueEnc} round trip`);
  return {
    kind: 'transcode', wrongDecoder: wrongDec, trueEncoding: trueEnc, scheme: null,
    before: before.text, after: after.text, bytes,
    segmentsBefore: before.segs, segmentsAfter: after.segs,
    repairs: [], lossy: before.segs.some((s) => s.error),
    scoreBefore: -7.4, scoreAfter: -2.2, prior: 0.8,
  };
}

// chain: [[trueEnc, wrongDec], ...] from the earliest layer; returns steps surface-first.
function chainSteps(original, chain) {
  const formed = [];
  let text = original;
  for (const [e, w] of chain) {
    const st = transcodeStep(text, e, w);
    formed.push(st);
    text = st.before;
  }
  return { steps: formed.reverse(), input: text };
}

function unescapeStep(before, scheme, trueEnc, after) {
  const bytes = scheme === 'html-entity' || scheme === 'unicode-escape' ? null : encodeWith(trueEnc, after);
  return {
    kind: 'unescape', wrongDecoder: null, trueEncoding: trueEnc, scheme,
    before, after, bytes,
    segmentsBefore: null,
    segmentsAfter: bytes ? decodeSegs(trueEnc, bytes).segs : null,
    repairs: [], lossy: false, scoreBefore: -6, scoreAfter: -2, prior: 1,
  };
}

// Chinese names on purpose (an engine that has not been localized yet).
const LANG = {
  'zh-Hans': { lang: 'zh-Hans', name: '简体中文', confidence: 0.92 },
  ja: { lang: 'ja', name: '日文', confidence: 0.9 },
  en: { lang: 'en', name: '英文', confidence: 0.8 },
  ru: { lang: 'ru', name: '俄文', confidence: 0.85 },
  el: { lang: 'el', name: '希腊文', confidence: 0.85 },
};

function hyp(steps, output, extra) {
  return Object.assign({
    output, confidence: 0.93,
    score: { value: -2.1, total: -6.3, length: Array.from(output).length, lang: 'zh-Hans', script: 'Hani', badness: 0, flags: [] },
    steps, repairs: [], lang: LANG['zh-Hans'], label: 'UTF-8 被误读为 Windows-1252',
  }, extra || {});
}

function result(input, status, best, extra) {
  return Object.assign({
    input, status, best, alternatives: [], signatures: [], signals: [],
    inputScore: { value: -7.8, total: -60, length: Array.from(input).length, lang: 'mixed', script: 'Latn', badness: 3, flags: [] },
    stats: { explored: 140, ms: 11, truncated: false },
  }, extra || {});
}

function sig(id, title, input, match, note) {
  return { id, title, match, index: Math.max(0, input.indexOf(match)), note: note || title + ' 签名' };
}

/* ------------------------------------------------------------------------- *
 * Fixtures: every status, signature, escape scheme, repair kind, multi-layer
 * ------------------------------------------------------------------------- */

const F = {};

{ // the classic 大家好, with a low-ranked Chinese-labelled alternative and a Chinese signal hint
  const { steps, input } = chainSteps('大家好', [['utf-8', 'windows-1252']]);
  F.dajia = result(input, 'restored', hyp(steps, '大家好'), {
    alternatives: [{ output: 'Ã¥Â¤Â§', confidence: 0.04, label: 'UTF-8 被误读为 Mac OS Roman', steps: [], repairs: [], lang: LANG.en }],
    signals: [{ type: 'utf8-as-1252', match: 'å¤', index: 0, hint: '疑似 UTF-8 被当作 Windows-1252 解读' }],
  });
}
{ // UTF-8 read as GBK with a repaired gap (candidates)
  const full = transcodeStep('你好，世界', 'utf-8', 'gbk');
  const bytes = full.bytes.slice(0, 14);
  const segsBefore = full.segmentsBefore.slice(0, 7).concat([{ ch: '�', start: 14, end: 14 }]);
  const segsAfter = full.segmentsAfter.slice(0, 4).concat([{ ch: '界', start: 12, end: 14, repaired: true, candidates: ['界', '畍', '畋', '畇'] }]);
  const repair = { index: 4, from: '�', to: '界', candidates: ['界', '畍', '畋', '畇'], reason: 'gap', step: 0 };
  const step = Object.assign({}, full, { bytes, segmentsBefore: segsBefore, segmentsAfter: segsAfter, repairs: [repair], lossy: true });
  F.nihaoGbk = result(full.before, 'restored', hyp([step], '你好，世界', { repairs: [repair], label: 'UTF-8 被误读为 GBK（含 1 处修复）', confidence: 0.88 }));
}
{ // dropped byte (Windows-1252 undefined byte lost in a copy-paste) and an NBSP repair
  const st = transcodeStep('“Hi”', 'utf-8', 'windows-1252');
  const repair = { index: 3, from: '', to: '”', candidates: ['”', '‐'], reason: 'dropped', step: 0 };
  F.dropped = result(st.before, 'restored', hyp([Object.assign({}, st, { repairs: [repair], lossy: true })], '“Hi”', { repairs: [repair], lang: LANG.en, confidence: 0.7 }));
  const nb = transcodeStep('à la', 'utf-8', 'windows-1252');
  const r2 = { index: 0, from: ' ', to: 'à', candidates: ['à'], reason: 'nbsp', step: 0 };
  F.nbsp = result(nb.before, 'restored', hyp([Object.assign({}, nb, { repairs: [r2], lossy: true })], 'à la', { repairs: [r2], lang: LANG.en }));
}
{ // more classic pairs
  const g = chainSteps('你好', [['gbk', 'windows-1252']]);
  F.gbk1252 = result(g.input, 'restored', hyp(g.steps, '你好', { label: 'GBK 被误读为 Windows-1252' }));
  const s = chainSteps('こんにちは', [['utf-8', 'shift_jis']]);
  F.sjis = result(s.input, 'restored', hyp(s.steps, 'こんにちは', { lang: LANG.ja, label: 'UTF-8 被误读为 Shift_JIS' }));
  const k = chainSteps('Привет', [['koi8-r', 'windows-1251']]);
  F.koi8 = result(k.input, 'restored', hyp(k.steps, 'Привет', { lang: LANG.ru, label: 'KOI8-R 被误读为 Windows-1251' }));
  const z = chainSteps('中文.txt', [['gbk', 'cp437']]);
  F.zip = result(z.input, 'restored', hyp(z.steps, '中文.txt', { label: 'ZIP 文件名：GBK 被误读为 CP437' }));
  const b = chainSteps('大家好', [['big5', 'gbk']]);
  F.big5gbk = result(b.input, 'restored', hyp(b.steps, '大家好', { lang: { lang: 'zh-Hant', name: '繁体中文', confidence: 0.8 }, label: 'Big5 被误读为 GBK' }));
  const s5c = chainSteps('表示', [['shift_jis', 'windows-1252']]);
  F.sjis5c = result(s5c.input, 'restored', hyp(s5c.steps, '表示', { lang: LANG.ja, label: 'Shift_JIS 被误读为 Windows-1252' }));
  const e = chainSteps('好😀', [['utf-8', 'windows-1252']]);
  F.emoji = result(e.input, 'restored', hyp(e.steps, '好😀'));
  const eu = chainSteps('价格 €5', [['utf-8', 'windows-1252']]);
  F.euro = result(eu.input, 'restored', hyp(eu.steps, '价格 €5'));
}
{ // multi-layer strata, and an escape layer wrapped around a misreading
  const { steps, input } = chainSteps('大家', [['utf-8', 'windows-1252'], ['utf-8', 'windows-1252']]);
  F.double = result(input, 'restored', hyp(steps, '大家', { label: 'UTF-8 被误读为 Windows-1252（两层）' }));
  const inner = transcodeStep('大', 'utf-8', 'windows-1252');
  const pin = '%C3%A5%C2%A4%C2%A7';
  F.percentMojibake = result(pin, 'restored', hyp([unescapeStep(pin, 'percent', 'utf-8', inner.before), inner], '大', { label: '百分号编码 + UTF-8 被误读为 Windows-1252' }));
}
{ // escape-only relics: percent, HTML entities, \u with an astral character
  const p = '%E5%A4%A7%E5%AE%B6%E5%A5%BD';
  F.percent = result(p, 'restored', hyp([unescapeStep(p, 'percent', 'utf-8', '大家好')], '大家好', { label: '百分号编码（UTF-8）' }));
  F.html = result('&#22823;&#23478;', 'restored', hyp([unescapeStep('&#22823;&#23478;', 'html-entity', 'utf-8', '大家')], '大家', { label: 'HTML 字符实体' }));
  const esc = '\\u597D\\uD83D\\uDE00';
  F.uescape = result(esc, 'restored', hyp([unescapeStep(esc, 'unicode-escape', 'utf-8', '好😀')], '好😀', { label: 'Unicode 转义' }));
}
{ // uncatalogued and alien pairs
  const g = chainSteps('Καλημέρα', [['windows-1253', 'koi8-r']]);
  F.unknownPair = result(g.input, 'restored', hyp(g.steps, 'Καλημέρα', { lang: LANG.el, label: 'Windows-1253 被误读为 KOI8-R', confidence: 0.55 }), {
    alternatives: [{ output: 'κΑΛΗΜΈΡΑ', confidence: 0.2, label: '另一种希腊文读法', steps: g.steps }],
  });
  F.alien = result('¡²', 'restored', hyp([{
    kind: 'transcode', wrongDecoder: 'x-vulcan', trueEncoding: 'x-klingon', scheme: null,
    before: '¡²', after: 'Ж', bytes: Uint8Array.of(0xa1, 0xb2),
    segmentsBefore: [{ ch: '¡', start: 0, end: 1 }, { ch: '²', start: 1, end: 2 }],
    segmentsAfter: [{ ch: 'Ж', start: 0, end: 2 }],
    repairs: [], lossy: false, scoreBefore: -8, scoreAfter: -3, prior: 0.1,
  }], 'Ж', { label: '未知编码链路', confidence: 0.4 }));
}
{ // every signature
  const kjk = '锟斤拷锟斤拷';
  F.kunjinkao = result(kjk, 'irrecoverable', null, { signatures: [sig('kunjinkao', '锟斤拷', kjk, '锟斤拷'), Object.assign(sig('kunjinkao', '锟斤拷', kjk, '锟斤拷'), { index: 3 })] });
  const kjkStep = transcodeStep('��', 'utf-8', 'gbk');
  F.kunjinkaoBest = result('锟斤拷', 'irrecoverable', hyp([kjkStep], '��', { confidence: 0.6, label: 'UTF-8 被误读为 GBK（替换字符）' }), { signatures: [sig('kunjinkao', '锟斤拷', '锟斤拷', '锟斤拷')] });
  F.kunjinkaoBig5 = result('嚙踝蕭嚙踝蕭', 'irrecoverable', null, { signatures: [sig('kunjinkao-big5', '嚙踝蕭', '嚙踝蕭嚙踝蕭', '嚙踝蕭')] });
  F.tang = result('烫烫烫烫烫烫', 'irrecoverable', null, { signatures: [sig('tangtangtang', '烫烫烫', '烫烫烫烫烫烫', '烫烫烫烫烫烫')] });
  F.tun = result('屯屯屯屯', 'irrecoverable', null, { signatures: [sig('tuntuntun', '屯屯屯', '屯屯屯屯', '屯屯屯屯')] });
  F.qi = result('葺葺葺', 'unknown', null, { signatures: [sig('qiqiqi', '葺葺葺', '葺葺葺', '葺葺葺')] });
  const bom = chainSteps('﻿Hello', [['utf-8', 'windows-1252']]);
  F.bom = result(bom.input, 'restored', hyp(bom.steps, '﻿Hello', { lang: LANG.en }), { signatures: [sig('utf8-bom-1252', 'UTF-8 BOM', bom.input, 'ï»¿')] });
  const u16 = chainSteps('﻿Hi', [['utf-16le', 'windows-1252']]);
  F.utf16bom = result(u16.input, 'restored', hyp(u16.steps, '﻿Hi', { lang: LANG.en, label: 'UTF-16LE 被误读为 Windows-1252' }), {
    signatures: [sig('utf16-bom', 'UTF-16 BOM', u16.input, 'ÿþ'), sig('utf16-nul', '字间夹 NUL', u16.input, '\u0000')],
  });
  const rep = 'Gr��e aus K�ln, sch�n';
  F.replacement = result(rep, 'irrecoverable', null, { signatures: [sig('replacement', '替换字符', rep, '��')] });
  const qm = '????, ???????!';
  F.questions = result(qm, 'irrecoverable', null, { signatures: [sig('question-marks', '问号', qm, '????')] });
  const bush = chainSteps('Bush hid the facts', [['ascii', 'utf-16le']]);
  F.bush = result(bush.input, 'restored', hyp(bush.steps, 'Bush hid the facts', { lang: LANG.en, label: 'ASCII 被误读为 UTF-16LE' }), {
    signatures: [sig('notepad-bush', 'Bush hid the facts', bush.input, bush.input)],
  });
  F.unknownSig = result('ʬʬʬ', 'unknown', null, { signatures: [{ id: 'x-mystery', title: '神秘签名', match: 'ʬʬʬ', index: 0, note: '一种未知的签名' }] });
}
{ // remaining statuses
  F.clean = result('你好，世界。今天天气不错。', 'clean', null, { inputScore: { value: -2.0, total: -24, length: 13, lang: 'zh-Hans', script: 'Hani', badness: 0, flags: [] } });
  F.cleanAscii = result('Hello, world!', 'clean', null, { inputScore: { value: -1.9, total: -25, length: 13, lang: 'en', script: 'Latn', badness: 0, flags: [] } });
  F.lost = result('Caf� cr�me br�l�e', 'irrecoverable', null);
  const frag = transcodeStep('好', 'utf-8', 'windows-1252');
  F.partial = result('大家 å¥½ 朋友', 'partial', hyp([frag], '大家 好 朋友', { confidence: 0.7, label: '局部：UTF-8 被误读为 Windows-1252' }));
  F.partialDirty = result('å¥½ ¤¤ ÿÿ', 'partial', hyp([frag], '好 ¤¤ ÿÿ', { confidence: 0.5, label: '局部：UTF-8 被误读为 Windows-1252', score: { badness: 2 } }));
  const altStep = transcodeStep('Ω', 'utf-8', 'windows-1252');
  F.unknown = result('ʞɐɥ ⊕⊗⌘ ҈҉ Ð', 'unknown', null, {
    signals: [{ type: 'utf8-as-1252', match: 'Ð', index: 12, hint: '疑似 UTF-8 被当作 Windows-1252 解读' }, { type: 'mixed-script', match: 'ʞɐɥ', index: 0, hint: '一个词里混用了多种文字' }],
    alternatives: [{ output: 'Ω?', confidence: 0.08, label: 'UTF-8 被误读为 GBK', steps: [altStep] }],
  });
  F.unknownBare = result('qzx vbn', 'unknown', null);
}

const FIXTURES = Object.keys(F);
const GALLERY = MBX.Forge.GALLERY.map((g) => ({ id: g.id, r: MBX.Engine.analyze(g.relic, EN) }));
const CASES = FIXTURES.map((k) => ({ id: k, r: F[k] })).concat(GALLERY.map((g) => ({ id: 'gallery:' + g.id, r: g.r })));
const STYLE_IDS = ['humor', 'academic', 'snark'];
const SEEDS = [0, 1, 7, 12345];
const SECTION_IDS = ['opening', 'identify', 'mechanism', 'dating', 'repair', 'conservation', 'easter', 'closing'];

/* ------------------------------------------------------------------------- *
 * Checks
 * ------------------------------------------------------------------------- */

// Han, kana, Hangul, CJK punctuation / full-width forms, supplementary ideographs.
const CJK_RE = /[ᄀ-ᇿ⺀-⿿　-ヿ㄀-ㇿ㈀-䶿一-鿿ꥠ-꥿가-힯豈-﫿︰-﹏＀-￯]|[\ud840-\ud87f][\udc00-\udfff]/u;

// Data that may be quoted verbatim (§11.2): the relic, the restored text, every step's text and
// segment glyphs, repair candidates, alternative readings, signal matches — and the famous relics'
// own names, which are quoted as data the way 锟斤拷 is (the 锟斤拷 / 烫烫烫 / 屯屯屯 / 锘锘锘
// couplet, 葺 from the debug heap, the "Bush hid the facts" sentence, and 文字化け, the word
// "mojibake" in Japanese).
const FAMOUS = '锟斤拷嚙踝蕭烫屯葺锘畂桳栠摩琠敨映捡獴文字化け';

function dataChars(r) {
  const set = new Set(Array.from(FAMOUS));
  const add = (t) => { for (const ch of Array.from(t == null ? '' : String(t))) set.add(ch); };
  const addHyp = (h) => {
    if (!h) return;
    add(h.output);
    for (const rep of h.repairs || []) { add(rep.from); add(rep.to); (rep.candidates || []).forEach(add); }
    for (const st of h.steps || []) {
      add(st.before); add(st.after);
      for (const s of (st.segmentsBefore || []).concat(st.segmentsAfter || [])) { add(s && s.ch); (s && s.candidates || []).forEach(add); }
      for (const rep of st.repairs || []) { add(rep.from); add(rep.to); (rep.candidates || []).forEach(add); }
    }
  };
  add(r.input);
  addHyp(r.best);
  (r.alternatives || []).forEach(addHyp);
  for (const s of r.signals || []) add(s.match);
  for (const s of r.signatures || []) add(s.match);
  return set;
}

function leakedCjk(text, r) {
  const ok = dataChars(r);
  const out = new Set();
  for (const ch of Array.from(text)) if (CJK_RE.test(ch) && !ok.has(ch)) out.add(ch);
  return Array.from(out).join('');
}

const codeless = (t) => t.replace(/`[^`]*`/g, '');
const sec = (n, id) => (n.sections.find((s) => s.id === id) || { text: '' }).text;

function checkNarration(n, r, label) {
  assert.ok(/^MBX-\d{4}-[0-9A-F]{4}$/.test(n.exhibitId), `${label}: exhibitId ${n.exhibitId}`);
  for (const k of ['title', 'subtitle', 'site', 'plainText']) assert.ok(typeof n[k] === 'string' && n[k].trim().length > 0, `${label}: ${k}`);
  assert.ok(n.era && typeof n.era.label === 'string' && n.era.label.length > 0 && typeof n.era.reason === 'string', `${label}: era`);
  assert.ok(Array.isArray(n.tags) && n.tags.length > 0 && n.tags.every((t) => typeof t === 'string' && t.length > 0), `${label}: tags`);
  assert.ok(n.docent && n.docent.name && n.docent.styleName && n.docent.avatar, `${label}: docent`);
  assert.ok(Array.isArray(n.sections) && n.sections.length >= 6, `${label}: at least 6 sections`);
  let last = -1;
  for (const s of n.sections) {
    const pos = SECTION_IDS.indexOf(s.id);
    assert.ok(pos > last, `${label}: section ${s.id} known and in contract order`);
    last = pos;
    assert.ok(typeof s.heading === 'string' && s.heading.length > 0, `${label}: ${s.id} heading`);
    assert.ok(typeof s.text === 'string' && s.text.trim().length > 10, `${label}: ${s.id} text`);
    assert.equal(s.text, s.text.trim(), `${label}: ${s.id} has no stray leading/trailing space`);
    // markup contract: only **bold**, `code` and newlines
    assert.equal((s.text.match(/`/g) || []).length % 2, 0, `${label}: ${s.id} balanced backticks`);
    const outside = codeless(s.text);
    assert.equal((outside.match(/\*\*/g) || []).length % 2, 0, `${label}: ${s.id} balanced bold`);
    assert.ok(!/__|(^|[^*])\*([^*]|$)/.test(outside.replace(/\*\*/g, '')), `${label}: ${s.id} no stray emphasis markers`);
    assert.ok(!/<\/?[a-z][^>]*>/i.test(outside), `${label}: ${s.id} has no HTML outside code`);
    assert.ok(!/^#{1,6}\s/m.test(outside), `${label}: ${s.id} has no markdown headings`);
    assert.ok(!/\[[^\]]+\]\([^)]+\)/.test(outside), `${label}: ${s.id} has no markdown links`);
    assert.ok(!/\{[a-zA-Z][a-zA-Z0-9]*\}/.test(outside), `${label}: ${s.id} has no unfilled {placeholder}`);
    const prose = s.text.replace(/`[^`]*`/g, 'X').replace(/“[^”]*”/g, 'Q');
    const gap = prose.match(/.{0,30}(?: [,.;:)]|\( | {2}).{0,15}/);
    assert.ok(!gap, `${label}: ${s.id} spacing: ${gap && gap[0]}`);
  }
  for (const req of ['opening', 'identify', 'mechanism', 'dating', 'conservation', 'closing']) assert.ok(n.sections.some((s) => s.id === req), `${label}: has ${req}`);
  assert.ok(!/\*\*|`/.test(n.plainText), `${label}: plainText has no markup`);
  const blob = JSON.stringify(n);
  for (const bad of ['undefined', 'NaN', 'null', '[object Object]']) assert.ok(!blob.includes(bad), `${label}: must not contain "${bad}"`);
  const leak = leakedCjk([n.title, n.subtitle, n.era.label, n.era.reason, n.site, n.plainText, n.docent.name, n.docent.styleName].concat(n.tags, n.sections.map((s) => s.heading + '\n' + s.text)).join('\n'), r);
  assert.equal(leak, '', `${label}: CJK outside the relic's own data`);
}

const narrEn = (c, style, seed, extra) => N.narrate(c.r, Object.assign({ style, seed, strict: true }, EN, extra || {}));

/* ------------------------------------------------------------------------- *
 * Tests
 * ------------------------------------------------------------------------- */

test('narrator-en: the en-US pack is registered and the locale API exists', () => {
  assert.equal(typeof N.styles, 'function');
  assert.equal(typeof N.registerLocale, 'function');
  assert.ok(N._internals.locales().includes('en-US'), 'en-US registered');
  assert.ok(MBX._narratorPacks && MBX._narratorPacks['en-US'], 'pack also parked for a narrator loaded later');
  assert.equal(N.registerLocale('zh-CN', { STYLES: [] }), false, 'zh-CN base is never replaced');
  assert.equal(N.registerLocale('en-US', null), false, 'non-object packs are refused');
});

test('narrator-en: every fixture and gallery relic × 3 styles × 4 seeds is well-formed English', () => {
  let count = 0;
  for (const c of CASES) {
    for (const style of STYLE_IDS) {
      for (const seed of SEEDS) {
        const n = narrEn(c, style, seed);
        checkNarration(n, c.r, `${c.id}/${style}/${seed}`);
        assert.equal(n.style, style);
        count++;
      }
    }
  }
  assert.ok(count >= CASES.length * 12, 'ran the whole matrix');
});

test('narrator-en: deterministic per seed, varied across seeds, docents rotate', () => {
  for (const c of CASES) for (const style of STYLE_IDS) assert.deepEqual(narrEn(c, style, 42), narrEn(c, style, 42), `${c.id}/${style}`);
  for (const style of STYLE_IDS) {
    let differ = 0;
    for (const c of CASES) if (narrEn(c, style, 1).plainText !== narrEn(c, style, 2).plainText) differ++;
    assert.ok(differ >= Math.ceil(CASES.length * 0.9), `${style}: ${differ}/${CASES.length} differ between seeds`);
    const docents = new Set([0, 1, 2].map((s) => narrEn({ r: F.dajia }, style, s).docent.name));
    assert.equal(docents.size, 3, `${style}: three seeds, three docents`);
    const openings = new Set();
    for (let seed = 0; seed < 40; seed++) {
      const n = narrEn({ r: F.dajia }, style, seed);
      openings.add(n.sections[0].text.split(n.docent.name).join(''));
    }
    assert.ok(openings.size >= 3, `${style}: ${openings.size} distinct openings`);
  }
});

test('narrator-en: same shape, same exhibit id and same sections as zh-CN', () => {
  for (const c of CASES) {
    for (const style of STYLE_IDS) {
      const en = narrEn(c, style, 7);
      const zh = N.narrate(c.r, { style, seed: 7, locale: 'zh-CN' });
      assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), `${c.id}/${style}: same keys`);
      assert.equal(en.exhibitId, zh.exhibitId, `${c.id}/${style}: exhibitId`);
      assert.deepEqual(en.sections.map((s) => s.id), zh.sections.map((s) => s.id), `${c.id}/${style}: same sections`);
      assert.equal(en.style, zh.style);
      assert.equal(en.docent.avatar, zh.docent.avatar);
      assert.notEqual(en.plainText, zh.plainText, `${c.id}/${style}: actually translated`);
    }
  }
});

test('narrator-en: 大家好 quotes the real bytes and glyphs in every style', () => {
  for (const style of STYLE_IDS) {
    for (const seed of [0, 3, 8]) {
      const m = sec(narrEn({ r: F.dajia }, style, seed), 'mechanism');
      assert.ok(m.includes('E5 A4 A7'), `${style}/${seed}: has E5 A4 A7`);
      assert.ok(m.includes('“大”'), `${style}/${seed}: names 大`);
      assert.ok(m.includes('`å`') && m.includes('`¤`') && m.includes('`§`'), `${style}/${seed}: shows å ¤ §`);
    }
  }
  const academic = sec(narrEn({ r: F.dajia }, 'academic', 0), 'mechanism');
  assert.ok(academic.includes('`1110xxxx 10xxxxxx 10xxxxxx`') && academic.includes('`11100101 10100100 10100111`'), 'academic shows the UTF-8 bit layout');
  assert.ok(academic.includes('`E5`→`å`'), 'academic maps byte to glyph');
  assert.ok(/3 original characters into 9 characters/.test(sec(narrEn({ r: F.dajia }, 'humor', 0), 'mechanism')), 'growth ratio 3 → 9');
});

test('narrator-en: mechanisms cite hex bytes that really occur in the relic', () => {
  const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  let checked = 0;
  for (const c of CASES) {
    const steps = c.r.best && Array.isArray(c.r.best.steps) ? c.r.best.steps : [];
    const dumps = steps.filter((s) => s.bytes && s.bytes.length).map((s) => hexOf(s.bytes));
    if (!dumps.length) continue;
    for (const style of STYLE_IDS) {
      for (const seed of SEEDS) {
        const spans = (sec(narrEn(c, style, seed), 'mechanism').match(/`[^`]*`/g) || [])
          .map((s) => s.slice(1, -1)).filter((s) => /^[0-9A-F]{2}( [0-9A-F]{2})*$/.test(s));
        assert.ok(spans.some((h) => dumps.some((d) => d.includes(h))), `${c.id}/${style}/${seed}: cites real bytes (${spans.slice(0, 4).join(' | ')})`);
        checked++;
      }
    }
  }
  assert.ok(checked > 100, 'checked plenty of byte-carrying relics');
});

test('narrator-en: multi-byte bites, strata, escapes and repairs are explained in English', () => {
  for (const style of STYLE_IDS) {
    const m = sec(narrEn({ r: F.nihaoGbk }, style, 0), 'mechanism');
    assert.ok(m.includes('E4 BD A0') && m.includes('`E4 BD`→`浣`'), `${style}: 你 = E4 BD A0 bitten as 浣`);
    assert.ok(m.includes('`A0 E5`→`犲` (`E5` borrowed from the next character, “好”)'), `${style}: cross-boundary bite`);
    assert.ok(m.includes('least common multiple of 3 and 2 is 6'), `${style}: LCM remark`);
    const d = sec(narrEn({ r: F.double }, style, 0), 'mechanism');
    assert.ok(d.includes('**Layer 2 (deepest)**') && d.includes('**Layer 1 (surface)**'), `${style}: strata titled deepest-first`);
    assert.ok(d.indexOf('Layer 2 (deepest)') < d.indexOf('Layer 1 (surface)'), `${style}: deepest first`);
    const p = sec(narrEn({ r: F.percent }, style, 0), 'mechanism');
    assert.ok(p.includes('**percent-encoding**') && p.includes('`%E5%A4%A7`'), `${style}: percent layer`);
    const u = sec(narrEn({ r: F.uescape }, style, 0), 'mechanism');
    assert.ok(u.includes('surrogates') && u.includes('`\\uD83D\\uDE00`'), `${style}: surrogate pair escape`);
    const rep = sec(narrEn({ r: F.nihaoGbk }, style, 0), 'repair');
    assert.ok(/Character #5 had only its first 2 bytes left, `E7 95`/.test(rep), `${style}: gap repair cites surviving bytes`);
    assert.ok(rep.includes('runners-up') && rep.includes('“畍”'), `${style}: candidates listed`);
    assert.ok(/inferred from the surviving bytes/.test(sec(narrEn({ r: F.nihaoGbk }, style, 0), 'identify')), `${style}: inferred characters are hedged`);
    assert.ok(/was missing a byte: Windows-1252 decodes `81` `8D` `8F` `90` `9D`/.test(sec(narrEn({ r: F.dropped }, style, 0), 'repair')), `${style}: dropped-byte repair`);
    assert.ok(/no-break space \(NBSP\)/.test(sec(narrEn({ r: F.nbsp }, style, 0), 'repair')), `${style}: NBSP repair`);
  }
  const zip = narrEn({ r: F.zip }, 'academic', 0);
  assert.ok(/DOS box-drawing characters/.test(zip.era.reason), 'ZIP dating evidence');
  const k = narrEn({ r: F.koi8 }, 'academic', 0);
  assert.ok(sec(k, 'easter').includes('pRIWET') || sec(k, 'easter').length > 0, 'KOI8 easter egg available');
  const s5c = N.narrate(F.sjis5c, Object.assign({ style: 'humor', seed: 0 }, EN));
  assert.ok(/dame-moji/.test(sec(s5c, 'easter')), 'Shift_JIS 0x5C trail byte egg');
});

test('narrator-en: byte dating, sites, tips and signatures carry the zh-CN facts in English', () => {
  const d = narrEn({ r: F.dajia }, 'humor', 0);
  assert.equal(d.era.label, 'circa 2000–2018');
  assert.ok(/MySQL defaulted to latin1 \(really cp1252\) until 8\.0 \(2018\)/.test(d.era.reason), 'pair era evidence');
  assert.ok(N._internals.packFor('en-US').PAIR_FACTS['utf-8>windows-1252'].sites.includes(d.site), 'site from the en pair table');
  assert.equal(narrEn({ r: F.emoji }, 'humor', 0).era.label, 'circa 2010–2018', 'emoji floor');
  assert.ok(/Unicode 6\.0 \(2010\)/.test(narrEn({ r: F.emoji }, 'humor', 0).era.reason));
  assert.ok(/euro sign/.test(narrEn({ r: F.euro }, 'humor', 0).era.reason), 'euro floor');
  assert.equal(narrEn({ r: F.double }, 'humor', 0).era.label, 'circa 2002–2018', 'two migrations push the start later');
  assert.equal(narrEn({ r: F.tang }, 'humor', 0).era.label, '1990s–present', 'debug-memory era label');
  assert.equal(narrEn({ r: F.lost }, 'humor', 0).era.label, 'date unknown');
  const cons = sec(narrEn({ r: F.nihaoGbk }, 'academic', 0), 'conservation');
  assert.ok(cons.includes("`s.encode('gbk').decode('utf-8')`") && /UnicodeEncodeError/.test(cons) && /errors='replace'/.test(cons), 'tolerant recipe explained');
  const tipsAll = STYLE_IDS.map((st) => sec(narrEn({ r: F.dajia }, st, 0), 'conservation')).join('\n');
  assert.ok(/utf8mb4|meta charset|Content-Type/.test(tipsAll), 'web/MySQL tips');
  assert.ok(sec(narrEn({ r: F.zip }, 'academic', 1), 'conservation').includes('unzip -O CP936') || /7z x -mcp=936|metadata_encoding/.test(sec(narrEn({ r: F.zip }, 'academic', 1), 'conservation')), 'ZIP tips');
  const kjk = narrEn({ r: F.kunjinkao }, 'humor', 0);
  assert.ok(sec(kjk, 'mechanism').includes('`EF BF`→“锟”') && /kūn jīn kǎo/.test(sec(kjk, 'easter')), '锟斤拷 mechanism and lore');
  assert.ok(/Debug Memory/.test(narrEn({ r: F.tang }, 'humor', 0).title) && /0xCC/.test(sec(narrEn({ r: F.tang }, 'humor', 0), 'mechanism')), '烫烫烫');
  assert.ok(/0xCD/.test(sec(narrEn({ r: F.tun }, 'academic', 0), 'mechanism')), '屯屯屯');
  assert.ok(/use-after-free/.test(narrEn({ r: F.qi }, 'academic', 0).plainText), '葺葺葺');
  assert.ok(/IsTextUnicode/.test(narrEn({ r: F.bush }, 'academic', 0).plainText), 'Bush hid the facts');
  assert.ok(/headers already sent/.test(narrEn({ r: F.bom }, 'humor', 0).plainText), 'UTF-8 BOM lore');
  assert.ok(/REPLACEMENT CHARACTER/.test(sec(narrEn({ r: F.replacement }, 'humor', 0), 'easter')), 'replacement character');
  assert.ok(/encoding stage/.test(narrEn({ r: F.questions }, 'humor', 0).plainText), 'question marks');
  const egg = STYLE_IDS.map((st) => [0, 1, 2, 3, 4, 5].map((s) => sec(narrEn({ r: F.percent }, st, s), 'easter')).join('\n')).join('\n');
  assert.ok(/文字化け: moji means “character,” and bake means “to transform,”/.test(egg), 'mojibake etymology egg');
});

test('narrator-en: every status reads correctly', () => {
  for (const style of STYLE_IDS) {
    for (const seed of SEEDS) {
      assert.ok(/not mojibake|genuine article|authentic modern specimen|classified as genuine|negative|Nothing wrong with it|not mojibake|reads smoother/i.test(sec(narrEn({ r: F.clean }, style, seed), 'identify')), `${style}/${seed}: clean verdict`);
    }
  }
  assert.ok(narrEn({ r: F.clean }, 'humor', 0).tags.includes('Authentic'));
  assert.ok(narrEn({ r: F.lost }, 'humor', 0).tags.includes('Irrecoverable'));
  assert.ok(narrEn({ r: F.partial }, 'humor', 0).tags.includes('Partially Restored'));
  assert.ok(narrEn({ r: F.unknown }, 'humor', 0).tags.includes('Unsolved Mystery'));
  assert.ok(narrEn({ r: F.dajia }, 'humor', 0).tags.includes('Restored'));
  assert.ok(/Local Misreading/.test(narrEn({ r: F.partial }, 'humor', 0).title), 'clean partial is a local misreading');
  assert.ok(/Fragment/.test(narrEn({ r: F.partialDirty }, 'humor', 0).title), 'dirty partial is a fragment');
  for (const style of STYLE_IDS) {
    const u = narrEn({ r: F.unknown }, style, 0);
    assert.ok(/Unidentified Relic/.test(u.title));
    assert.ok(/UTF-8 multi-byte sequences read byte by byte as Windows-1252/.test(sec(u, 'identify') + sec(u, 'mechanism')), `${style}: unknown uses English hints, not the engine's Chinese ones`);
    // the fixture's label is Chinese; the English one is spelled out from the alternative's own steps
    assert.ok(/UTF-8 misread as Windows-1252/.test(u.plainText), `${style}: alternative label spelled out in English`);
    const lost = sec(narrEn({ r: F.lost }, style, 0), 'identify');
    assert.ok(/4 replacement characters `�`/.test(lost), `${style}: lost bytes counted`);
  }
  assert.ok(/only some fragments|garbled fragment/.test(sec(narrEn({ r: F.partial }, 'academic', 0), 'identify')));
  assert.ok(/for the garbled fragment “å¥½”, run/.test(sec(narrEn({ r: F.partial }, 'academic', 0), 'conservation')), 'partial recipe runs on the fragment only');
});

test('narrator-en: styles(), headings and template variants are English', () => {
  const en = N.styles('en-US');
  assert.deepEqual(en.map((s) => s.id), N.STYLES.map((s) => s.id), 'same ids');
  assert.deepEqual(en.map((s) => s.name), ['Humorous Docent', 'Academic Researcher', 'Snarky Appraiser']);
  for (const s of en) {
    assert.ok(s.avatar && s.tagline && s.docents.length >= 3, `${s.id}: avatar/tagline/docents`);
    assert.ok(!CJK_RE.test(s.name + s.tagline + s.docents.join('')), `${s.id}: English names`);
  }
  en[0].docents.push('mutated');
  assert.ok(!N.styles('en-US')[0].docents.includes('mutated'), 'styles() returns copies');
  assert.deepEqual(N.styles('zh-CN'), JSON.parse(JSON.stringify(N.STYLES)), 'zh-CN styles unchanged');
  assert.deepEqual(N.styles('en'), N.styles('en-US'), 'en normalizes to en-US');

  const V = N._internals.packFor('en-US').VOICES;
  const headings = STYLE_IDS.map((st) => narrEn({ r: F.dajia }, st, 0).sections.map((s) => s.heading).join('|'));
  assert.equal(new Set(headings).size, 3, 'each style has its own headings');
  for (const st of STYLE_IDS) {
    const v = V[st];
    for (const id of SECTION_IDS) assert.ok(v.headings[id] && !CJK_RE.test(v.headings[id]), `${st}.headings.${id}`);
    for (const slot of ['opening', 'mechIntro', 'mechOutro', 'dating', 'repairIntro', 'conservationIntro', 'easterIntro', 'trace', 'specimenIntro', 'lostIntro', 'unknownMech', 'mechOutroEscape', 'mechOutroLost', 'memIntro']) {
      assert.ok(v[slot].length >= 3, `${st}.${slot} has ≥3 variants`);
    }
    for (const status of ['restored', 'partial', 'partialClean', 'irrecoverable', 'debugMemory', 'clean', 'unknown']) {
      assert.ok(v.identify[status].length >= 3, `${st}.identify.${status}`);
      assert.ok(v.subtitle[status].length >= 3, `${st}.subtitle.${status}`);
    }
    for (const g of ['restored', 'irrecoverable', 'clean', 'unknown', 'partialClean', 'debugMemory', 'escape']) assert.ok(v.closing[g].length >= 3, `${st}.closing.${g}`);
    for (const t of ['single', 'double', 'shift', 'utf8', 'utf16', 'same']) assert.ok(v.wrong[t].length >= 3, `${st}.wrong.${t}`);
    // every slot the zh-CN voice has is translated (nothing silently falls back to Chinese)
    const zh = N._internals.VOICES[st];
    for (const slot of Object.keys(zh)) {
      assert.ok(v[slot] !== zh[slot], `${st}.${slot} translated`);
      if (zh[slot] && typeof zh[slot] === 'object' && !Array.isArray(zh[slot])) for (const g of Object.keys(zh[slot])) assert.ok(v[slot][g] !== zh[slot][g], `${st}.${slot}.${g} translated`);
    }
    const strings = JSON.stringify(v, (k, x) => (typeof x === 'function' ? String(x) : x));
    assert.ok(!CJK_RE.test(strings.replace(/[烫屯葺]/g, '')), `${st}: voice text is English`);
  }
});

test('narrator-en: knowledge base is fully translated (no zh-CN fallback leaks)', () => {
  const P = N._internals.packFor('en-US');
  const strip = (s) => s.replace(new RegExp('[' + FAMOUS + ']', 'g'), '');
  for (const id of Object.keys(N.ENCODING_FACTS)) {
    const f = P.ENCODING_FACTS[id];
    for (const k of ['misread', 'bornLabel', 'birthplace', 'nickname', 'story']) assert.ok(f[k] && !CJK_RE.test(strip(f[k])), `ENCODING_FACTS[${id}].${k}`);
    for (const t of f.trivia) assert.ok(!CJK_RE.test(strip(t)), `ENCODING_FACTS[${id}].trivia`);
    assert.equal(f.born, N.ENCODING_FACTS[id].born, `${id}: years shared with zh-CN`);
  }
  for (const key of Object.keys(N.PAIR_FACTS)) {
    const p = P.PAIR_FACTS[key];
    assert.deepEqual(p.era, N.PAIR_FACTS[key].era, `${key}: same era`);
    for (const t of [p.eraWhy].concat(p.sites, p.culprits, p.tips)) assert.ok(t && !CJK_RE.test(strip(t)), `PAIR_FACTS[${key}]: ${t}`);
    assert.equal(p.tips.length, N.PAIR_FACTS[key].tips.length, `${key}: one tip per zh-CN tip`);
  }
  for (const id of Object.keys(N.SIGNATURE_FACTS)) {
    const s = P.SIGNATURE_FACTS[id];
    for (const t of [s.mechanism, s.lore, s.eraWhy, s.site].concat(s.tips, s.quips.humor, s.quips.academic, s.quips.snark)) assert.ok(t && !CJK_RE.test(strip(t)), `SIGNATURE_FACTS[${id}]: ${t}`);
    assert.equal(s.tips.length, N.SIGNATURE_FACTS[id].tips.length, `${id}: one tip per zh-CN tip`);
    if (N.SIGNATURE_FACTS[id].kind === 'debug-memory') assert.ok(s.memory && !CJK_RE.test(s.memory) && s.eraLabel, `${id}: memory / eraLabel`);
  }
  for (const id of Object.keys(N.SCHEMES)) for (const k of ['name', 'short', 'habitat']) assert.ok(!CJK_RE.test(P.SCHEMES[id][k]), `SCHEMES[${id}].${k}`);
  for (const k of Object.keys(P.LANG_NAMES)) assert.ok(!CJK_RE.test(P.LANG_NAMES[k]), `LANG_NAMES.${k}`);
  // every phrase function / string of the zh-CN pack has an English counterpart
  const ZT = N._internals.packFor('zh-CN').t;
  const walk = (zh, en, path) => {
    for (const k of Object.keys(zh)) {
      assert.ok(en[k] !== undefined, `t.${path}${k} present`);
      if (zh[k] && typeof zh[k] === 'object' && !Array.isArray(zh[k])) walk(zh[k], en[k], path + k + '.');
      else if (typeof zh[k] !== 'number' && zh[k] !== '') assert.ok(en[k] !== zh[k], `t.${path}${k} translated`);
    }
  };
  walk(ZT, P.t, '');
});

test('narrator-en: factsFor(…, { locale }) is English and numerically identical to zh-CN', () => {
  for (const c of CASES) {
    const en = N.factsFor(c.r, EN);
    const zh = N.factsFor(c.r, { locale: 'zh-CN' });
    JSON.stringify(en);
    assert.deepEqual(Object.keys(en), Object.keys(zh), `${c.id}: same keys`);
    for (const k of ['exhibitId', 'status', 'input', 'output', 'confidence']) assert.deepEqual(en[k], zh[k], `${c.id}: ${k}`);
    assert.deepEqual([en.era.start, en.era.end], [zh.era.start, zh.era.end], `${c.id}: era years`);
    assert.deepEqual(en.layers.map((l) => [l.layer, l.kind, l.pair, l.samples.map((s) => s.bytes)]), zh.layers.map((l) => [l.layer, l.kind, l.pair, l.samples.map((s) => s.bytes)]), `${c.id}: layers`);
    assert.equal(leakedCjk(JSON.stringify(en), c.r), '', `${c.id}: facts are English apart from data`);
    const blob = JSON.stringify(en);
    for (const bad of ['undefined', 'NaN', '[object Object]']) assert.ok(!blob.includes(bad), `${c.id}: no ${bad}`);
  }
  const f = N.factsFor(F.dajia, EN);
  assert.equal(f.language, 'Simplified Chinese');
  assert.equal(f.label, 'UTF-8 misread as Windows-1252', 'label spelled out when the engine label is not English');
  assert.ok(/^The Python spell for this relic: s\.encode\('cp1252'\)\.decode\('utf-8'\)\.$/.test(f.fixRecipe), f.fixRecipe);
  assert.ok(/Ken Thompson/.test(f.layers[0].trueEncoding.story));
  assert.equal(f.era.label, 'circa 2000–2018');
});

test('narrator-en: locale resolution (opts.locale, normalization, I18n, fallback)', () => {
  const r = F.dajia;
  const en = N.narrate(r, { style: 'humor', seed: 3, locale: 'en-US' });
  for (const tag of ['en', 'en-GB', 'EN-us', 'en_US']) assert.deepEqual(N.narrate(r, { style: 'humor', seed: 3, locale: tag }), en, `${tag} → en-US`);
  const zh = N.narrate(r, { style: 'humor', seed: 3, locale: 'zh-CN' });
  for (const tag of ['zh', 'zh-TW', 'zh-Hans', 'fr-FR', 'xx']) assert.deepEqual(N.narrate(r, { style: 'humor', seed: 3, locale: tag }), zh, `${tag} → zh-CN`);
  assert.equal(N._internals.packFor('fr-FR'), N._internals.packFor('zh-CN'), 'unknown locale falls back to zh-CN');
  // the active locale is restored after every call, even one that throws inside
  assert.deepEqual(N.narrate(r, { style: 'humor', seed: 3 }), zh, 'default stays zh-CN after an en-US call');
  const I = MBX.I18n;
  if (I && typeof I.setLocale === 'function' && typeof I.getLocale === 'function') {
    const prev = I.getLocale();
    try {
      I.setLocale('en-US');
      assert.deepEqual(N.narrate(r, { style: 'humor', seed: 3 }), en, 'I18n.getLocale() is read at call time');
      assert.deepEqual(N.narrate(r, { style: 'humor', seed: 3, locale: 'zh-CN' }), zh, 'opts.locale beats I18n');
      assert.deepEqual(N.styles(), N.styles('en-US'), 'styles() follows I18n');
    } finally {
      I.setLocale(prev);
    }
  }
});

test('narrator-en: malformed and minimal input never throws', () => {
  for (const r of [null, undefined, {}, { input: '' }, { input: 'x', status: 'restored' }, { input: 'x', status: 'partial', best: { output: 'y' } },
    { input: 'abc', status: 'restored', best: { output: 'abd', steps: [{ kind: 'transcode', trueEncoding: 'utf-8', wrongDecoder: 'windows-1252' }] } }]) {
    for (const style of STYLE_IDS.concat(['nope'])) {
      const n = N.narrate(r, { style, seed: 1, locale: 'en-US' });
      assert.ok(n && n.sections.length >= 5 && typeof n.plainText === 'string', `${JSON.stringify(r)}/${style}`);
      assert.ok(!/undefined|NaN|\[object Object\]/.test(JSON.stringify(n)), `${JSON.stringify(r)}/${style}: clean output`);
      assert.equal(leakedCjk(n.plainText, r || {}), '', `${JSON.stringify(r)}/${style}: English`);
    }
    assert.ok(N.factsFor(r, EN), 'factsFor tolerates it too');
  }
});
