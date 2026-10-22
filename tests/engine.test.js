'use strict';
// Tests for MBX.Engine (src/engine.js): the documented API and data shapes, every status,
// escape layers, lossy repairs, signatures (byte facts checked against TextDecoder), options,
// long inputs and performance. Accuracy at scale lives in tests/corpus.test.js.

const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const { Engine, Codecs, Forge, Scorer } = MBX;

const FFFD = String.fromCharCode(0xfffd);
const NUL = String.fromCharCode(0);
const L = (encoding, misreadAs) => ({ encoding, misreadAs });
const STATUSES = ['restored', 'clean', 'irrecoverable', 'partial', 'unknown'];

function relicOf(text, chain, opts) {
  const r = Forge.corrupt(text, chain, opts);
  if (!r.ok) throw new Error(r.error);
  return r.output;
}

const hexBytes = (s) => Uint8Array.from(s.trim().split(/\s+/).map((h) => parseInt(h, 16)));
const chainOf = (h) => h.steps.filter((s) => s.kind === 'transcode').map((s) => `${s.trueEncoding}>${s.wrongDecoder}`).reverse();

/** Checks the documented Step contract, including byte alignment of the segment lists. */
function checkStep(step, where) {
  const keys = ['kind', 'wrongDecoder', 'trueEncoding', 'scheme', 'before', 'after', 'bytes', 'segmentsBefore',
    'segmentsAfter', 'repairs', 'lossy', 'scoreBefore', 'scoreAfter', 'prior'];
  for (const k of keys) assert.ok(k in step, `${where}: Step.${k} missing`);
  assert.ok(step.kind === 'transcode' || step.kind === 'unescape', `${where}: kind ${step.kind}`);
  assert.equal(typeof step.before, 'string', `${where}: before`);
  assert.equal(typeof step.after, 'string', `${where}: after`);
  assert.ok(Array.isArray(step.repairs), `${where}: repairs`);
  assert.equal(typeof step.lossy, 'boolean', `${where}: lossy`);
  assert.equal(step.scoreBefore, Scorer.score(step.before).value, `${where}: scoreBefore`);
  assert.equal(step.scoreAfter, Scorer.score(step.after).value, `${where}: scoreAfter`);
  assert.ok(step.prior > 0 && step.prior <= 1, `${where}: prior ${step.prior}`);
  if (step.kind === 'transcode') {
    assert.ok(Codecs.get(step.wrongDecoder) && Codecs.get(step.trueEncoding), `${where}: encodings`);
    assert.equal(step.scheme, null, `${where}: scheme`);
    assert.ok(step.bytes instanceof Uint8Array, `${where}: bytes`);
    for (const [name, segs, text] of [['segmentsBefore', step.segmentsBefore, step.before], ['segmentsAfter', step.segmentsAfter, step.after]]) {
      assert.equal(segs.map((s) => s.ch).join(''), text, `${where}: ${name} spell the text`);
      let pos = 0;
      for (const s of segs) {
        assert.equal(s.start, pos, `${where}: ${name} contiguous at ${JSON.stringify(s)}`);
        assert.ok(s.end >= s.start, `${where}: ${name} order`);
        pos = s.end;
      }
      assert.equal(pos, step.bytes.length, `${where}: ${name} cover every byte`);
    }
    // Every character of the garbled layer really is those bytes in the wrong decoder.
    // (Shift_JIS reads ED/EE and FA/FB rows as the same characters: either form is the truth.)
    for (const s of step.segmentsBefore) {
      if (s.end === s.start) continue;
      const own = Array.from(step.bytes.subarray(s.start, s.end));
      if (Codecs.decode(step.wrongDecoder, Uint8Array.from(own)).text === s.ch && own.length === (Codecs.encodeChar(step.wrongDecoder, s.ch) || []).length) continue;
      assert.deepEqual(own, Codecs.encodeChar(step.wrongDecoder, s.ch), `${where}: bytes of ${s.ch}`);
    }
  } else {
    assert.ok(['percent', 'hex-escape', 'quoted-printable', 'hex-dump', 'unicode-escape', 'html-entity'].includes(step.scheme), `${where}: scheme`);
    assert.equal(step.wrongDecoder, null, `${where}: wrongDecoder`);
    if (step.bytes) {
      assert.ok(Codecs.get(step.trueEncoding), `${where}: trueEncoding of the bytes`);
      assert.equal(step.segmentsBefore.map((s) => s.ch).join(''), step.before, `${where}: segmentsBefore`);
      assert.equal(step.segmentsAfter.map((s) => s.ch).join(''), step.after, `${where}: segmentsAfter`);
      assert.equal(Codecs.decode(step.trueEncoding, step.bytes).text, step.after, `${where}: bytes decode to after`);
    } else {
      assert.equal(step.segmentsBefore, null, `${where}: no byte segments for text schemes`);
    }
  }
}

