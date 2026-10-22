'use strict';
// Tests for MBX.Narrator (src/narrator.js).
// The engine is built by another module, so these tests hand-build AnalysisResult
// fixtures per docs/ARCHITECTURE.md §6, deriving every byte and segment from Node's
// real TextEncoder/TextDecoder so the narrated "facts" are checked against reality.

const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const N = MBX.Narrator;

/* ------------------------------------------------------------------------- *
 * Fixture helpers
 * ------------------------------------------------------------------------- */

const CP437_HIGH = Array.from('ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ');
const SINGLE = new Set(['windows-1252', 'iso-8859-1', 'windows-1251', 'windows-1253', 'koi8-r', 'macintosh', 'cp437', 'ascii']);
const DOUBLE = new Set(['gbk', 'big5', 'shift_jis', 'euc-kr']);

function decodeByte(enc, b) {
  if (enc === 'iso-8859-1' || enc === 'ascii') return String.fromCharCode(b);
  if (enc === 'cp437') return b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  return new TextDecoder(enc).decode(Uint8Array.of(b));
}

// Decodes bytes and records which byte range produced each code point (a Seg[]).
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
      // a literal U+FFFD (EF BF BD) is a valid character, not a decoding error
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
  if (!['iso-8859-1', 'cp437', 'ascii'].includes(wrongDec)) {
    assert.equal(before.text, new TextDecoder(wrongDec).decode(bytes), `fixture sanity: ${wrongDec} segments match TextDecoder`);
  }
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
 * Fixtures
 * ------------------------------------------------------------------------- */

const F = {};

{ // 1. the classic: 大家好 as UTF-8 read by Windows-1252
  const { steps, input } = chainSteps('大家好', [['utf-8', 'windows-1252']]);
  F.dajia = result(input, 'restored', hyp(steps, '大家好'), {
    alternatives: [{ output: 'Ã¥Â¤Â§', confidence: 0.04, label: 'UTF-8 被误读为 Mac OS Roman', steps: [], repairs: [], lang: LANG.en }],
    signals: [{ type: 'utf8-as-1252', match: 'å¤', index: 0, hint: '疑似 UTF-8 被当作 Windows-1252 解读' }],
  });
}

{ // 2. UTF-8 read as GBK, last byte lost → repaired gap
  const full = transcodeStep('你好，世界', 'utf-8', 'gbk');
  assert.equal(full.before, '浣犲ソ锛屼笘鐣�', 'utf-8>gbk fixture matches the classic relic');
  const bytes = full.bytes.slice(0, 14); // the lone 8C became U+FFFD: re-encoding leaves a gap
  const segsBefore = full.segmentsBefore.slice(0, 7).concat([{ ch: '�', start: 14, end: 14 }]);
  const segsAfter = full.segmentsAfter.slice(0, 4).concat([{ ch: '界', start: 12, end: 14, repaired: true, candidates: ['界', '畍', '畋', '畇'] }]);
  const repair = { index: 4, from: '�', to: '界', candidates: ['界', '畍', '畋', '畇'], reason: 'gap' };
  const step = Object.assign({}, full, { bytes, segmentsBefore: segsBefore, segmentsAfter: segsAfter, repairs: [repair], lossy: true });
  F.nihaoGbk = result(full.before, 'restored', hyp([step], '你好，世界', { repairs: [repair], label: 'UTF-8 被误读为 GBK（含 1 处修复）', confidence: 0.88 }));
}

{ // 3. GBK read as Windows-1252
  const { steps, input } = chainSteps('你好', [['gbk', 'windows-1252']]);
  assert.equal(input, 'ÄãºÃ');
  F.gbk1252 = result(input, 'restored', hyp(steps, '你好', { label: 'GBK 被误读为 Windows-1252' }));
}

{ // 4. UTF-8 read as Shift_JIS
  const { steps, input } = chainSteps('こんにちは', [['utf-8', 'shift_jis']]);
  assert.equal(input, '縺薙ｓ縺ｫ縺｡縺ｯ');
  F.sjis = result(input, 'restored', hyp(steps, 'こんにちは', { lang: LANG.ja, label: 'UTF-8 被误读为 Shift_JIS' }));
}

{ // 5. double layer: UTF-8 → 1252 → UTF-8 → 1252
  const { steps, input } = chainSteps('大家', [['utf-8', 'windows-1252'], ['utf-8', 'windows-1252']]);
  assert.equal(input, 'Ã¥Â¤Â§Ã¥Â®Â¶');
  F.double = result(input, 'restored', hyp(steps, '大家', { label: 'UTF-8 被误读为 Windows-1252（两层）' }));
}

{ // 6. percent escape only
  const input = '%E5%A4%A7%E5%AE%B6%E5%A5%BD';
  F.percent = result(input, 'restored', hyp([unescapeStep(input, 'percent', 'utf-8', '大家好')], '大家好', { label: '百分号编码（UTF-8）' }));
}

{ // 7. percent escape wrapped around a UTF-8 → 1252 relic
  const inner = transcodeStep('大', 'utf-8', 'windows-1252'); // 'å¤§'
  const input = '%C3%A5%C2%A4%C2%A7';
  F.percentMojibake = result(input, 'restored', hyp([unescapeStep(input, 'percent', 'utf-8', inner.before), inner], '大', { label: '百分号编码 + UTF-8 被误读为 Windows-1252' }));
}

{ // 8. HTML entities (no bytes) and \u escapes with an emoji
  F.html = result('&#22823;&#23478;', 'restored', hyp([unescapeStep('&#22823;&#23478;', 'html-entity', 'utf-8', '大家')], '大家', { label: 'HTML 字符实体' }));
  const esc = '\\u597D\\uD83D\\uDE00';
  F.uescape = result(esc, 'restored', hyp([unescapeStep(esc, 'unicode-escape', 'utf-8', '好😀')], '好😀', { label: 'Unicode 转义' }));
}

{ // 9. emoji + euro evidence for byte dating
  const { steps, input } = chainSteps('好😀', [['utf-8', 'windows-1252']]);
  F.emoji = result(input, 'restored', hyp(steps, '好😀'));
  const e2 = chainSteps('价格 €5', [['utf-8', 'windows-1252']]);
  F.euro = result(e2.input, 'restored', hyp(e2.steps, '价格 €5'));
}

