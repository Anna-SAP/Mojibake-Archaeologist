'use strict';
// Regression cases for the core fixes (engine / scorer / codecs / forge): each test names the
// relic shape it guards. Clean inputs live in tests/core-clean.test.js.

const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const { Engine, Forge, Codecs } = MBX;

const FFFD = String.fromCharCode(0xfffd);
const B = String.fromCharCode(92);
const L = (encoding, misreadAs) => ({ encoding, misreadAs });
const relicOf = (t, chain, opts) => Forge.corrupt(t, chain, opts).output;
const restoredTo = (input, expect, where) => {
  const r = Engine.analyze(input);
  assert.ok(r.status === 'restored' || r.status === 'partial', `${where || input}: ${r.status}`);
  assert.equal(r.best.output, expect, where || input);
  return r;
};
const inRange = (s, lo, hi) => Array.from(s).some((c) => c.codePointAt(0) >= lo && c.codePointAt(0) <= hi);

test('core: all-caps relics and foreign marks glued to Latin letters', () => {
  restoredTo(relicOf('ATENÇÃO: NÃO ENTRE', [L('utf-8', 'windows-1252')]), 'ATENÇÃO: NÃO ENTRE');
  // Turkish ğ read through Windows-1252 is ð: never an Arabic tanwin.
  const a = Engine.analyze('Aðaç');
  assert.ok(a.status === 'unknown' || (a.best && a.best.output === 'Ağaç'), `${a.status} ${a.best && a.best.output}`);
  const q = Engine.analyze('â€™');
  assert.ok(q.status === 'unknown' || (q.best && q.best.output === '’'), `${q.status} ${q.best && q.best.output}`);
  for (const h of [q.best].concat(q.alternatives).filter(Boolean)) assert.ok(!inRange(h.output, 0x600, 0x6ff), h.output);
});

test('core: intact accented letters next to mojibake are kept (partial), spaces are never swallowed', () => {
  const cases = [
    ['The café menu says: CafÃ© crÃ¨me and naÃ¯ve', 'The café menu says: Café crème and naïve'],
    ['I love café. Also SÃ£o Paulo.', 'I love café. Also São Paulo.'],
    ['naïve and naÃ¯ve', 'naïve and naïve'],
    ['Ordered a café, got a CafÃ© instead', 'Ordered a café, got a Café instead'],
  ];
  for (const [input, expect] of cases) {
    const r = restoredTo(input, expect);
    assert.equal(r.status, 'partial', input);
  }
  // Without partial repairs the full reading keeps the space after the lost letter.
  const strict = Engine.analyze('The café menu says: CafÃ© crÃ¨me and naÃ¯ve', { allowPartial: false });
  assert.ok(strict.best.output.includes(FFFD + ' menu'), strict.best.output);
});

test('core: real byte dumps and escapes still decode; truncated UTF-8 is cut, not reinterpreted', () => {
  restoredTo('E5 A4 A7 E5 AE B6 E5 A5 BD', '大家好');
  restoredTo(B + 'xe4' + B + 'xbd' + B + 'xa0' + B + 'xe5' + B + 'xa5' + B + 'xbd', '你好');
  restoredTo('%E5%A4%A7', '大');
  restoredTo('R=C3=A9union de lundi', 'Réunion de lundi');
  restoredTo('C4 E3 BA C3', '你好');
  for (const [input, expect] of [['E5 A4 A7 E5 AE', '大' + FFFD], ['%E5%A4%A7%E5%AE', '大' + FFFD],
    ['https://example.com/?q=%E5%A4%A7%E5%AE%B6%E5', 'https://example.com/?q=大家' + FFFD]]) {
    const r = restoredTo(input, expect);
    assert.equal(r.best.steps.length, 1, input);
    assert.equal(r.best.steps[0].kind, 'unescape', input);
    assert.equal(r.best.steps[0].trueEncoding, 'utf-8', input);
    assert.ok(r.best.label.includes('UTF-8 字节'), r.best.label);
    const tail = r.best.steps[0].segmentsAfter[r.best.steps[0].segmentsAfter.length - 1];
    assert.ok(tail.error && tail.lost, JSON.stringify(tail));
  }
});

test('core: double URL encoding and URL-encoded JSON escapes are peeled', () => {
  const a = restoredTo('%25E5%25A4%25A7', '大');
  assert.deepEqual(a.best.steps.map((s) => s.scheme), ['percent', 'percent']);
  const b = restoredTo('%5Cu5927%5Cu5bb6', '大家');
  assert.deepEqual(b.best.steps.map((s) => s.scheme), ['percent', 'unicode-escape']);
});

test('core: Windows-1252 served as ISO-8859-1 (C1 controls) is named as such', () => {
  const c = (n) => String.fromCharCode(n);
  assert.ok(Engine.pairPrior('windows-1252', 'iso-8859-1') > Engine.pairPrior('windows-1251', 'iso-8859-1'));
  for (const [input, expect] of [
    ['Naïve ' + c(0x91) + 'quote' + c(0x92), 'Naïve ‘quote’'],
    ['It' + c(0x92) + 's a ' + c(0x93) + 'test' + c(0x94) + ' ' + c(0x96) + ' done' + c(0x85), 'It’s a “test” – done…'],
    ['café ' + c(0x93) + 'ok' + c(0x94), 'café “ok”'],
  ]) {
    const r = restoredTo(input, expect);
    assert.equal(r.best.steps[0].wrongDecoder, 'iso-8859-1', input);
    assert.equal(r.best.steps[0].trueEncoding, 'windows-1252', input);
    assert.ok(r.best.label.includes('Windows-1252 被误读为 ISO-8859-1'), r.best.label);
  }
});

