'use strict';
// MBX.Narrator on partial results: characters that passed through a layer untouched ("kept")
// are original text that was always intact — never "缺口", never counted as misread, and the
// Python recipe targets only the garbled run (narrator-facts #67).

const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const N = MBX.Narrator;
const STYLES = ['humor', 'academic', 'snark'];
const SEEDS = [0, 1, 2, 3];
const sec = (n, id) => (n.sections.find((s) => s.id === id) || { text: '' }).text;

const INPUTS = ['用户名：å¤§å®¶å¥½，欢迎回来', '欢迎来到 å¤§å®¶å¥½ 的世界，这里是正常文字。'];

function checkPartialNarration(n, output, where) {
  const text = n.plainText;
  if (output.indexOf('�') < 0) assert.ok(!text.includes('缺口'), `${where}: no "缺口" when nothing is missing`);
  assert.ok(!/一半|半边/.test(text), `${where}: no "half fixed" wording (${n.subtitle})`);
  assert.ok(!text.includes('更早的转换'), `${where}: no "earlier conversion" claim`);
  // the growth ratio only counts the 3 misread characters (大家好 → 9 mojibake characters)
  const ratio = text.match(/(\d+) 个原字符经过误读，(?:膨胀|压缩)成了 (\d+) 个字符/);
  if (ratio) assert.ok(ratio[1] === '3' && ratio[2] === '9', `${where}: ratio over misread characters only (${ratio[0]})`);
}

test('narrator-partial: engine partial results read as a local misreading, not a half-broken relic', () => {
  const E = MBX.Engine;
  if (!E || typeof E.analyze !== 'function') return;
  for (const input of INPUTS) {
    const r = E.analyze(input);
    if (!r.best) continue;
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const where = `${input}/${style}/${seed}`;
        const n = N.narrate(r, { style, seed });
        checkPartialNarration(n, r.best.output, where);
        if (r.status === 'partial') {
          const recipe = sec(n, 'conservation').split('\n').find((l) => l.includes('还原咒语')) || '';
          assert.ok(recipe.includes('å¤§å®¶å¥½'), `${where}: the recipe targets the garbled fragment (${recipe})`);
          assert.ok(n.plainText.includes('「å¤§å®¶å¥½」'), `${where}: names the garbled fragment`);
          assert.ok(!n.title.includes('残件'), `${where}: title ${n.title}`);
        }
      }
    }
  }
});

// A hand-built partial result exactly as the Seg contract describes it: untouched characters
// carry kept:true — zero-width when Windows-1252 cannot encode them (用户名：，欢迎回来) — in both
// segment lists, and the misread run 大家好 has ordinary byte spans.
function keptFixture(flagKept) {
  const before = '用户名：å¤§å®¶å¥½，欢迎回来';
  const after = '用户名：大家好，欢迎回来';
  const bytes = Uint8Array.of(0xe5, 0xa4, 0xa7, 0xe5, 0xae, 0xb6, 0xe5, 0xa5, 0xbd);
  const kept = (ch) => Object.assign({ ch, start: 0, end: 0 }, flagKept ? { kept: true } : {});
  const keptAt = (ch, at) => Object.assign({ ch, start: at, end: at }, flagKept ? { kept: true } : {});
  const segsBefore = Array.from('用户名：').map(kept)
    .concat(Array.from('å¤§å®¶å¥½').map((ch, i) => ({ ch, start: i, end: i + 1 })))
    .concat(Array.from('，欢迎回来').map((ch) => keptAt(ch, 9)));
  const segsAfter = Array.from('用户名：').map(kept)
    .concat([{ ch: '大', start: 0, end: 3 }, { ch: '家', start: 3, end: 6 }, { ch: '好', start: 6, end: 9 }])
    .concat(Array.from('，欢迎回来').map((ch) => keptAt(ch, 9)));
  const step = {
    kind: 'transcode', wrongDecoder: 'windows-1252', trueEncoding: 'utf-8', scheme: null,
    before, after, bytes, segmentsBefore: segsBefore, segmentsAfter: segsAfter,
    repairs: [], lossy: false, scoreBefore: -6, scoreAfter: -2, prior: 1, partial: true,
  };
  return {
    input: before, status: 'partial',
    best: {
      output: after, confidence: 0.8, steps: [step], repairs: [], label: '局部还原：UTF-8 被误读为 Windows-1252',
      lang: { lang: 'zh-Hans', name: '简体中文', confidence: 0.95 },
      score: { value: -2.1, total: -25, length: 12, lang: 'zh-Hans', script: 'han', badness: 0, flags: [] },
    },
    alternatives: [], signatures: [], signals: [],
    stats: { explored: 10, ms: 1, truncated: false },
  };
}

test('narrator-partial: kept:true segments are original text (and the zero-width fallback agrees)', () => {
  for (const flagKept of [true, false]) {
    const res = keptFixture(flagKept);
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const where = `kept=${flagKept}/${style}/${seed}`;
        const n = N.narrate(res, { style, seed, strict: true });
        checkPartialNarration(n, res.best.output, where);
        assert.ok(/3 个原字符经过误读，膨胀成了 9 个字符/.test(n.plainText), `${where}: ratio 3 → 9`);
        assert.ok(n.plainText.includes('其余 9 个字符原本就是正常文字'), `${where}: kept characters described as intact`);
        assert.ok(n.title.includes('局部误读'), `${where}: title ${n.title}`);
        const recipe = sec(n, 'conservation').split('\n').find((l) => l.includes('还原咒语')) || '';
        assert.ok(recipe.includes("对乱码片段「å¤§å®¶å¥½」执行 `s.encode('cp1252').decode('utf-8')`"), `${where}: recipe on the fragment (${recipe})`);
        assert.ok(recipe.includes('整段执行会报错'), `${where}: says why the whole text cannot go through it`);
        // kept characters are never traced as if they had been misread
        const m = sec(n, 'mechanism');
        for (const ch of '用户名欢迎回来') assert.ok(!m.includes('「' + ch + '」'), `${where}: ${ch} is not traced`);
        assert.ok(m.includes('E5 A4 A7') || m.includes('E5 AE B6') || m.includes('E5 A5 BD'), `${where}: traces a misread character`);
      }
    }
    const f = N.factsFor(res);
    for (const s of f.layers[0].samples) assert.ok(/^E5 /.test(s.bytes), `kept=${flagKept}: facts samples only cover misread characters`);
  }
});

test('narrator-partial: a partial result that still holds garbage is not called clean', () => {
  const res = keptFixture(true);
  res.best.score = Object.assign({}, res.best.score, { badness: 3, flags: ['mixed-script'] });
  for (const style of STYLES) {
    const n = N.narrate(res, { style, seed: 0, strict: true });
    assert.ok(n.title.includes('残件'), `${style}: remnant title ${n.title}`);
    assert.ok(!/一半|半边/.test(n.plainText), `${style}: no "half" wording even for a remnant`);
    assert.ok(!n.plainText.includes('原本就是正常文字'), `${style}: does not vouch for the untouched text`);
  }
});
