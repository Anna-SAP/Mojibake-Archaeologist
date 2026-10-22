'use strict';
// Long inputs: bounded time, deterministic results (the work budget counts work, not
// milliseconds), and every garbled line of a mixed log repaired.

const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const { Engine, Forge } = MBX;

const LINES = ['订单号 10023，客户张三，金额 299 元，状态已发货', '订单号 10026，客户赵六，金额 88 元，状态已取消'];
const moj = (t) => Forge.corrupt(t, [{ encoding: 'utf-8', misreadAs: 'windows-1252' }]).output;

function orderLog(n) {
  let q = '';
  for (let i = 0; q.length < n; i++) {
    const l = LINES[(i >> 1) % 2];
    q += (i % 2 ? moj(l) : l) + '\n';
  }
  return q;
}

function randomHan(n) {
  let x = 1;
  const r = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296;
  let s = '';
  while (s.length < n) s += String.fromCharCode(0x4e00 + Math.floor(r() * 20000));
  return s;
}

const garbled = (out) => out.split('\n').filter((l) => l && !LINES.includes(l)).length;

test('core-perf: a 30k mixed log is repaired completely and identically twice', () => {
  const q = orderLog(30000);
  const t0 = Date.now();
  const a = Engine.analyze(q);
  const ms = Date.now() - t0;
  const b = Engine.analyze(q);
  assert.ok(a.best && b.best, a.status);
  assert.equal(garbled(a.best.output), 0, 'garbled lines left');
  assert.equal(a.best.output, b.best.output);
  assert.equal(a.best.label, b.best.label);
  assert.equal(a.status, b.status);
  assert.equal(typeof a.stats.budgetHit, 'boolean');
  assert.ok(ms < 3000, `30k log took ${ms} ms`);
});

test('core-perf: 50k random Hanzi finish in bounded time', () => {
  const s = randomHan(50000);
  const t0 = Date.now();
  const r = Engine.analyze(s);
  const ms = Date.now() - t0;
  assert.ok(['clean', 'unknown', 'partial', 'restored', 'irrecoverable'].includes(r.status));
  assert.equal(typeof r.stats.budgetHit, 'boolean');
  assert.ok(ms < 3000, `50k random Hanzi took ${ms} ms`);
});
