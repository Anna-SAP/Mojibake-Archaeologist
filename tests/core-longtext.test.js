'use strict';
// Long texts whose mojibake sits far from the start (beyond the search sample): the sample is
// built around the suspicious spots, and a partial repair never makes the text worse.

const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const { Engine } = MBX;

const P = 'Thanks for sending over the revised proposal yesterday afternoon. I read through all of it last night and ' +
  'overall I think it is in very good shape. The timeline looks realistic and the budget section is much clearer than ' +
  'the first draft. ';
const TAIL = 'I donâ€™t think we need another meeting. We met at the cafÃ© too.';
/** Does s contain a code point in [lo, hi]? */
const inRange = (s, lo, hi) => Array.from(s).some((c) => c.codePointAt(0) >= lo && c.codePointAt(0) <= hi);
const FIXED = 'I don’t think we need another meeting. We met at the café too.';

function fill(n) {
  let s = '';
  while (s.length < n) s += P;
  return s;
}

test('core-longtext: mojibake after the first ~800 code points is restored like a short text', () => {
  const short = Engine.analyze(TAIL);
  assert.equal(short.best.output, FIXED);
  for (const head of [P.repeat(4), P.repeat(7)]) { // ~900 and ~1700 characters of clean English first
    const r = Engine.analyze(head + TAIL);
    assert.ok(r.status === 'restored' || r.status === 'partial', r.status);
    assert.equal(r.best.output, head + FIXED);
    assert.ok(r.best.label.includes('UTF-8 被误读为 Windows-1252'), r.best.label);
    assert.ok(!inRange(r.best.output, 0x600, 0x6ff) && !inRange(r.best.output, 0x300, 0x36f), 'no Arabic marks or combining marks invented');
    assert.equal(r.stats.truncated, true);
  }
});

test('core-longtext: one garbled word inside 5k of English', () => {
  const big = fill(2500);
  const r = Engine.analyze(big + 'I donâ€™t know. ' + big);
  assert.ok(r.status === 'restored' || r.status === 'partial', r.status);
  assert.equal(r.best.output, big + 'I don’t know. ' + big);
  assert.ok(r.best.label.includes('Windows-1252'), r.best.label);
});

test('core-longtext: a whitespace prefix is no evidence for a UTF-16 reading', () => {
  const input = '\n'.repeat(1000) + 'cafÃ©';
  const r = Engine.analyze(input);
  assert.ok(r.best, r.status);
  const out = r.best.output;
  assert.ok(out === '\n'.repeat(1000) + 'café' || out.startsWith('\n'.repeat(1000)), 'the newlines stay untouched');
  assert.ok(!inRange(out, 0xa00, 0xa7f), 'no Gurmukhi (newline pairs read as UTF-16)');
  assert.ok(!r.best.label.includes('UTF-16'), r.best.label);
});

test('core-longtext: the engine never returns a text more garbled than its input', () => {
  // A long clean text with a few genuine accents: nothing to repair, nothing to break.
  const text = fill(3000) + 'Déjà vu: the café menu lists crème brûlée. ' + fill(600);
  const r = Engine.analyze(text);
  assert.equal(r.status, 'clean', `${r.status} ${r.best && r.best.label}`);
});