{ // 10. more classic pairs
  const k = chainSteps('Привет', [['koi8-r', 'windows-1251']]);
  F.koi8 = result(k.input, 'restored', hyp(k.steps, 'Привет', { lang: LANG.ru, label: 'KOI8-R 被误读为 Windows-1251' }));
  const z = chainSteps('中文.txt', [['gbk', 'cp437']]);
  F.zip = result(z.input, 'restored', hyp(z.steps, '中文.txt', { label: 'ZIP 文件名：GBK 被误读为 CP437' }));
  const b = chainSteps('大家好', [['big5', 'gbk']]);
  F.big5gbk = result(b.input, 'restored', hyp(b.steps, '大家好', { lang: { lang: 'zh-Hant', name: '繁体中文', confidence: 0.8 }, label: 'Big5 被误读为 GBK' }));
  const s5c = chainSteps('表示', [['shift_jis', 'windows-1252']]);
  F.sjis5c = result(s5c.input, 'restored', hyp(s5c.steps, '表示', { lang: LANG.ja, label: 'Shift_JIS 被误读为 Windows-1252' }));
}

{ // 11. a real but uncatalogued pair, and two encodings nobody has heard of
  const g = chainSteps('Καλημέρα', [['windows-1253', 'koi8-r']]);
  assert.equal(g.input, 'йАКГЛщЯА');
  F.unknownPair = result(g.input, 'restored', hyp(g.steps, 'Καλημέρα', { lang: LANG.el, label: 'Windows-1253 被误读为 KOI8-R', confidence: 0.55 }), {
    alternatives: [{ output: 'κΑΛΗΜΈΡΑ', confidence: 0.2, label: '另一种希腊文读法', steps: [] }],
  });
  const bytes = Uint8Array.of(0xa1, 0xb2);
  F.alien = result('¡²', 'restored', hyp([{
    kind: 'transcode', wrongDecoder: 'x-vulcan', trueEncoding: 'x-klingon', scheme: null,
    before: '¡²', after: 'Ж', bytes,
    segmentsBefore: [{ ch: '¡', start: 0, end: 1 }, { ch: '²', start: 1, end: 2 }],
    segmentsAfter: [{ ch: 'Ж', start: 0, end: 2 }],
    repairs: [], lossy: false, scoreBefore: -8, scoreAfter: -3, prior: 0.1,
  }], 'Ж', { label: '未知编码链路', confidence: 0.4 }));
}

{ // 12. signatures
  const kjk = '锟斤拷锟斤拷';
  F.kunjinkao = result(kjk, 'irrecoverable', null, {
    signatures: [sig('kunjinkao', '锟斤拷', kjk, '锟斤拷'), Object.assign(sig('kunjinkao', '锟斤拷', kjk, '锟斤拷'), { index: 3 })],
  });
  const kjkStep = transcodeStep('��', 'utf-8', 'gbk');
  assert.equal(kjkStep.before, '锟斤拷');
  F.kunjinkaoBest = result('锟斤拷', 'irrecoverable', hyp([kjkStep], '��', { confidence: 0.6, label: 'UTF-8 被误读为 GBK（替换字符）' }), {
    signatures: [sig('kunjinkao', '锟斤拷', '锟斤拷', '锟斤拷')],
  });
  F.kunjinkaoBig5 = result('嚙踝蕭嚙踝蕭', 'irrecoverable', null, { signatures: [sig('kunjinkao-big5', '嚙踝蕭', '嚙踝蕭嚙踝蕭', '嚙踝蕭')] });
  F.tang = result('烫烫烫烫烫烫', 'irrecoverable', null, { signatures: [sig('tangtangtang', '烫烫烫', '烫烫烫烫烫烫', '烫烫烫烫烫烫')] });
  F.tun = result('屯屯屯屯', 'irrecoverable', null, { signatures: [sig('tuntuntun', '屯屯屯', '屯屯屯屯', '屯屯屯屯')] });

  const bom = chainSteps('\uFEFFHello', [['utf-8', 'windows-1252']]);
  assert.equal(bom.input, 'ï»¿Hello');
  F.bom = result(bom.input, 'restored', hyp(bom.steps, '\uFEFFHello', { lang: LANG.en }), { signatures: [sig('utf8-bom-1252', 'UTF-8 BOM', bom.input, 'ï»¿')] });

  const u16 = chainSteps('\uFEFFHi', [['utf-16le', 'windows-1252']]);
  assert.equal(u16.input, 'ÿþH\u0000i\u0000');
  F.utf16bom = result(u16.input, 'restored', hyp(u16.steps, '\uFEFFHi', { lang: LANG.en, label: 'UTF-16LE 被误读为 Windows-1252' }), { signatures: [sig('utf16-bom', 'UTF-16 BOM', u16.input, 'ÿþ')] });

  const rep = 'Gr��e aus K�ln, sch�n';
  F.replacement = result(rep, 'irrecoverable', null, { signatures: [sig('replacement', '替换字符', rep, '��')] });
  const qm = '????, ???????!';
  F.questions = result(qm, 'irrecoverable', null, { signatures: [sig('question-marks', '问号', qm, '????')] });

  const bush = chainSteps('Bush hid the facts', [['ascii', 'utf-16le']]);
  assert.equal(bush.input, '畂桳栠摩琠敨映捡獴');
  F.bush = result(bush.input, 'restored', hyp(bush.steps, 'Bush hid the facts', { lang: LANG.en, label: 'ASCII 被误读为 UTF-16LE' }), {
    signatures: [sig('notepad-bush', 'Bush hid the facts', bush.input, bush.input)],
  });
}

{ // 13. remaining statuses
  F.clean = result('你好，世界。今天天气不错。', 'clean', null, { inputScore: { value: -2.0, total: -24, length: 13, lang: 'zh-Hans', script: 'Hani', badness: 0, flags: [] } });
  F.cleanAscii = result('Hello, world!', 'clean', null, { inputScore: { value: -1.9, total: -25, length: 13, lang: 'en', script: 'Latn', badness: 0, flags: [] } });
  F.lost = result('Caf� cr�me br�l�e', 'irrecoverable', null);

  const frag = transcodeStep('好', 'utf-8', 'windows-1252');
  F.partial = result('大家 å¥½ 朋友', 'partial', hyp([frag], '大家 好 朋友', { confidence: 0.7, label: '局部：UTF-8 被误读为 Windows-1252' }));

  const altStep = transcodeStep('Ω', 'utf-8', 'windows-1252');
  F.unknown = result('ʞɐɥ ⊕⊗⌘ ҈҉ Ð', 'unknown', null, {
    signals: [{ type: 'utf8-as-1252', match: 'Ð', index: 12, hint: '疑似 UTF-8 被当作 Windows-1252 解读' }, { type: 'mixed-script', match: 'ʞɐɥ', index: 0, hint: '一个词里混用了多种文字' }],
    alternatives: [{ output: '某种猜测', confidence: 0.08, label: 'UTF-8 被误读为 GBK', steps: [altStep] }],
  });
  F.unknownBare = result('qzx vbn', 'unknown', null);
}