function checkHypothesis(h, input, where) {
  for (const k of ['output', 'confidence', 'score', 'steps', 'repairs', 'lang', 'label']) assert.ok(k in h, `${where}: Hypothesis.${k}`);
  assert.ok(h.confidence >= 0 && h.confidence <= 1, `${where}: confidence ${h.confidence}`);
  assert.equal(h.score.value, Scorer.score(h.output).value, `${where}: score is of the output`);
  assert.ok(h.lang && typeof h.lang.lang === 'string' && typeof h.lang.name === 'string', `${where}: lang`);
  assert.ok(typeof h.label === 'string' && h.label.length > 0, `${where}: label`);
  assert.ok(h.steps.length > 0, `${where}: steps`);
  assert.equal(h.steps[0].before, input, `${where}: steps[0] acts on the input`);
  assert.equal(h.steps[h.steps.length - 1].after, h.output, `${where}: the last step yields the output`);
  h.steps.forEach((s, k) => {
    checkStep(s, `${where} step ${k}`);
    if (k > 0) assert.equal(s.before, h.steps[k - 1].after, `${where}: steps chain together`);
  });
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

test('engine: exposes the documented API', () => {
  assert.equal(typeof Engine.analyze, 'function');
  assert.equal(typeof Engine.applyChain, 'function');
  assert.ok(Object.isFrozen(Engine.PAIR_PRIORS));
  for (const [key, p] of Object.entries(Engine.PAIR_PRIORS)) {
    const [E, W] = key.split('>');
    assert.ok(Codecs.get(E) && Codecs.get(W) && E !== W, `bad PAIR_PRIORS key ${key}`);
    assert.ok(p > 0 && p <= 1, `${key} = ${p}`);
  }
  // Every docs §8 combination is known (ascii>utf-16le is spelled windows-1252>utf-16le).
  const classic = ['utf-8>windows-1252', 'utf-8>gbk', 'gbk>windows-1252', 'gbk>iso-8859-1', 'utf-8>shift_jis',
    'shift_jis>windows-1252', 'utf-8>windows-1251', 'koi8-r>windows-1251', 'windows-1251>koi8-r', 'koi8-r>iso-8859-1',
    'big5>gbk', 'gbk>big5', 'big5>windows-1252', 'gbk>cp437', 'utf-8>cp437', 'shift_jis>gbk', 'gbk>shift_jis',
    'euc-kr>windows-1252', 'euc-jp>shift_jis', 'utf-8>macintosh', 'windows-1252>utf-8', 'windows-1252>utf-16le'];
  for (const key of classic) assert.ok(Engine.PAIR_PRIORS[key] >= 0.4, `${key} should be a common accident`);
  const top = Math.max(...Object.values(Engine.PAIR_PRIORS));
  assert.equal(Engine.PAIR_PRIORS['utf-8>windows-1252'], top);
  const ids = Engine.SIGNATURES.map((s) => s.id);
  for (const id of ['kunjinkao', 'kunjinkao-big5', 'tangtangtang', 'tuntuntun', 'utf8-bom-1252', 'utf16-bom', 'replacement', 'question-marks', 'notepad-bush']) {
    assert.ok(ids.includes(id), `signature ${id}`);
  }
});

test('engine: signature byte facts hold in Codecs and in the platform TextDecoder', () => {
  let checked = 0;
  for (const sig of Engine.SIGNATURES) {
    if (!sig.bytes) continue;
    const bytes = hexBytes(sig.bytes);
    assert.equal(Codecs.decode(sig.decoder, bytes).text, sig.glyph, `${sig.id} via Codecs`);
    assert.equal(new TextDecoder(Codecs.get(sig.decoder).whatwg).decode(bytes), sig.glyph, `${sig.id} via TextDecoder`);
    checked++;
  }
  assert.ok(checked >= 8, `${checked} signatures with byte facts`);
  // The famous long forms, too.
  assert.equal(Codecs.decode('gbk', hexBytes('CC CC CC CC CC CC')).text, '烫烫烫');
  assert.equal(Codecs.decode('gbk', hexBytes('CD CD CD CD')).text, '屯屯');
  assert.equal(Codecs.decode('gbk', Codecs.encode('utf-8', FFFD + FFFD).bytes).text, '锟斤拷');
});

test('engine: AnalysisResult has the documented shape', () => {
  const input = 'å¤§å®¶å¥½';
  const r = Engine.analyze(input);
  assert.equal(r.input, input);
  assert.ok(STATUSES.includes(r.status));
  assert.equal(r.status, 'restored');
  assert.ok(Array.isArray(r.alternatives) && Array.isArray(r.signatures) && Array.isArray(r.signals));
  assert.deepEqual(r.signals, Scorer.mojibakeSignals(input));
  assert.equal(r.inputScore.value, Scorer.score(input).value);
  assert.ok(r.stats.explored > 0 && r.stats.ms >= 0 && r.stats.truncated === false);
  checkHypothesis(r.best, input, 'best');
  assert.equal(r.best.output, '大家好');
  assert.equal(r.best.label, 'UTF-8 被误读为 Windows-1252');
  assert.deepEqual(chainOf(r.best), ['utf-8>windows-1252']);
  assert.equal(r.best.lang.lang, 'zh-Hans');
  assert.ok(r.best.confidence >= 0.5, `confidence ${r.best.confidence}`);
  const outs = new Set([r.best.output]);
  for (const alt of r.alternatives) {
    checkHypothesis(alt, input, 'alternative');
    assert.ok(!outs.has(alt.output), 'alternatives have distinct outputs');
    outs.add(alt.output);
  }
  assert.ok(r.alternatives.length <= 5);
  JSON.stringify(r); // serialisable (the LLM narrator sends it)
});

// ---------------------------------------------------------------------------
// Restorations
// ---------------------------------------------------------------------------

test('engine: every Forge preset (docs §8) is restored through its own chain', () => {
  // Every preset sample round-trips through its chain (the Shift_JIS presets were chosen so).
  const lossyByNature = new Set();
  for (const p of Forge.PRESETS) {
    const relic = relicOf(p.sample, p.chain, p.opts);
    const r = Engine.analyze(relic);
    if (p.id === '1252-as-utf8') {
      assert.equal(r.status, 'irrecoverable', p.id);
      continue;
    }
    if (lossyByNature.has(p.id)) {
      assert.ok(r.status === 'restored' || r.status === 'partial', `${p.id}: ${r.status}`);
      assert.ok(r.best.output.includes(FFFD) || r.best.output === p.sample, `${p.id}: losses are marked`);
      continue;
    }
    assert.equal(r.status, 'restored', p.id);
    assert.equal(r.best.output, p.sample, p.id);
    // ISO-8859-1 accidents are reported as Windows-1252 when both readings agree (docs §6).
    const expect = p.chain.map((l) => `${l.encoding}>${l.misreadAs === 'iso-8859-1' ? 'windows-1252' : l.misreadAs}`);
    assert.deepEqual(chainOf(r.best), expect, p.id);
    checkHypothesis(r.best, relic, p.id);
  }
});

test('engine: double layers are peeled one stratum at a time', () => {
  const relic = 'Ã¦â€“â€¡Ã§â€°Â©';
  const r = Engine.analyze(relic);
  assert.equal(r.best.output, '文物');
  assert.equal(r.best.steps.length, 2);
  assert.equal(r.best.steps[0].after, 'æ–‡ç‰©');
  assert.equal(r.best.label, 'UTF-8 被误读为 Windows-1252（两层）');
  checkHypothesis(r.best, relic, 'double');
  const triple = relicOf('你好', [L('utf-8', 'windows-1252'), L('utf-8', 'windows-1252'), L('utf-8', 'windows-1252')]);
  const t = Engine.analyze(triple);
  assert.equal(t.best.output, '你好');
  assert.equal(t.best.label, 'UTF-8 被误读为 Windows-1252（三层）');
  // A mixed double layer: UTF-8 read as GBK, that text saved as UTF-8 and read as Windows-1252.
  const mixed = relicOf('中文乱码问题', [L('utf-8', 'gbk'), L('utf-8', 'windows-1252')]);
  const m = Engine.analyze(mixed);
  assert.equal(m.best.output, '中文乱码问题');
  assert.deepEqual(chainOf(m.best), ['utf-8>gbk', 'utf-8>windows-1252']);
});

test('engine: windows-1252 is preferred over iso-8859-1 unless C1 controls are present', () => {
  const plain = Engine.analyze('cafÃ© crÃ¨me');
  assert.equal(plain.best.output, 'café crème');
  assert.equal(plain.best.steps[0].wrongDecoder, 'windows-1252');
  const c1 = relicOf('“quoted” text', [L('utf-8', 'iso-8859-1')]);
  assert.ok(/[\u0080-\u009f]/.test(c1));
  const r = Engine.analyze(c1);
  assert.equal(r.best.output, '“quoted” text');
  assert.equal(r.best.steps[0].wrongDecoder, 'iso-8859-1');
});

test('engine: lossy relics are repaired and every repair is reported', () => {
  // A U+FFFD left by the GBK decoder: the lost byte of 界 is filled in.
  const gbk = '浣犲ソ锛屼笘鐣' + FFFD;
  const r = Engine.analyze(gbk);
  assert.equal(r.best.output, '你好，世界');
  assert.equal(r.best.repairs.length, 1);
  const rp = r.best.repairs[0];
  assert.equal(rp.reason, 'gap');
  assert.equal(rp.from, FFFD);
  assert.equal(rp.to, '界');
  assert.ok(rp.candidates.length <= 6 && rp.candidates[0] === '界');
  assert.equal(Array.from(r.best.output)[rp.index], '界');
  assert.ok(r.best.steps[0].lossy);
  assert.ok(r.best.label.includes('修复 1 处残缺'), r.best.label);
  const seg = r.best.steps[0].segmentsAfter[rp.index];
  assert.ok(seg.repaired && seg.candidates.includes('界'));

  // The invisible 0x9D of ” vanished on copy & paste.
  const quotes = Engine.analyze('â€œDonâ€™t panic!â€');
  assert.equal(quotes.best.output, '“Don’t panic!”');
  assert.equal(quotes.best.repairs[0].reason, 'dropped');
  assert.equal(quotes.best.repairs[0].to, '”');

  // NBSP (the second byte of à) flattened to a space.
  const nbsp = relicOf('Voilà à bientôt', [L('utf-8', 'windows-1252')], { nbspToSpace: true });
  const n = Engine.analyze(nbsp);
  assert.equal(n.best.output, 'Voilà à bientôt');
  assert.ok(n.best.repairs.some((x) => x.reason === 'nbsp' && x.from === ' '));

  // Someone deleted the U+FFFD the GBK decoder left (no visible trace).
  const stripped = relicOf('你好，世界', [L('utf-8', 'gbk')], { stripReplacement: true });
  assert.ok(!stripped.includes(FFFD));
  const s = Engine.analyze(stripped);
  assert.equal(s.best.output, '你好，世界');
  assert.ok(s.best.repairs.some((x) => x.reason === 'gap' && x.from === ''));
});

test('engine: an intermediate loss is repaired by the layer that can see real context', () => {
  // UTF-8 -> Windows-1252 -> saved as UTF-8 -> read as GBK, whose decoder ate two bytes.
  const relic = relicOf('Привет, мир!', [L('utf-8', 'windows-1252'), L('utf-8', 'gbk')]);
  assert.ok(relic.includes(FFFD));
  const r = Engine.analyze(relic);
  assert.equal(r.status, 'restored');
  assert.deepEqual(chainOf(r.best), ['utf-8>windows-1252', 'utf-8>gbk']);
  const out = r.best.output;
  assert.ok(out.startsWith('Привет, ми') && out.endsWith('!'), out);
  checkHypothesis(r.best, relic, 'deferred');
});

test('engine: guesses the context cannot support are admitted as losses', () => {
  // Big5 swallowed whole pairs of UTF-8 bytes: some characters cannot be told apart any more.
  const relic = relicOf('这个问题已经解决了，请重新启动服务器。', [L('utf-8', 'big5')]);
  const r = Engine.analyze(relic);
  assert.ok(r.best, r.status);
  const out = Array.from(r.best.output);
  const orig = Array.from('这个问题已经解决了，请重新启动服务器。');
  // Every surviving character is right; the rest are U+FFFD (never an invented character).
  let k = 0;
  for (const ch of out) {
    if (ch === FFFD) continue;
    while (k < orig.length && orig[k] !== ch) k++;
    assert.ok(k < orig.length, `invented character ${ch} in ${r.best.output}`);
    k++;
  }
});

// ---------------------------------------------------------------------------
// Escape layers
// ---------------------------------------------------------------------------

test('engine: escape layers are peeled as unescape steps', () => {
  const cases = [
    ['%E4%BD%A0%E5%A5%BD', 'percent', 'utf-8'],
    ['\\xe4\\xbd\\xa0\\xe5\\xa5\\xbd', 'hex-escape', 'utf-8'],
    ['=E4=BD=A0=E5=A5=BD', 'quoted-printable', 'utf-8'],
    ['E4 BD A0 E5 A5 BD', 'hex-dump', 'utf-8'],
    ['C4 E3 BA C3', 'hex-dump', 'gbk'],
    ['\\u4f60\\u597d', 'unicode-escape', null],
    ['&#20320;&#x597D;', 'html-entity', null],
  ];
  for (const [input, scheme, enc] of cases) {
    const r = Engine.analyze(input);
    assert.equal(r.status, 'restored', input);
    assert.equal(r.best.output, '你好', input);
    const step = r.best.steps[0];
    assert.equal(step.kind, 'unescape', input);
    assert.equal(step.scheme, scheme, input);
    assert.equal(step.trueEncoding, enc, input);
    checkHypothesis(r.best, input, input);
  }
  assert.equal(Engine.analyze('caf&eacute; &amp; cr&egrave;me').best.output, 'café & crème');
  assert.equal(Engine.analyze('\\ud83d\\ude00 ok').best.output, '😀 ok');
  // Escaped bytes that are themselves mojibake: unescape, then transcode.
  const nested = Engine.analyze('%C3%A5%C2%A4%C2%A7%C3%A5%C2%AE%C2%B6');
  assert.equal(nested.best.output, '大家');
  assert.deepEqual(nested.best.steps.map((s) => s.kind), ['unescape', 'transcode']);
  // Plain URLs without escaped high bytes are clean; escapes can be switched off.
  assert.equal(Engine.analyze('https://example.com/search?q=hello%20world').status, 'clean');
  assert.equal(Engine.analyze('%E4%BD%A0%E5%A5%BD', { allowEscapes: false }).status, 'clean');
});

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

test('engine: clean texts are left alone', () => {
  const texts = [
    'Hello, world!', 'function add(a, b) { return a + b; }', '今天天气很好，我们一起去公园散步吧！',
    'これはテストです。', '안녕하세요', 'Съешь же ещё этих мягких французских булок.', 'Καλημέρα κόσμε',
    'Größe und Übergröße', '¿Dónde está la biblioteca?', 'Zażółć gęślą jaźń', 'Party time 🎉😀',
    '我们使用 React 18 和 TypeScript', 'She said, “It’s a beautiful day.”', '价格：¥1,299.00（含税）',
    '3.14159 × 2 = 6.28318', '© 2024 Example Corp. All rights reserved.', 'Mañana, señor.',
  ];
  for (const t of texts) {
    const r = Engine.analyze(t);
    assert.equal(r.status, 'clean', `${t} -> ${r.status} ${r.best && r.best.output}`);
    assert.equal(r.best, null, t);
  }
  // Pure ASCII takes the fast path.
  const ascii = Engine.analyze('The quick brown fox jumps over the lazy dog.');
  assert.equal(ascii.status, 'clean');
  assert.equal(ascii.stats.explored, 0);
});

test('engine: irrecoverable relics are recognised by their signatures', () => {
  const kun = Engine.analyze('锟斤拷锟斤拷');
  assert.equal(kun.status, 'irrecoverable');
  assert.ok(kun.signatures.some((s) => s.id === 'kunjinkao' && s.match === '锟斤拷锟斤拷' && s.index === 0));
  // The chain that made it is kept as an explanation: the original was already U+FFFD.
  assert.deepEqual(chainOf(kun.best), ['utf-8>gbk']);
  assert.equal(kun.best.output, FFFD.repeat(4));
  assert.ok(kun.best.confidence <= 0.6);

  const tang = Engine.analyze('烫烫烫烫烫烫');
  assert.equal(tang.status, 'irrecoverable');
  assert.equal(tang.best, null);
  assert.ok(tang.signatures.some((s) => s.id === 'tangtangtang'));
  assert.ok(Engine.analyze('屯屯屯屯').signatures.some((s) => s.id === 'tuntuntun'));

  const lost = Engine.analyze('R' + FFFD + 'sum' + FFFD + ' caf' + FFFD);
  assert.equal(lost.status, 'irrecoverable');
  assert.ok(lost.signatures.some((s) => s.id === 'replacement'));

  const q = Engine.analyze('???? ?????');
  assert.equal(q.status, 'irrecoverable');
  assert.ok(q.signatures.some((s) => s.id === 'question-marks'));

  // Legacy bytes read as UTF-8 lose almost everything: no restoration is claimed.
  const gbkUtf8 = Engine.analyze(relicOf('数据库连接失败', [L('gbk', 'utf-8')]));
  assert.equal(gbkUtf8.status, 'irrecoverable');
});

test('engine: unexplained mojibake is "unknown", with the closest guesses as alternatives', () => {
  for (const t of ['ŠŒŽšœž', '¿¿¿¿', 'Ã¿Ã¾Ã½']) {
    const r = Engine.analyze(t);
    assert.equal(r.status, 'unknown', `${t} -> ${r.status} ${r.best && r.best.output}`);
    assert.equal(r.best, null);
    assert.ok(r.alternatives.length >= 1 && r.alternatives.length <= 3);
    for (const alt of r.alternatives) checkHypothesis(alt, t, `guess for ${t}`);
  }
});

test('engine: mixed texts are repaired where they are garbled ("partial")', () => {
  const r = Engine.analyze('请查看附件：æŠ¥å‘Š.docx 谢谢');
  assert.equal(r.status, 'partial');
  assert.equal(r.best.output, '请查看附件：报告.docx 谢谢');
  assert.ok(r.best.label.startsWith('局部还原'), r.best.label);
  assert.ok(r.best.steps[0].partial);
  checkHypothesis(r.best, '请查看附件：æŠ¥å‘Š.docx 谢谢', 'partial');
  const ja = Engine.analyze('日本語のテキスト：ã“ã‚“ã«ã¡ã¯');
  assert.equal(ja.best.output, '日本語のテキスト：こんにちは');
  // Without partial repairs the same input is only "unknown".
  assert.equal(Engine.analyze('中文标题：å¤§å®¶å¥½', { allowPartial: false }).status, 'unknown');
});

test('engine: famous relics carry their signatures', () => {
  const bom = Engine.analyze('ï»¿Hello world');
  assert.equal(bom.best.output, 'Hello world');
  assert.ok(bom.signatures.some((s) => s.id === 'utf8-bom-1252'));
  const bush = Engine.analyze(relicOf('Bush hid the facts', [L('windows-1252', 'utf-16le')]));
  assert.equal(bush.best.output, 'Bush hid the facts');
  assert.ok(bush.signatures.some((s) => s.id === 'notepad-bush'));
  const nul = Engine.analyze(['H', 'e', 'l', 'l', 'o'].map((c) => c + NUL).join(''));
  assert.equal(nul.best.output, 'Hello');
  assert.ok(nul.signatures.some((s) => s.id === 'utf16-nul'));
  const ffFe = Engine.analyze('ÿþH' + NUL + 'i' + NUL + '!' + NUL);
  assert.equal(ffFe.best.output, 'Hi!');
  assert.ok(ffFe.signatures.some((s) => s.id === 'utf16-bom'));
});

// ---------------------------------------------------------------------------
// Options, long inputs, applyChain
// ---------------------------------------------------------------------------

test('engine: options are honoured', () => {
  // One layer of a double layer is still mojibake: offered as a guess, never as "文物".
  const double = 'Ã¦â€“â€¡Ã§â€°Â©';
  const shallow = Engine.analyze(double, { maxDepth: 1 });
  const readings = [shallow.best].concat(shallow.alternatives).filter(Boolean);
  assert.ok(readings.length > 0);
  assert.ok(readings.every((h) => h.steps.length === 1 && h.output !== '文物'));
  assert.ok(readings.some((h) => h.output === 'æ–‡ç‰©'));
  assert.equal(Engine.analyze('å¤§å®¶å¥½', { maxAlternatives: 0 }).alternatives.length, 0);
  const narrow = Engine.analyze('å¤§å®¶å¥½', { encodings: ['utf-8', 'windows-1252'] });
  assert.equal(narrow.best.output, '大家好');
  assert.equal(Engine.analyze('å¤§å®¶å¥½', { beamWidth: 1 }).best.output, '大家好');
  // Without lossy repairs the U+FFFD stays.
  const strict = Engine.analyze('浣犲ソ锛屼笘鐣' + FFFD, { allowLossy: false });
  assert.ok(!strict.best || strict.best.output.indexOf('界') < 0);
});

test('engine: long inputs are searched on a sample and replayed on the full text', () => {
  const sentence = '编码问题让人头疼，但是乱码考古学家可以帮你找回原文。';
  const original = sentence.repeat(60); // 1500+ characters, about 4500 garbled ones
  const relic = relicOf(original, [L('utf-8', 'windows-1252')]);
  const r = Engine.analyze(relic);
  assert.equal(r.stats.truncated, true);
  assert.equal(r.status, 'restored');
  assert.equal(r.best.output, original);
  assert.equal(r.best.steps[0].before, relic);
  // Text the chain cannot encode (a clean Chinese tail) is kept as it is: partial.
  const tail = '后面这一段是正常的中文。';
  const mixed = Engine.analyze(relic + tail);
  assert.equal(mixed.status, 'partial');
  assert.equal(mixed.best.output, original + tail);
});

test('engine: applyChain replays a found chain on another text', () => {
  const r = Engine.analyze('å¤§å®¶å¥½');
  const again = Engine.applyChain('æ–‡ç‰©', r.best.steps);
  assert.equal(again.output, '文物');
  assert.equal(again.steps.length, 1);
  checkStep(again.steps[0], 'applyChain');
  const esc = Engine.analyze('%E4%BD%A0%E5%A5%BD');
  assert.equal(Engine.applyChain('%E5%A4%A7', esc.best.steps).output, '大');
  assert.equal(Engine.applyChain('abc', []).output, 'abc');
});

// ---------------------------------------------------------------------------
// Robustness, determinism, performance
// ---------------------------------------------------------------------------

test('engine: odd inputs never throw', () => {
  for (const input of ['', '   ', null, undefined, 42, String.fromCharCode(0xd800) + 'abc', NUL + NUL + NUL, '\n\n', FFFD, '🎉']) {
    const r = Engine.analyze(input);
    assert.ok(STATUSES.includes(r.status), `${JSON.stringify(input)}: ${r.status}`);
    assert.equal(typeof r.input, 'string');
  }
  assert.equal(Engine.analyze('').status, 'clean');
});

test('engine: results are deterministic', () => {
  const input = relicOf('今天天气很好，我们一起去公园散步吧！', [L('utf-8', 'gbk')]);
  const strip = (r) => JSON.stringify(Object.assign({}, r, { stats: null }));
  assert.equal(strip(Engine.analyze(input)), strip(Engine.analyze(input)));
});

test('engine: performance (500 characters < 300 ms, 5000 characters < 1.5 s)', () => {
  const zh = '字符编码是计算机存储和传输文字的基础。当一段文字用一种编码写入，却用另一种编码读取时，就会出现乱码。';
  const en = 'The “quick” brown fox doesn’t jump over the lazy dog — it’s café time… ';
  const ru = 'Съешь же ещё этих мягких французских булок, да выпей чаю. ';
  const make = (base, chain, n) => {
    let src = base;
    let out = chain ? relicOf(src, chain) : src;
    while (Array.from(out).length < n) {
      src += base;
      out = chain ? relicOf(src, chain) : src;
    }
    return out;
  };
  const kinds = [
    ['zh utf-8>1252', zh, [L('utf-8', 'windows-1252')]],
    ['zh utf-8>gbk', zh, [L('utf-8', 'gbk')]],
    ['zh gbk>1252', zh, [L('gbk', 'windows-1252')]],
    ['en utf-8>1252', en, [L('utf-8', 'windows-1252')]],
    ['ru utf-8>1251', ru, [L('utf-8', 'windows-1251')]],
    ['zh clean', zh, null],
  ];
  Engine.analyze('å¤§å®¶å¥½'); // build the lazily derived tables first
  const timings = [];
  for (const [name, base, chain] of kinds) {
    for (const [n, limit] of [[500, 300], [5000, 1500]]) {
      const input = make(base, chain, n);
      let best = Infinity;
      for (let k = 0; k < 2; k++) {
        const t0 = process.hrtime.bigint();
        Engine.analyze(input);
        best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
      }
      timings.push(`${name} ${n}: ${best.toFixed(0)} ms`);
      assert.ok(best < limit, `${name} (${n} chars) took ${best.toFixed(0)} ms, limit ${limit} ms`);
    }
  }
  if (process.env.MBX_VERBOSE) console.log('  [engine] ' + timings.join(', '));
});
