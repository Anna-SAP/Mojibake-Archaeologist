'use strict';
// The Seg contract for characters a layer leaves alone: `kept: true` on both sides of the step
// (zero-width when W cannot encode them, their own byte span in a declined / unchanged block).
// Lost-byte markers keep `error: true, lost: true` and never carry `kept`.

const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const { Engine, Forge } = MBX;

const FFFD = String.fromCharCode(0xfffd);

test('core-segs: pass-through characters of a partial layer are flagged kept, not gaps', () => {
  const r = Engine.analyze('欢迎来到 å¤§å®¶å¥½ 的世界，这里是正常文字。');
  assert.equal(r.status, 'partial');
  const st = r.best.steps[0];
  assert.ok(st.partial);
  for (const [name, segs] of [['segmentsBefore', st.segmentsBefore], ['segmentsAfter', st.segmentsAfter]]) {
    for (const s of segs) {
      if (s.start === s.end && !s.error) assert.equal(s.kept, true, `${name}: zero-width ${s.ch} must be kept`);
      if (s.kept) assert.ok(!s.error && !s.lost, `${name}: kept ${s.ch} is no error`);
    }
    assert.equal(segs[0].ch, '欢');
    assert.equal(segs[0].kept, true);
  }
  const da = st.segmentsAfter.find((s) => s.ch === '大');
  assert.ok(da && da.start < da.end && !da.kept, JSON.stringify(da));
  // Both sides agree on which characters were kept.
  const keptBefore = st.segmentsBefore.filter((s) => s.kept).map((s) => s.ch).join('');
  const keptAfter = st.segmentsAfter.filter((s) => s.kept).map((s) => s.ch).join('');
  assert.equal(keptBefore, keptAfter);
});

test('core-segs: lost markers stay lost and are never kept', () => {
  const relic = Forge.corrupt('中文测试数据', [{ encoding: 'utf-8', misreadAs: 'big5' }]).output;
  const r = Engine.analyze(relic);
  assert.ok(r.best, r.status);
  const lost = r.best.steps[r.best.steps.length - 1].segmentsAfter.filter((s) => s.ch === FFFD);
  assert.ok(lost.length >= 1);
  for (const s of lost) {
    assert.ok(s.error && s.lost, JSON.stringify(s));
    assert.ok(!s.kept, JSON.stringify(s));
  }
});

test('core-segs: 锟斤拷 inside normal text is explained only where it occurs', () => {
  const r = Engine.analyze('用户名：锟斤拷锟斤拷，密码正确');
  assert.equal(r.status, 'irrecoverable');
  assert.ok(r.best, 'the chain is kept as an explanation');
  assert.ok(r.best.output.endsWith('，密码正确'), r.best.output);
  assert.equal(r.best.output, '用户名：' + FFFD.repeat(4) + '，密码正确');
  const after = r.best.steps[0].segmentsAfter;
  for (const s of after) {
    if (s.ch !== FFFD) assert.equal(s.kept, true, `${s.ch} outside the 锟斤拷 run stays as typed`);
  }
  const plain = Engine.analyze('锟斤拷');
  assert.equal(plain.status, 'irrecoverable');
  assert.equal(plain.best.output, FFFD + FFFD);
});