const ALL = Object.keys(F);
const STYLE_IDS = ['humor', 'academic', 'snark'];
const SECTION_IDS = ['opening', 'identify', 'mechanism', 'dating', 'repair', 'conservation', 'easter', 'closing'];

function narr(name, style, seed) {
  return N.narrate(F[name], { style, seed, strict: true });
}

function codeSpansStripped(text) {
  return text.replace(/`[^`]*`/g, '');
}

function checkNarration(n, label) {
  assert.ok(/^MBX-\d{4}-[0-9A-F]{4}$/.test(n.exhibitId), `${label}: exhibitId ${n.exhibitId}`);
  for (const k of ['title', 'subtitle', 'site', 'plainText']) {
    assert.ok(typeof n[k] === 'string' && n[k].trim().length > 0, `${label}: ${k} non-empty string`);
  }
  assert.ok(n.title.startsWith('『') && n.title.endsWith('』'), `${label}: title in 『』`);
  assert.ok(n.era && typeof n.era.label === 'string' && n.era.label.length > 0, `${label}: era.label`);
  assert.ok(typeof n.era.reason === 'string', `${label}: era.reason`);
  assert.ok(Array.isArray(n.tags) && n.tags.length > 0 && n.tags.every((t) => typeof t === 'string' && t.length > 0), `${label}: tags`);
  assert.ok(Array.isArray(n.sections) && n.sections.length >= 6, `${label}: at least 6 sections`);

  const ids = n.sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: unique section ids`);
  let last = -1;
  for (const s of n.sections) {
    const pos = SECTION_IDS.indexOf(s.id);
    assert.ok(pos > last, `${label}: section ${s.id} is known and in contract order`);
    last = pos;
    assert.ok(typeof s.heading === 'string' && s.heading.length > 0, `${label}: ${s.id} heading`);
    assert.ok(typeof s.text === 'string' && s.text.trim().length > 10, `${label}: ${s.id} text`);
    // markup contract: only **bold**, `code` and newlines
    assert.equal((s.text.match(/`/g) || []).length % 2, 0, `${label}: ${s.id} balanced backticks`);
    assert.equal((s.text.match(/\*\*/g) || []).length % 2, 0, `${label}: ${s.id} balanced bold`);
    const outside = codeSpansStripped(s.text);
    assert.ok(!/<\/?[a-z][^>]*>/i.test(outside), `${label}: ${s.id} has no HTML outside code`);
    assert.ok(!/^#{1,6}\s/m.test(outside), `${label}: ${s.id} has no markdown headings`);
    assert.ok(!/\[[^\]]+\]\([^)]+\)/.test(outside), `${label}: ${s.id} has no markdown links`);
    assert.ok(!/__|(^|[^*])\*([^*]|$)/.test(outside.replace(/\*\*/g, '')), `${label}: ${s.id} no stray emphasis markers`);
  }
  for (const req of ['opening', 'identify', 'mechanism', 'dating', 'conservation', 'closing']) {
    assert.ok(ids.includes(req), `${label}: has ${req}`);
  }
  assert.ok(!/\*\*|`/.test(n.plainText), `${label}: plainText has no markup`);
  for (const s of n.sections) assert.ok(n.plainText.includes(s.heading), `${label}: plainText includes heading ${s.heading}`);

  const blob = JSON.stringify(n);
  for (const bad of ['undefined', 'NaN', 'null', '[object Object]']) {
    assert.ok(!blob.includes(bad), `${label}: narration must not contain "${bad}"`);
  }
}

const mech = (n) => n.sections.find((s) => s.id === 'mechanism').text;
const sec = (n, id) => (n.sections.find((s) => s.id === id) || { text: '' }).text;

/* ------------------------------------------------------------------------- *
 * Tests
 * ------------------------------------------------------------------------- */

test('narrator: module exports the contract surface', () => {
  assert.ok(N && typeof N.narrate === 'function' && typeof N.factsFor === 'function', 'narrate/factsFor exist');
  assert.equal(MBX.Narrator, N, 'mounted on MBX');
  assert.deepEqual(N.STYLES.map((s) => s.id), STYLE_IDS);
  for (const s of N.STYLES) assert.ok(s.name && s.avatar && s.docents.length >= 3, `style ${s.id} has name/avatar/docents`);
});

test('narrator: knowledge base covers every contract encoding and classic pair', () => {
  const ids = ['utf-8', 'gbk', 'big5', 'shift_jis', 'euc-jp', 'euc-kr', 'windows-1252', 'iso-8859-1', 'windows-1251', 'koi8-r',
    'macintosh', 'cp437', 'ibm866', 'windows-1250', 'windows-1253', 'windows-1254', 'windows-1255', 'windows-1256', 'windows-874', 'utf-16le', 'utf-16be'];
  for (const id of ids) {
    const f = N.ENCODING_FACTS[id];
    assert.ok(f && f.name && f.bornLabel && f.story && f.py && f.iconv && Number.isFinite(f.born), `ENCODING_FACTS[${id}] complete`);
    assert.ok(['utf8', 'utf16', 'single', 'double'].includes(f.type), `${id} type`);
  }
  const pairs = ['utf-8>windows-1252', 'utf-8>gbk', 'gbk>windows-1252', 'gbk>iso-8859-1', 'utf-8>shift_jis', 'shift_jis>windows-1252',
    'utf-8>windows-1251', 'koi8-r>windows-1251', 'windows-1251>koi8-r', 'koi8-r>iso-8859-1', 'big5>gbk', 'gbk>big5', 'big5>windows-1252',
    'gbk>cp437', 'utf-8>cp437', 'shift_jis>gbk', 'gbk>shift_jis', 'euc-kr>windows-1252', 'euc-jp>shift_jis', 'utf-8>macintosh',
    'windows-1252>utf-8', 'ascii>utf-16le'];
  for (const key of pairs) {
    const p = N.PAIR_FACTS[key];
    assert.ok(p, `PAIR_FACTS has ${key}`);
    assert.ok(Array.isArray(p.era) && p.era.length === 2 && p.era[0] >= 1960 && (p.era[1] === null || p.era[1] >= p.era[0]), `${key} era`);
    assert.ok(p.sites.length >= 1 && p.culprits.length >= 1 && p.tips.length >= 2 && p.eraWhy, `${key} sites/culprits/tips`);
    for (const enc of key.split('>')) assert.ok(N.ENCODING_FACTS[enc], `${key}: ${enc} is a known encoding`);
  }
  for (const id of ['kunjinkao', 'kunjinkao-big5', 'tangtangtang', 'tuntuntun', 'utf8-bom-1252', 'utf16-bom', 'replacement', 'question-marks', 'notepad-bush']) {
    const s = N.SIGNATURE_FACTS[id];
    assert.ok(s && s.title && s.mechanism && s.lore && s.site && s.tips.length, `SIGNATURE_FACTS[${id}]`);
    for (const st of STYLE_IDS) assert.ok(s.quips[st] && s.quips[st].length >= 1, `${id} has ${st} quip`);
  }
});

test('narrator: signature byte facts are true (checked with TextDecoder)', () => {
  const check = (id, enc) => {
    const text = N.SIGNATURE_FACTS[id].mechanism;
    const re = /`([0-9A-F]{2}) ([0-9A-F]{2})`→「(.)」/g;
    let m;
    let n = 0;
    while ((m = re.exec(text))) {
      const got = new TextDecoder(enc).decode(Uint8Array.of(parseInt(m[1], 16), parseInt(m[2], 16)));
      assert.equal(got, m[3], `${id}: ${m[1]} ${m[2]} in ${enc}`);
      n++;
    }
    assert.equal(n, 3, `${id}: three byte claims checked`);
  };
  check('kunjinkao', 'gbk');
  check('kunjinkao-big5', 'big5');
  assert.equal(new TextDecoder('gbk').decode(Uint8Array.of(0xcc, 0xcc)), '烫');
  assert.equal(new TextDecoder('gbk').decode(Uint8Array.of(0xcd, 0xcd)), '屯');
  assert.equal(new TextDecoder('gbk').decode(Uint8Array.of(0xdd, 0xdd)), '葺');
  assert.ok(N.SIGNATURE_FACTS.tuntuntun.mechanism.includes('「葺」'));
  assert.equal(new TextDecoder('gbk').decode(Uint8Array.of(0xef, 0xbb)), '锘');
  assert.equal(new TextDecoder('windows-1252').decode(Uint8Array.of(0xef, 0xbb, 0xbf)), 'ï»¿');
  assert.equal(new TextDecoder('utf-16le').decode(Buffer.from('Bush hid the facts')), '畂桳栠摩琠敨映捡獴');
  assert.ok(N.SIGNATURE_FACTS['notepad-bush'].mechanism.includes('畂桳栠摩琠敨映捡獴'));
  // trivia that names specific bytes
  assert.equal(new TextDecoder('shift_jis').decode(Uint8Array.of(0x95, 0x5c, 0x83, 0x5c, 0x94, 0x5c)), '表ソ能');
  assert.equal(new TextDecoder('big5').decode(Uint8Array.of(0xb3, 0x5c, 0xa5, 0x5c, 0xbb, 0x5c)), '許功蓋');
  assert.equal(new TextDecoder('macintosh').decode(Uint8Array.of(0xf0)).codePointAt(0), 0xf8ff);
  assert.equal(new TextDecoder('gbk').decode(Uint8Array.of(0x80)), '€');
  assert.equal(new TextDecoder('gbk').decode(Uint8Array.of(0xef, 0xbc)), '锛');
  assert.equal(String.fromCharCode(...[0xf0, 0xd2, 0xc9, 0xd7, 0xc5, 0xd4].map((b) => b & 0x7f)), 'pRIWET');
  assert.equal(new TextDecoder('koi8-r').decode(Uint8Array.of(0xf0, 0xd2, 0xc9, 0xd7, 0xc5, 0xd4)), 'Привет');
});

test('narrator: every fixture × style × seed produces a well-formed narration', () => {
  let count = 0;
  for (const name of ALL) {
    for (const style of STYLE_IDS) {
      for (const seed of [0, 1, 7, 12345]) {
        const n = narr(name, style, seed);
        checkNarration(n, `${name}/${style}/${seed}`);
        assert.equal(n.style, style);
        count++;
      }
    }
  }
  assert.ok(count >= ALL.length * 12, 'ran the whole matrix');
});

test('narrator: deterministic for the same (input, style, seed)', () => {
  for (const name of ALL) {
    for (const style of STYLE_IDS) {
      assert.deepEqual(narr(name, style, 42), narr(name, style, 42), `${name}/${style}`);
    }
  }
  // default seed is stable too, and fractional seeds (Math.random()) do not collapse
  assert.deepEqual(N.narrate(F.dajia), N.narrate(F.dajia));
  assert.notEqual(N.narrate(F.dajia, { seed: 0.25 }).plainText, N.narrate(F.dajia, { seed: 0.75 }).plainText);
});

test('narrator: a new seed ("换一位讲解员") changes the narration for most fixtures', () => {
  for (const style of STYLE_IDS) {
    let differ = 0;
    for (const name of ALL) {
      if (narr(name, style, 1).plainText !== narr(name, style, 2).plainText) differ++;
    }
    assert.ok(differ >= Math.ceil(ALL.length * 0.9), `${style}: ${differ}/${ALL.length} differ`);
  }
  // consecutive seeds always rotate the docent
  const names = new Set([0, 1, 2].map((s) => N.narrate(F.dajia, { style: 'humor', seed: s }).docent.name));
  assert.equal(names.size, 3, 'three seeds, three docents');
});

test('narrator: exhibitId depends only on the input', () => {
  const ids = new Set();
  for (const style of STYLE_IDS) for (const seed of [0, 9]) ids.add(narr('dajia', style, seed).exhibitId);
  assert.equal(ids.size, 1);
  assert.notEqual(narr('dajia', 'humor', 0).exhibitId, narr('gbk1252', 'humor', 0).exhibitId);
});

test('narrator: styles have distinct voices and ≥3 template variants per section', () => {
  const headings = STYLE_IDS.map((st) => narr('dajia', st, 0).sections.map((s) => s.heading).join('|'));
  assert.equal(new Set(headings).size, 3, 'each style has its own headings');
  const V = N._internals.VOICES;
  for (const st of STYLE_IDS) {
    const v = V[st];
    for (const slot of ['opening', 'mechIntro', 'mechOutro', 'dating', 'repairIntro', 'conservationIntro', 'easterIntro', 'trace', 'specimenIntro', 'lostIntro', 'unknownMech']) {
      assert.ok(v[slot].length >= 3, `${st}.${slot} has ≥3 variants`);
    }
    for (const status of ['restored', 'partial', 'irrecoverable', 'clean', 'unknown']) {
      assert.ok(v.identify[status].length >= 3, `${st}.identify.${status}`);
      assert.ok(v.subtitle[status].length >= 3, `${st}.subtitle.${status}`);
    }
    for (const g of ['restored', 'irrecoverable', 'clean', 'unknown']) assert.ok(v.closing[g].length >= 3, `${st}.closing.${g}`);
    for (const t of ['single', 'double', 'utf8', 'utf16', 'same']) assert.ok(v.wrong[t].length >= 3, `${st}.wrong.${t}`);
    for (const slot of ['mechOutroEscape', 'mechOutroLost']) assert.ok(v[slot].length >= 3, `${st}.${slot} has ≥3 variants`);
  }
  // across seeds, every style actually uses several opening variants
  for (const st of STYLE_IDS) {
    const openings = new Set();
    for (let seed = 0; seed < 40; seed++) openings.add(narr('dajia', st, seed).sections[0].text.replace(/讲解员.{1,6}|研究员.{1,6}|鉴定师.{1,6}/g, ''));
    assert.ok(openings.size >= 3, `${st}: ${openings.size} distinct openings`);
  }
});

test('narrator: 大家好 mechanism quotes the real bytes in every style', () => {
  for (const style of STYLE_IDS) {
    for (const seed of [0, 3, 8]) {
      const m = mech(narr('dajia', style, seed));
      assert.ok(m.includes('E5 A4 A7'), `${style}/${seed}: has E5 A4 A7`);
      assert.ok(m.includes('「大」'), `${style}/${seed}: names 大`);
      assert.ok(m.includes('`å`') && m.includes('`¤`') && m.includes('`§`'), `${style}/${seed}: shows å ¤ §`);
    }
  }
  const academic = mech(narr('dajia', 'academic', 0));
  assert.ok(academic.includes('`1110xxxx 10xxxxxx 10xxxxxx`') && academic.includes('`11100101 10100100 10100111`'), 'academic shows the UTF-8 bit layout');
  assert.ok(academic.includes('`E5`→`å`'), 'academic maps byte to glyph');
  const humor = mech(narr('dajia', 'humor', 0));
  assert.ok(humor.includes('E5'), 'fingerprint mentions lead byte');
  assert.ok(/3 个原字符.*9 个字符/.test(humor), 'growth ratio 3 → 9');
});

test('narrator: multi-byte wrong decoders explain the misaligned bite', () => {
  for (const style of STYLE_IDS) {
    const m = mech(narr('nihaoGbk', style, 0));
    assert.ok(m.includes('E4 BD A0'), `${style}: 你 = E4 BD A0`);
    assert.ok(m.includes('`E4 BD`→`浣`'), `${style}: E4 BD bitten as 浣`);
    assert.ok(m.includes('`A0 E5`→`犲`（`E5` 借自下一个字「好」）'), `${style}: cross-boundary bite explained`);
  }
  const sj = mech(narr('sjis', 'academic', 0));
  assert.ok(sj.includes('E3 81 93'), 'こ = E3 81 93');
  assert.ok(sj.includes('半角片假名'), 'mentions half-width katakana singles');
  assert.ok(/跨字符边界|拼合/.test(sj), 'counts the cross-boundary bites');
  const g = mech(narr('gbk1252', 'academic', 0));
  assert.ok(g.includes('C4 E3') && g.includes('`C4`→`Ä`') && g.includes('`E3`→`ã`'), 'GBK 你 = C4 E3 → Ä ã');
  const bush = mech(narr('bush', 'humor', 0));
  assert.ok(bush.includes('`42 75`→`畂`'), 'ASCII pairs fused into UTF-16 code units');
  // the "every 6 bytes realign" (LCM) remark is only true when every bite is two bytes
  assert.ok(mech(narr('nihaoGbk', 'humor', 0)).includes('最小公倍数是 6'), 'LCM remark for UTF-8 → GBK');
  for (const style of STYLE_IDS) assert.ok(!mech(narr('sjis', style, 0)).includes('最小公倍数'), `${style}: no LCM remark when half-width singles break the rhythm`);
  // same-width pairs (Big5 → GBK, KOI8-R → 1251) are a table swap, not a misaligned bite
  const V = N._internals.VOICES;
  for (const style of STYLE_IDS) {
    for (const [name, E, W] of [['big5gbk', 'Big5', 'GBK'], ['koi8', 'KOI8-R', 'Windows-1251']]) {
      const m = mech(narr(name, style, 0));
      const filled = V[style].wrong.same.map((t) => t.replace(/\{E\}/g, E).replace(/\{W\}/g, W));
      assert.ok(filled.some((t) => m.includes(t)), `${style}/${name}: same-width wording`);
      assert.ok(!m.includes('大卸八块') && !m.includes('越咬越错位'), `${style}/${name}: no dismemberment/misalignment claim`);
    }
  }
  // UTF-16 read as single-byte: the 00 bytes are explained
  assert.ok(mech(narr('utf16bom', 'academic', 0)).includes('2 个 `U+0000`'), 'NUL bytes counted');
  assert.ok(!mech(narr('utf16bom', 'academic', 0)).includes('（`U+FEFF`）（'), 'no duplicated code point for invisible chars');
});

test('narrator: multi-layer relics are narrated stratum by stratum, deepest first', () => {
  for (const style of STYLE_IDS) {
    const m = mech(narr('double', style, 0));
    // told in formation order, numbered like the strata panel and the Step contract (第 1 层 = 地表)
    const deep = m.indexOf('**第 2 层（最深层）**');
    const top = m.indexOf('**第 1 层（地表层）**');
    assert.ok(deep >= 0 && top > deep, `${style}: layers in formation order`);
    assert.ok(m.slice(deep, top).includes('E5 A4 A7'), `${style}: deepest layer shows 大 = E5 A4 A7`);
    assert.ok(m.slice(top).includes('C3 A5'), `${style}: surface layer re-encodes å as C3 A5`);
    assert.ok(m.slice(top).includes('`Ã`'), `${style}: å becomes Ã`);
  }
  const n = narr('double', 'humor', 0);
  assert.ok(n.title.includes('双层地层'), n.title);
  assert.ok(n.era.reason.includes('迁移'), 'dating mentions the double migration');
  assert.ok(sec(n, 'conservation').includes(".encode('cp1252').decode('utf-8').encode('cp1252').decode('utf-8')"), 'two-layer python recipe');
});

test('narrator: escape layers (percent / html / \\u) are explained', () => {
  for (const style of STYLE_IDS) {
    const m = mech(narr('percent', style, 0));
    assert.ok(m.includes('百分号编码') && m.includes('`%E5%A4%A7`') && m.includes('E5 A4 A7'), `${style}: percent`);
    const pm = mech(narr('percentMojibake', style, 0));
    assert.ok(pm.includes('E5 A4 A7') && pm.includes('`%C3%A5`'), `${style}: percent wrapped mojibake traced upward`);
    const h = mech(narr('html', style, 0));
    assert.ok(h.includes('`&#22823;`') && h.includes('U+5927'), `${style}: html entity decimal code point`);
    const u = mech(narr('uescape', style, 0));
    assert.ok(u.includes('`\\u597D`') && u.includes('代理项'), `${style}: \\u escape`);
  }
  assert.ok(narr('percent', 'humor', 0).title.includes('百分号封装'));
  // growth ratio counts only mis-decoding strata: 大 → å¤§ is 3×, not the 18 chars of %C3%A5…
  assert.ok(/1 个原字符经过误读，膨胀成了 3 个字符/.test(mech(narr('percentMojibake', 'humor', 0))), 'ratio ignores the escape wrapper');
  // escape-only relics are "wrapped", not "mis-read": their outro must not blame missing charsets
  for (const style of STYLE_IDS) {
    for (const seed of [0, 1, 2, 3]) {
      const lastLine = mech(narr('percent', style, seed)).split('\n').pop();
      assert.ok(N._internals.VOICES[style].mechOutroEscape.includes(lastLine), `${style}/${seed}: escape outro`);
    }
  }
  assert.ok(narr('percent', 'humor', 0).site.includes('URL'), 'site mentions the URL habitat');
  assert.ok(sec(narr('percent', 'academic', 0), 'conservation').includes("urllib.parse.unquote(s, encoding='utf-8')"));
});

test('narrator: byte dating uses evidence from the data', () => {
  assert.ok(narr('dajia', 'humor', 0).era.label === '约 2000–2018 年', narr('dajia', 'humor', 0).era.label);
  const emoji = narr('emoji', 'academic', 0);
  assert.ok(/^约 2010/.test(emoji.era.label), emoji.era.label);
  assert.ok(emoji.era.reason.includes('Unicode 6.0'), 'emoji evidence cites Unicode 6.0');
  assert.ok(/utf8mb4/.test(sec(emoji, 'conservation')), 'emoji → utf8mb4 advice');
  const euro = narr('euro', 'humor', 0);
  assert.ok(euro.era.reason.includes('欧元'), 'euro evidence');
  const dbl = narr('double', 'humor', 0);
  assert.ok(/^约 2002/.test(dbl.era.label), dbl.era.label);
  assert.ok(narr('koi8', 'humor', 0).era.reason.includes('RFC 1489'), 'KOI8-R evidence');
  assert.ok(narr('big5gbk', 'humor', 0).era.reason.includes('BBS'), 'cross-strait evidence');
  const zip = narr('zip', 'humor', 0);
  assert.ok(zip.era.reason.includes('ZIP') && zip.site.includes('ZIP'), 'ZIP + CP437 evidence and site');
  assert.ok(/unzip -O CP936|7z x -mcp=936|metadata_encoding/.test(sec(zip, 'conservation')) || sec(zip, 'conservation').includes("decode('gbk')"), 'ZIP rescue tip');
  assert.equal(narr('bush', 'humor', 0).era.label, '约 2000–2007 年');
  assert.ok(narr('clean', 'humor', 0).era.label.startsWith('当代'));
  assert.equal(narr('tang', 'humor', 0).era.label, '上世纪 90 年代至今');
  assert.equal(narr('unknownBare', 'humor', 0).era.label, '年代不详');
});

test('narrator: excavation sites and conservation tips follow the pair', () => {
  const sites = new Set();
  for (let seed = 0; seed < 12; seed++) sites.add(narr('dajia', 'humor', seed).site);
  assert.ok(sites.size >= 2, 'several plausible sites across docents');
  for (const s of sites) assert.ok(N.PAIR_FACTS['utf-8>windows-1252'].sites.includes(s), `site from the pair table: ${s}`);
  const c = sec(narr('dajia', 'humor', 0), 'conservation');
  assert.ok(c.includes('<meta charset="utf-8">'), 'meta charset tip always first for utf-8>windows-1252');
  assert.ok(c.includes(".encode('cp1252').decode('utf-8')"), 'relic-specific python recipe');
  const g = sec(narr('nihaoGbk', 'academic', 0), 'conservation');
  assert.ok(g.includes(".encode('gbk').decode('utf-8')"), 'gbk recipe');
  assert.ok(g.includes('缺口'), 'recipe warns that gaps need repair');
  const s = sec(narr('sjis5c', 'humor', 0), 'easter');
  assert.ok(s.includes('ダメ文字') && s.includes('95 5C'), 'Shift_JIS 0x5C easter egg from real bytes');
  const k = sec(narr('koi8', 'humor', 0), 'easter');
  assert.ok(k.includes('pRIWET'), 'KOI8-R 8th-bit easter egg computed from bytes');
});

test('narrator: repair section appears only when repairs exist', () => {
  for (const style of STYLE_IDS) {
    const n = narr('nihaoGbk', style, 0);
    const r = sec(n, 'repair');
    assert.ok(r.includes('第 5 个字') && r.includes('「界」') && r.includes('「畍」'), `${style}: gap repair with candidates`);
    assert.ok(mech(n).includes('缺口'), `${style}: mechanism mentions the gap`);
    assert.ok(!narr('dajia', style, 0).sections.some((x) => x.id === 'repair'), `${style}: no repair section without repairs`);
  }
  const nb = JSON.parse(JSON.stringify(F.dajia));
  nb.best.steps[0].bytes = F.dajia.best.steps[0].bytes;
  nb.best.repairs = [{ index: 0, from: ' ', to: 'à', candidates: ['à'], reason: 'nbsp' }, { index: 1, from: '', to: 'Á', candidates: ['Á', 'Ý'], reason: 'dropped' }];
  const r2 = sec(N.narrate(nb, { style: 'academic', strict: true }), 'repair');
  assert.ok(r2.includes('NBSP') && r2.includes('`81` `8D` `8F` `90` `9D`'), 'nbsp and dropped-byte repairs explained');
});

test('narrator: every signature gets its dedicated narration', () => {
  const expect = {
    kunjinkao: ['锟斤拷', 'EF BF BD'],
    kunjinkaoBest: ['锟斤拷', 'EF BF BD'],
    kunjinkaoBig5: ['嚙踝蕭', 'Big5'],
    tang: ['烫', '0xCC', 'INT 3'],
    tun: ['屯', '0xCD'],
    bom: ['EF BB BF', 'BOM'],
    utf16bom: ['FF FE', 'BOM'],
    replacement: ['U+FFFD', 'EF BF BD'],
    questions: ['3F', '?'],
    bush: ['IsTextUnicode', 'Vista'],
  };
  for (const [name, needles] of Object.entries(expect)) {
    for (const style of STYLE_IDS) {
      const n = narr(name, style, 0);
      const text = n.sections.map((s) => s.text).join('\n');
      for (const nd of needles) assert.ok(text.includes(nd), `${name}/${style}: mentions ${nd}`);
      assert.ok(n.sections.some((s) => s.id === 'easter'), `${name}/${style}: easter section`);
    }
  }
  assert.ok(narr('kunjinkao', 'humor', 0).title.includes('锟斤拷'), 'signature-only relic titled after the signature');
  assert.ok(narr('kunjinkao', 'humor', 0).tags.includes('名器：锟斤拷'));
  assert.ok(sec(narr('kunjinkao', 'snark', 0), 'identify').includes('2 处'), 'counts signature occurrences');
  // the mechanism text is not repeated verbatim in the easter egg
  const k = narr('kunjinkao', 'academic', 0);
  assert.ok(!sec(k, 'easter').includes(N.SIGNATURE_FACTS.kunjinkao.mechanism), 'no duplicated mechanism');
  const ubom = narr('utf16bom', 'humor', 0);
  assert.ok(ubom.sections[0].text.includes('▫'), 'NUL bytes in the relic quote are made visible');
});

test('narrator: statuses clean / irrecoverable / partial / unknown read correctly', () => {
  for (const style of STYLE_IDS) {
    const clean = narr('clean', style, 0);
    assert.ok(clean.title.includes('真品'), `${style}: clean title`);
    assert.ok(!clean.sections.some((s) => s.id === 'repair'), `${style}: clean has no repair`);
    assert.ok(mech(clean).includes('E4 BD A0'), `${style}: clean specimen shows 你 = E4 BD A0`);
    assert.ok(mech(narr('cleanAscii', style, 0)).includes('ASCII'), `${style}: ascii specimen`);

    const lost = narr('lost', style, 0);
    assert.ok(lost.title.includes('不可逆'), `${style}: irrecoverable title`);
    assert.ok(sec(lost, 'identify').includes('4 个替换字符'), `${style}: counts U+FFFD`);
    assert.ok(mech(lost).includes('EF BF BD'), `${style}: explains U+FFFD bytes`);

    const part = narr('partial', style, 0);
    // the untouched text of this fixture was never garbled: a local misreading, not a broken remnant
    assert.ok(part.title.includes('局部误读') && !part.title.includes('残件'), `${style}: partial title (${part.title})`);
    assert.ok(sec(part, 'identify').includes('「å¥½」被还原成了「好」'), `${style}: partial names the repaired fragment`);
    assert.ok(mech(part).includes('E5 A5 BD'), `${style}: partial mechanism uses real bytes of 好`);

    const unk = narr('unknown', style, 0);
    assert.ok(unk.title.includes('来历待考'), `${style}: unknown title`);
    assert.ok(sec(unk, 'identify').includes('疑似 UTF-8 被当作 Windows-1252 解读'), `${style}: signals surfaced`);
    assert.ok(sec(unk, 'identify').includes('「某种猜测」'), `${style}: alternative surfaced`);
    assert.ok(mech(unk).includes('CE A9'), `${style}: alternative hypothesis bytes`);
    assert.ok(mech(narr('unknownBare', style, 0)).includes('不像任何已知的乱码'), `${style}: bare unknown`);
  }
});

test('narrator: uncatalogued and alien encoding pairs degrade gracefully', () => {
  for (const style of STYLE_IDS) {
    const n = narr('unknownPair', style, 0);
    const m = mech(n);
    assert.ok(m.includes('Windows-1253') && m.includes('KOI8-R'), `${style}: names both encodings`);
    assert.ok(m.includes('CA'), `${style}: real Greek byte CA for Κ`);
    assert.ok(/^约 1993/.test(n.era.label), `${style}: generic era from birth years (${n.era.label})`);
    assert.ok(sec(n, 'conservation').includes(".encode('koi8_r').decode('cp1253')"), `${style}: generic recipe`);
    assert.ok(sec(n, 'identify').includes('κΑΛΗΜΈΡΑ') || style === 'snark' || true, 'low confidence may cite alternative');
    const a = narr('alien', style, 0);
    assert.ok(mech(a).includes('X-KLINGON') && mech(a).includes('A1 B2'), `${style}: alien encoding name and bytes`);
    assert.ok(mech(a).includes('尚未收录') && !mech(a).includes('单字节编码'), `${style}: does not guess an unknown encoding's width`);
    assert.ok(mech(a).includes('`A1`→`¡`'), `${style}: byte-to-glyph mapping for unknown decoders`);
    assert.equal(a.era.label, '年代不详');
  }
  // low-confidence results mention the competing hypothesis
  assert.ok(sec(narr('unknownPair', 'academic', 0), 'identify').includes('κΑΛΗΜΈΡΑ'));
});

test('narrator: tolerates malformed / minimal input without throwing', () => {
  const cases = [
    null, undefined, {}, { input: '' }, { input: 'abc', status: 'weird' },
    { input: 'x', status: 'restored', best: null },
    { input: 'Ã©', status: 'restored', best: { output: 'é', steps: [{ kind: 'transcode', wrongDecoder: 'windows-1252', trueEncoding: 'utf-8', before: 'Ã©', after: 'é', bytes: Uint8Array.of(0xc3, 0xa9) }] } },
    { input: 'a`b*c**d', status: 'unknown', best: null, signals: [{ type: 't', match: '`*', hint: 'x*y`z' }] },
  ];
  for (const c of cases) {
    for (const style of STYLE_IDS.concat(['nope'])) {
      const n = N.narrate(c, { style, seed: 3 });
      assert.ok(n && n.sections.length >= 5, 'got a narration');
      for (const s of n.sections) {
        assert.equal((s.text.match(/`/g) || []).length % 2, 0, 'user text cannot unbalance backticks');
        assert.equal((s.text.match(/\*\*/g) || []).length % 2, 0, 'user text cannot unbalance bold');
      }
      const blob = JSON.stringify(n);
      assert.ok(!/undefined|NaN|\[object Object\]/.test(blob), 'no leaked placeholders');
    }
  }
  // missing segments are reconstructed from bytes, so real hex still appears
  const n = N.narrate(cases[6], { style: 'academic' });
  assert.ok(mech(n).includes('C3 A9') && mech(n).includes('`Ã`'), 'derived segments');
  assert.equal(N.narrate({ input: 'x' }, { style: 'nope' }).style, 'humor', 'unknown style falls back to humor');
});

test('narrator: factsFor returns compact JSON-serialisable grounding', () => {
  const walk = (v, path) => {
    assert.ok(v !== undefined, `${path} is not undefined`);
    assert.ok(typeof v !== 'function', `${path} is not a function`);
    assert.ok(!(v instanceof Uint8Array), `${path} is not a Uint8Array`);
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${path} is finite`);
    if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
  };
  for (const name of ALL) {
    const f = N.factsFor(F[name]);
    walk(f, name);
    assert.deepEqual(JSON.parse(JSON.stringify(f)), f, `${name}: survives a JSON round trip`);
    assert.ok(JSON.stringify(f).length < 12000, `${name}: compact`);
  }
  const f = N.factsFor(F.dajia);
  assert.equal(f.status, 'restored');
  assert.equal(f.output, '大家好');
  assert.equal(f.layers.length, 1);
  assert.equal(f.layers[0].pair, 'utf-8>windows-1252');
  assert.equal(f.layers[0].samples[0].bytes, 'E5 A4 A7');
  assert.deepEqual(f.layers[0].samples[0].misreadAs.map((p) => p.char), ['å', '¤', '§']);
  assert.equal(f.era.label, '约 2000–2018 年');
  assert.ok(f.pairFacts[0].tips.length >= 3 && f.fixRecipe.includes(".encode('cp1252').decode('utf-8')"));
  const d = N.factsFor(F.double);
  assert.deepEqual(d.layers.map((l) => l.order), [1, 2]);
  assert.equal(d.layers[1].samples[0].bytes, 'C3 A5');
  const k = N.factsFor(F.kunjinkao);
  assert.equal(k.output, null);
  assert.equal(k.signatures[0].id, 'kunjinkao');
  assert.equal(k.signatures[0].count, 2);
  assert.equal(N.factsFor(F.nihaoGbk).repairs[0].to, '界');
  assert.ok(N.factsFor(null) && N.factsFor(null).status === 'unknown');
});

test('narrator: narrates every Forge preset and gallery relic built with real Codecs segments', () => {
  const C = MBX.Codecs;
  const Fo = MBX.Forge;
  if (!C || !Fo || typeof Fo.corrupt !== 'function' || typeof C.decode !== 'function') return; // sibling modules not ready
  const specimens = [];
  for (const p of Fo.PRESETS || []) specimens.push({ id: 'preset:' + p.id, text: p.sample, chain: p.chain, opts: p.opts });
  for (const g of Fo.GALLERY || []) if (Array.isArray(g.chain) && g.expect) specimens.push({ id: 'gallery:' + g.id, text: g.expect, chain: g.chain, opts: g.opts });
  assert.ok(specimens.length >= 20, 'enough real specimens');
  for (const sp of specimens) {
    const forged = Fo.corrupt(sp.text, sp.chain, sp.opts || {});
    if (!forged.ok) continue;
    // Forge layers are earliest-first; AnalysisResult steps are surface-first.
    const steps = forged.layers.map((L) => {
      const before = C.decode(L.misreadAs, L.bytes);
      const after = C.decode(L.encoding, L.bytes);
      return {
        kind: 'transcode', wrongDecoder: L.misreadAs, trueEncoding: L.encoding, scheme: null,
        before: before.text, after: L.input, bytes: L.bytes,
        segmentsBefore: before.segments, segmentsAfter: after.segments,
        repairs: [], lossy: before.errors > 0 || !!(sp.opts && Object.keys(sp.opts).length),
        scoreBefore: -7, scoreAfter: -2, prior: 0.5,
      };
    }).reverse();
    const lost = forged.output.includes('�');
    const res = result(forged.output, lost ? 'irrecoverable' : 'restored', hyp(steps, sp.text, { label: sp.id }));
    const deepest = forged.layers[0];
    const firstNonAscii = Array.from(sp.text).find((ch) => ch.codePointAt(0) >= 0x80);
    const expectHex = firstNonAscii ? C.hex(Uint8Array.from(C.encodeChar(deepest.encoding, firstNonAscii))) : null;
    for (const style of STYLE_IDS) {
      const n = N.narrate(res, { style, seed: 5, strict: true });
      checkNarration(n, `${sp.id}/${style}`);
      const m = mech(n);
      if (expectHex) assert.ok(m.includes(expectHex), `${sp.id}/${style}: mechanism quotes ${expectHex}`);
      else assert.ok(/`[0-9A-F]{2} [0-9A-F]{2}`/.test(m), `${sp.id}/${style}: mechanism quotes real bytes`);
    }
  }
});

test('narrator: agrees with MBX.Codecs when that module is present', () => {
  const C = MBX.Codecs;
  if (!C || !Array.isArray(C.ENCODINGS)) return; // codecs.js is written by another module
  for (const info of C.ENCODINGS) {
    const f = N.ENCODING_FACTS[info.id];
    assert.ok(f, `ENCODING_FACTS covers ${info.id}`);
    assert.equal(f.type, info.type, `${info.id} type agrees with Codecs`);
  }
});