test('core: a garbled line after a clean one is repaired in full, as one layer', () => {
  const a = '订单号 10025，客户王五，金额 59 元，状态已完成';
  const b = '订单号 10026，客户赵六，金额 88 元，状态已取消';
  const r = restoredTo(a + '\n' + relicOf(b, [L('utf-8', 'windows-1252')]), a + '\n' + b);
  assert.equal(r.best.steps.length, 1);
  assert.ok(!r.best.label.includes('两层'), r.best.label);
});

test('core: one unknown byte of a Hanzi is chosen from its word, or admitted as lost', () => {
  const ok = (t, chain, opts, allowed) => {
    const r = Engine.analyze(relicOf(t, chain, opts));
    const out = r.best ? r.best.output : null;
    assert.ok(allowed.includes(out), `${t}: ${r.status} ${out}`);
    return r;
  };
  const r1 = ok('这是一个测试', [L('utf-8', 'gbk')], {}, ['这是一个测试', '这是一个测' + FFFD]);
  assert.ok(r1.best.confidence <= 0.8, `confidence ${r1.best.confidence}`);
  for (const rp of r1.best.repairs) assert.ok(rp.candidates.length <= 6 && rp.candidates[0] === rp.to);
  ok('git commit -m "修复登录页面的错误"', [L('utf-8', 'gbk')], {}, ['git commit -m "修复登录页面的错误"', 'git commit -m "修复登录页面的错' + FFFD + '"']);
  ok('数据库迁移', [L('utf-8', 'gbk'), L('utf-8', 'windows-1252')], {}, ['数据库迁移', '数据库迁' + FFFD]);
  // A Chinese relic is never "repaired" with Arabic-Indic digits.
  const t = Engine.analyze(relicOf('台北市', [L('utf-8', 'big5')]));
  for (const h of [t.best].concat(t.alternatives).filter(Boolean)) assert.ok(!inRange(h.output, 0x600, 0x6ff), h.output);
});

test('core: Shift_JIS NEC rows (ED/EE) give back the bytes the decoder saw', () => {
  assert.deepEqual(Array.from(Codecs.encode('shift_jis', '愠').bytes), [0xfa, 0xc1], 'WHATWG encoder unchanged');
  const alt = Codecs.encode('shift_jis', '愠', { preferDecodedBytes: true });
  assert.deepEqual(Array.from(alt.bytes), [0xed, 0xa5]);
  assert.equal(alt.altUsed, 1);
  assert.equal(Codecs.decode('shift_jis', alt.bytes).text, '愠');
  restoredTo(relicOf('ログインに失敗しました', [L('euc-jp', 'shift_jis')]), 'ログインに失敗しました');
});

test('core: short iconic mojibake is restored', () => {
  for (const [input, expect] of [['Ã¤', 'ä'], ['Ã¼', 'ü'], ['â€“', '–'], ['Â©', '©'], ['â„¢', '™'], ['5Â°C', '5°C']]) {
    const r = restoredTo(input, expect);
    assert.equal(r.status, 'restored', input);
    assert.ok(r.best.confidence >= 0.25, `${input}: ${r.best.confidence}`);
  }
  assert.equal(Engine.analyze('¿¿¿¿').status, 'unknown');
});

test('core: Thai, Hebrew, Turkish and Polish code pages read as Windows-1252', () => {
  restoredTo('ÊÇÑÊ´Õ¤ÃÑº', 'สวัสดีครับ');
  restoredTo('ùìåí òåìí', 'שלום עולם');
  restoredTo('Merhaba, nasýlsýnýz?', 'Merhaba, nasılsınız?');
  restoredTo('Teþekkür ederim, görüþmek üzere.', 'Teşekkür ederim, görüşmek üzere.');
  restoredTo('Dzieñ dobry, jak siê masz?', 'Dzień dobry, jak się masz?');
  restoredTo('Szczêœliwego Nowego Roku', 'Szczęśliwego Nowego Roku');
});

test('core: short legacy CJK relics surface their reading; single rare Hanzi stay clean', () => {
  restoredTo('Ð»Ð»', '谢谢');
  restoredTo('È®ÀÎ', '확인');
  for (const t of ['冇', '嘅', '咗', '王喆', '周堃', '喆', '堃']) assert.equal(Engine.analyze(t).status, 'clean', t);
});

test('core: alternatives are ordered by confidence', () => {
  const inputs = ['Ã¿Ã¾Ã½Ã¼Ã»Ãº', '¾È³çÇÏ¼¼¿ä', 'Ã¤Â½Â Ã¥Â¥Â½'].concat(Forge.GALLERY.map((g) => g.relic));
  for (const t of inputs) {
    const r = Engine.analyze(t);
    for (let k = 1; k < r.alternatives.length; k++) {
      assert.ok(r.alternatives[k - 1].confidence >= r.alternatives[k].confidence, `${t}: ${r.alternatives.map((a) => a.confidence)}`);
    }
  }
});

test('core: decomposed (NFD) text read as Mac OS Roman, and "à" with a flattened NBSP', () => {
  const t = 'Tiếng Việt'.normalize('NFD');
  restoredTo(relicOf(t, [L('utf-8', 'macintosh')]), t);
  for (const s of ['Il est à Paris', 'à la carte', 'Rendez-vous à 15h', 'Je suis à la maison']) {
    restoredTo(relicOf(s, [L('utf-8', 'windows-1252')], { nbspToSpace: true }), s);
  }
});
