'use strict';
// UI helpers (MBX.App.util) on real engine output: the pure decisions behind the page.

const path = require('path');
const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const App = require(path.join(__dirname, '..', 'src', 'app.js'));
const U = App.util;
const FFFD = String.fromCodePoint(0xfffd);

const analyze = (s) => U.normalizeResult(MBX.Engine.analyze(s), s);
const view = (s, i) => U.deriveView(analyze(s), i == null ? null : i);
const count = (s, sub) => s.split(sub).length - 1;

// ---------------------------------------------------------------------------
// Settings drawer: a key never follows the form to another provider (#1)
// ---------------------------------------------------------------------------

const PROVIDERS = [
  { id: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com', defaultModel: 'claude-opus-5-5' },
  { id: 'openai', defaultBaseUrl: '', defaultModel: '' },
];

test('app: providerSwitchForm clears the key when the provider changes', () => {
  const prev = { provider: 'anthropic', apiKey: 'sk-ant-api03-secret', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5' };
  const next = U.providerSwitchForm(prev, 'openai', PROVIDERS, { provider: 'anthropic', apiKey: 'sk-ant-api03-secret' });
  assert.equal(next.provider, 'openai');
  assert.equal(next.apiKey, '', 'key cleared');
  assert.equal(next.keyCleared, true, 'visitor is told');
  assert.equal(next.baseUrl, '', 'untouched default URL follows the provider');
  assert.equal(next.model, '', 'untouched default model follows the provider');
});

test('app: providerSwitchForm keeps the form when the provider is unchanged', () => {
  const prev = { provider: 'openai', apiKey: 'sk-local', baseUrl: 'http://localhost:11434/v1', model: 'llama3' };
  const next = U.providerSwitchForm(prev, 'openai', PROVIDERS, null);
  assert.equal(next.apiKey, 'sk-local');
  assert.equal(next.baseUrl, 'http://localhost:11434/v1');
  assert.equal(next.model, 'llama3');
  assert.equal(next.keyCleared, false);
});

test('app: providerSwitchForm keeps customised URL/model and fills untouched defaults', () => {
  const custom = U.providerSwitchForm({ provider: 'openai', apiKey: '', baseUrl: 'https://gw.example/v1', model: 'my-model' }, 'anthropic', PROVIDERS, null);
  assert.equal(custom.baseUrl, 'https://gw.example/v1', 'custom URL kept');
  assert.equal(custom.model, 'my-model', 'custom model kept');
  assert.equal(custom.keyCleared, false, 'nothing to clear');
  const fresh = U.providerSwitchForm({ provider: 'none', apiKey: '', baseUrl: '', model: '' }, 'anthropic', PROVIDERS, null);
  assert.equal(fresh.baseUrl, 'https://api.anthropic.com');
  assert.equal(fresh.model, 'claude-opus-5-5');
});

test('app: the saved key comes back only for its own provider and host', () => {
  const saved = { provider: 'anthropic', apiKey: 'sk-ant-saved', baseUrl: '' };
  const away = U.providerSwitchForm({ provider: 'anthropic', apiKey: 'sk-ant-saved', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5' }, 'openai', PROVIDERS, saved);
  assert.equal(away.apiKey, '');
  const back = U.providerSwitchForm(away, 'anthropic', PROVIDERS, saved);
  assert.equal(back.apiKey, 'sk-ant-saved', 'restored on return');
  assert.equal(back.keyRestored, true);
  const elsewhere = U.providerSwitchForm({ provider: 'openai', apiKey: '', baseUrl: 'https://gw.example/v1', model: 'm' }, 'anthropic', PROVIDERS, saved);
  assert.equal(elsewhere.apiKey, '', 'not restored for another host');
});

test('app: keyNeedsReentry flags the stored key pointed at another host', () => {
  const saved = { provider: 'openai', apiKey: 'sk-1', baseUrl: 'https://api.deepseek.com/v1' };
  assert.equal(U.keyNeedsReentry({ provider: 'openai', apiKey: 'sk-1', baseUrl: 'https://api.deepseek.com/v1/' }, saved, PROVIDERS), false, 'same host');
  assert.equal(U.keyNeedsReentry({ provider: 'openai', apiKey: 'sk-1', baseUrl: 'http://evil.example/v1' }, saved, PROVIDERS), true, 'other host');
  assert.equal(U.keyNeedsReentry({ provider: 'openai', apiKey: 'sk-new', baseUrl: 'http://evil.example/v1' }, saved, PROVIDERS), false, 'a newly typed key is the visitor\'s choice');
  assert.equal(U.keyNeedsReentry({ provider: 'anthropic', apiKey: 'sk-1', baseUrl: '' }, saved, PROVIDERS), true, 'other provider');
});

test('app: providerSwitchForm works with the real LLM provider list', () => {
  const providers = MBX.LLM.listProviders().filter((p) => p.id !== 'none');
  const next = U.providerSwitchForm({ provider: 'anthropic', apiKey: 'sk-ant-api03-x', baseUrl: '', model: '' }, 'openai', providers, null);
  assert.equal(next.apiKey, '');
});

// ---------------------------------------------------------------------------
// Byte grid: kept text is never a stack of gaps (#2), rows are chunked (#23)
// ---------------------------------------------------------------------------

const LONG_PARTIAL = '这是一篇很长的中文文章，用来测试局部修复。'.repeat(20) + ' å¤§å®¶å¥½ ' + '后面还有很多正常的中文内容。'.repeat(10);

test('app: partial layers show kept runs, not lost-byte gaps', () => {
  for (const input of ['欢迎来到 å¤§å®¶å¥½ 的世界，这里是正常文字。', LONG_PARTIAL, '请查看附件：æŠ¥å‘Š.docx 谢谢']) {
    const r = analyze(input);
    assert.ok(r.best && r.best.steps.length, `${input.slice(0, 8)}: has a reading`);
    for (const step of r.best.steps) {
      const g = U.buildGridModel(step, 48);
      if (!g) continue;
      for (const row of ['top', 'bottom']) {
        assert.equal(g[row].filter((x) => x.gap).length, 0, `${input.slice(0, 8)} ${row}: no gaps`);
        assert.ok(g[row].filter((x) => x.kept).length <= 2, `${input.slice(0, 8)} ${row}: at most 2 kept runs`);
        for (const it of g[row]) if (it.kept) assert.equal(it.gap, false, 'kept is never a gap');
      }
    }
  }
});

test('app: a lossy relic still shows its lost bytes as a gap', () => {
  const forged = MBX.Forge.corrupt('中文测试数据', [{ encoding: 'utf-8', misreadAs: 'big5' }]).output;
  assert.ok(forged.includes(FFFD), 'forged relic is lossy');
  const r = analyze(forged);
  assert.ok(r.best, 'lossy relic has a reading');
  const gaps = r.best.steps.reduce((n, step) => {
    const g = U.buildGridModel(step, 48);
    return n + (g ? g.top.concat(g.bottom).filter((x) => x.gap).length : 0);
  }, 0);
  assert.ok(gaps >= 1, `gap markers present (${gaps})`);
});

test('app: hand-built kept segments render as one kept run per insertion point', () => {
  const step = {
    kind: 'transcode', partial: true, wrongDecoder: 'windows-1252', trueEncoding: 'utf-8',
    bytes: [0xe5, 0xa4, 0xa7],
    segmentsBefore: [
      { ch: '欢', start: 0, end: 0, kept: true }, { ch: '迎', start: 0, end: 0, kept: true },
      { ch: 'å', start: 0, end: 1 }, { ch: '¤', start: 1, end: 2 }, { ch: '§', start: 2, end: 3 },
      { ch: '。', start: 3, end: 3, kept: true },
    ],
    segmentsAfter: [
      { ch: '欢', start: 0, end: 0, kept: true }, { ch: '迎', start: 0, end: 0, kept: true },
      { ch: '大', start: 0, end: 3 },
      { ch: '。', start: 3, end: 3, kept: true },
    ],
  };
  const g = U.buildGridModel(step, 48);
  const kept = g.top.filter((x) => x.kept);
  assert.deepEqual(kept.map((x) => [x.text, x.start]), [['欢迎', 0], ['。', 3]]);
  assert.equal(g.top.filter((x) => x.gap).length, 0);
  assert.deepEqual(g.bottom.filter((x) => x.kept).map((x) => x.text), ['欢迎', '。']);
  // The report's character map skips kept characters.
  assert.deepEqual(U.charMapRows(step, 10).map((r) => r.after), ['大']);
  // A real lost marker is never kept.
  assert.equal(U.isKeptSeg({ ch: FFFD, start: 1, end: 1, error: true, lost: true }, true), false);
});

test('app: chunkGridModel cuts rows at character boundaries and covers every byte', () => {
  const r = analyze('å¤§å®¶å¥½'.repeat(6));
  const step = r.best.steps[0];
  const g = U.buildGridModel(step, 4096);
  for (const per of [16, 8]) {
    const chunks = U.chunkGridModel(g, per);
    assert.equal(chunks[0].start, 0);
    assert.equal(chunks[chunks.length - 1].end, g.shown, 'last chunk ends at the shown edge');
    chunks.forEach((c, i) => {
      if (i) assert.equal(c.start, chunks[i - 1].end, 'chunks are contiguous');
      assert.ok(c.bytes <= per + 3, `chunk ${i} is about ${per} bytes (${c.bytes})`);
      for (const row of ['top', 'bottom']) {
        for (const k of c[row]) {
          const it = g[row][k];
          if (it.gap || it.kept) continue;
          assert.ok(it.start >= c.start && Math.min(it.end, g.shown) <= c.end, `${row}[${k}] stays inside its chunk`);
        }
      }
    });
    const placed = chunks.reduce((n, c) => n + c.top.length + c.bottom.length, 0);
    assert.equal(placed, g.top.length + g.bottom.length, 'every item placed once');
  }
  const one = U.chunkGridModel(g, 16)[1];
  assert.equal(U.chunkByteColumn(one, one.start), 2, 'first byte sits right after the label column');
  assert.ok(/^var\(--label\) repeat\(\d+, var\(--cell\)\)$/.test(U.chunkTemplate(one)), U.chunkTemplate(one));
});

test('app: kept columns are auto-width and shift the bytes after them', () => {
  const chunk = { start: 0, end: 4, keptAt: [0, 2], bytes: 4, cols: 6 };
  assert.equal(U.chunkTemplate(chunk), 'var(--label) auto repeat(2, var(--cell)) auto repeat(2, var(--cell))');
  assert.equal(U.chunkKeptColumn(chunk, 0), 2);
  assert.equal(U.chunkByteColumn(chunk, 0), 3);
  assert.equal(U.chunkKeptColumn(chunk, 2), 5);
  assert.equal(U.chunkByteColumn(chunk, 2), 6);
});

// ---------------------------------------------------------------------------
// Verdict status and copy (#3, #4, #8, #9)
// ---------------------------------------------------------------------------

test('app: promoting a low-confidence guess never claims a restoration', () => {
  assert.equal(view('Ã¿Ã¾Ã½Ã¼Ã»Ãº', 0).status, 'unknown', 'reading of an unsolved relic');
  const r = analyze('å¤§å®¶å¥½');
  assert.ok(r.alternatives.length >= 1 && r.alternatives[0].confidence < 0.3, 'the engine offers a weak alternative');
  const v = U.deriveView(r, 1);
  assert.equal(v.status, 'unknown', '1% guess');
  const copy = U.statusCopy(v, r.best);
  assert.equal(copy.headline, '你采纳了一个候选结论');
  assert.ok(copy.desc.includes('首席结论仍是「大家好」'), copy.desc);
  const md = U.buildMarkdownReport({ view: v, engineBest: r.best });
  assert.ok(md.includes('（用户采纳的候选）'), 'report marks the adopted candidate');
  assert.ok(!md.includes('已复原（restored）'), 'report does not claim a restoration');
});

test('app: promoting a solid alternative of a restored relic stays restored', () => {
  const result = U.normalizeResult({
    input: 'x', status: 'restored',
    best: { output: 'A', confidence: 0.6, steps: [] },
    alternatives: [{ output: 'B', confidence: 0.35, steps: [] }, { output: 'C', confidence: 0.1, steps: [] }],
  });
  assert.equal(U.deriveView(result, 1).status, 'restored');
  assert.equal(U.deriveView(result, 2).status, 'unknown');
  assert.equal(U.deriveView(result, null).status, 'restored');
  for (const s of ['partial', 'irrecoverable']) {
    assert.equal(U.deriveView(Object.assign({}, result, { status: s }), 1).status, s, `${s} is kept`);
  }
});

test('app: an irrecoverable report presents what remains, not a restoration', () => {
  const v = view('锟斤拷');
  assert.equal(v.status, 'irrecoverable');
  const md = U.buildMarkdownReport({ view: v, narrationText: 'x' });
  assert.ok(!md.includes('## 还原原文'), 'no restored-text section');
  assert.ok(!md.includes('可信度'), 'no confidence row');
  if (v.best) {
    assert.ok(md.includes('## 残存内容（原文已丢失）'), 'what remains');
    assert.ok(md.includes('| 判定把握 |'), 'diagnosis certainty');
  }
});

test('app: statusCopy distinguishes a fully repaired partial from a lossy one', () => {
  const docx = view('请查看附件：æŠ¥å‘Š.docx 谢谢');
  if (docx.status === 'partial') {
    assert.equal(U.statusCopy(docx).label, '局部修复');
    assert.equal(U.statusCopy(docx).headline, App.PARTIAL_CLEAN_COPY.headline);
  }
  const lossy = view(MBX.Forge.corrupt('中文测试数据', [{ encoding: 'utf-8', misreadAs: 'big5' }]).output);
  if (lossy.status === 'partial') assert.equal(U.statusCopy(lossy).headline, App.STATUS_COPY.partial.headline);
  // Without a scorer verdict the copy stays conservative.
  assert.equal(U.statusCopy({ status: 'partial', best: { output: `a${FFFD}b` } }).label, '部分修复');
  assert.equal(U.statusCopy({ status: 'restored' }).label, '已复原');
});

test('app: languageFact never guesses a language from the mojibake itself', () => {
  for (const junk of ['¶ƒ∆˚¬…Ψψ§±×÷ÞßðŁ', 'ÃÃÃÃÃÃÃÃÃÃ']) {
    const v = view(junk);
    if (!v.best) assert.equal(U.languageFact(v), '无法判断', junk);
  }
  assert.equal(U.languageFact({ status: 'unknown', input: 'Ã¦â€“â€¡Ã§â€°Â©', best: null }), '无法判断');
  assert.equal(U.languageFact({ status: 'irrecoverable', input: '锟斤拷', best: { output: `${FFFD}${FFFD}` } }), '无法判断');
  const clean = view('Hello world, this is plain English text.');
  assert.equal(clean.status, 'clean');
  assert.notEqual(U.languageFact(clean), '无法判断');
  assert.equal(U.languageFact(view('å¤§å®¶å¥½')), view('å¤§å®¶å¥½').best.lang.name);
});

// ---------------------------------------------------------------------------
// Share links (#5) and untrusted text (#6, #19)
// ---------------------------------------------------------------------------

test('app: very long share links fill the box but do not auto-run', () => {
  assert.equal(U.shouldAutoRunHash('a'.repeat(20000)), true);
  assert.equal(U.shouldAutoRunHash('a'.repeat(20001)), false);
  assert.equal(U.shouldAutoRunHash(''), true);
  const long = 'å'.repeat(30000);
  assert.equal(U.readHashQuery(U.buildShareUrl('http://x/#old', long).split('#')[1]), long);
});

test('app: parseInline is linear on long backtick runs', () => {
  for (const n of [2000, 8000, 40000]) {
    const t0 = Date.now();
    const toks = U.parseInline('`'.repeat(n) + 'a');
    const ms = Date.now() - t0;
    assert.ok(ms < 50, `${n} backticks parsed in ${ms} ms`);
    assert.equal(toks.map((t) => t.v).join(''), '`'.repeat(n) + 'a', 'unmatched run stays literal');
  }
  const t0 = Date.now();
  U.parseInline('**'.repeat(20000) + '`a'.repeat(20000));
  assert.ok(Date.now() - t0 < 100, 'mixed runs stay fast');
});

test('app: parseInline tokens are unchanged for ordinary markup', () => {
  assert.deepEqual(U.parseInline('字节 `E5 A4` 很**粗**'), [
    { t: 'text', v: '字节 ' }, { t: 'code', v: 'E5 A4' }, { t: 'text', v: ' 很' }, { t: 'strong', v: '粗' },
  ]);
  assert.deepEqual(U.parseInline('``a`b``'), [{ t: 'code', v: 'a`b' }]);
  assert.deepEqual(U.parseInline('没有闭合的 **粗体'), [{ t: 'text', v: '没有闭合的 **粗体' }]);
  assert.deepEqual(U.parseInline('`a` and ``b``'), [{ t: 'code', v: 'a' }, { t: 'text', v: ' and ' }, { t: 'code', v: 'b' }]);
  assert.deepEqual(U.parseInline('****'), [{ t: 'text', v: '****' }]);
  assert.equal(U.stripMarkup('**粗** `码`'), '粗 码');
  assert.equal(U.parseMini('一\n二\n\n三').length, 2);
});

test('app: the Markdown report neutralises raw HTML and script links from AI text', () => {
  const v = view('å¤§å®¶å¥½');
  const md = U.buildMarkdownReport({
    view: v,
    narrationText: '<img src=x onerror=alert(1)>\n[点我](javascript:alert(1)) [ok](https://example.com) [d](DATA:text/html,x)\n[ref]: vbscript:msgbox',
  });
  assert.ok(!md.includes('<img src=x'), 'raw HTML escaped');
  assert.ok(md.includes('&lt;img'), 'escaped form kept readable');
  assert.ok(!/\]\(\s*javascript:/i.test(md), 'javascript: link defanged');
  assert.ok(!/\]\(\s*data:/i.test(md), 'data: link defanged');
  assert.ok(!/^\[ref\]:\s*vbscript:/im.test(md), 'reference definition defanged');
  assert.ok(md.includes('[ok](https://example.com)'), 'normal links untouched');
  const plain = U.buildMarkdownReport({ view: v, narrationText: '**大家好** 的字节是 `E5 A4 A7`。' });
  assert.ok(plain.includes('**大家好** 的字节是 `E5 A4 A7`。'), 'template narration stays readable');
});

// ---------------------------------------------------------------------------
// Repairs (#7)
// ---------------------------------------------------------------------------

test('app: repairs in intermediate layers are not pinned to a final-output character', () => {
  const steps = [{}, {}];
  const line = U.repairLine({ index: 4, from: '', to: '嗁', reason: 'dropped', step: 0, candidates: ['嗁', '嗎'] }, steps);
  assert.ok(line.startsWith('第 1 层（中间层）：'), line);
  assert.ok(!line.includes('第 5 个字'), line);
  assert.ok(U.repairLine({ index: 4, from: '', to: '大', reason: 'gap', step: 1 }, steps).startsWith('第 5 个字：'), 'final layer keeps its position');
  assert.ok(U.repairLine({ index: -1, to: '大', reason: 'gap' }, steps).startsWith('某处：'), 'untraceable position');
  const nbsp = U.repairLine({ index: 0, from: ' ', to: ' ', reason: 'nbsp', step: 0, candidates: [' '] }, [{}]);
  assert.ok(nbsp.includes('「U+0020」→「U+00A0」'), nbsp);
  assert.ok(nbsp.includes('候选：U+00A0'), nbsp);

  const r = analyze(MBX.Forge.corrupt('日本語のテキスト、こんにちは',
    [{ encoding: 'utf-8', misreadAs: 'gbk' }, { encoding: 'utf-8', misreadAs: 'windows-1252' }], { dropInvisible: true }).output);
  const deep = r.best && r.best.repairs.find((x) => Number.isInteger(x.step) && x.step < r.best.steps.length - 1);
  if (deep) {
    const s = U.repairLine(deep, r.best.steps);
    assert.ok(s.includes('（中间层）') && !/第 \d+ 个字/.test(s), s);
    const md = U.buildMarkdownReport({ view: U.deriveView(r, null) });
    assert.ok(md.includes('（中间层）'), 'report uses the same wording');
  }
  const r2 = analyze('Ã¤Â½Â Ã¥Â¥Â½');
  for (const rep of (r2.best && r2.best.repairs) || []) {
    if (rep.reason !== 'nbsp') continue;
    const s = U.repairLine(rep, r2.best.steps);
    assert.ok(s.includes('U+0020') && s.includes('U+00A0'), s);
  }
});

// ---------------------------------------------------------------------------
// Panels (#13, #14) and AI notices (#16, #18)
// ---------------------------------------------------------------------------

test('app: near-zero alternatives are folded away', () => {
  const hyps = [{ confidence: 0.91 }, { confidence: 0.01 }, { confidence: 0.2 }, { confidence: 0.0 }, { confidence: 0.04 }];
  const p = U.partitionAlternatives(hyps, true);
  assert.deepEqual(p.main, [0, 2]);
  assert.deepEqual(p.more, [1, 3, 4]);
  const guesses = U.partitionAlternatives([{ confidence: 0.1 }, { confidence: 0.02 }, { confidence: 0.05 }], false);
  assert.deepEqual(guesses.main, [0, 2]);
  assert.deepEqual(guesses.more, [1]);
  const weak = U.partitionAlternatives([{ confidence: 0.01 }, { confidence: 0.02 }, { confidence: 0.005 }], false);
  assert.deepEqual(weak.main, [1], 'the strongest weak guess still gets a card');
  assert.deepEqual(weak.more, [0, 2]);
  const real = analyze('å¤§å®¶å¥½');
  const pr = U.partitionAlternatives(U.hypotheses(real), true);
  assert.equal(pr.main[0], 0, 'the engine choice always gets a card');
});

test('app: signals are grouped by hint', () => {
  const g = U.groupSignals([
    { type: 'utf8-as-1252', match: 'å¤§', hint: 'H1' },
    { type: 'utf8-as-1252', match: 'å®¶', hint: 'H1' },
    { type: 'utf8-as-1252', match: 'å¤§', hint: 'H1' },
    { type: 'c1', match: '\u0081', hint: 'H2' },
    { type: 'no-hint', match: 'x' },
  ]);
  assert.deepEqual(g.map((x) => [x.hint, x.matches, x.count]), [
    ['H1', ['å¤§', 'å®¶'], 3], ['H2', ['\u0081'], 1], ['no-hint', ['x'], 1],
  ]);
  const real = analyze('å¤§å®¶å¥½'.repeat(6));
  const hints = new Set(real.signals.map((s) => s.hint || s.type));
  assert.equal(U.groupSignals(real.signals).length, hints.size, 'one group per distinct hint');
});

function llmError(code, message, extra) {
  const e = new Error(message);
  e.name = 'LLMError';
  e.code = code;
  return Object.assign(e, extra || {});
}

test('app: AI failure notices are one clean sentence', () => {
  const cases = [
    llmError('refusal', 'AI 讲解员婉拒了这件展品（模型以 refusal 结束），已改由馆内模板讲解员解说。'),
    llmError('auth', '鉴权失败（HTTP 401）：API 密钥无效。', { status: 401 }),
    llmError('network', '无法连接到 http://localhost:11434/v1（可能是网络问题，或需设置 OLLAMA_ORIGINS=*。）。'),
    llmError('cors', ''),
    Object.assign(new Error('boom'), { code: 'http', status: 500 }),
  ];
  for (const e of cases) {
    const msg = U.aiErrorMessage(e);
    assert.equal(count(msg, '已换回馆内讲解员'), 1, msg);
    assert.ok(!msg.includes('。）。') && !msg.includes('。。'), `no doubled punctuation: ${msg}`);
    assert.ok(!/（[^）]*（[^）]*）[^）]*）/.test(msg), `no nested parentheses: ${msg}`);
    assert.ok(!msg.includes('已改由馆内模板讲解员解说'), msg);
  }
  assert.ok(U.aiErrorMessage(cases[0]).startsWith('AI 讲解员婉拒了这件展品（模型以 refusal 结束）'));
  assert.ok(U.aiErrorMessage(cases[3]).startsWith('浏览器的跨域限制'), 'fallback copy without a message');
  assert.equal(U.aiFailureBlocksRetry(cases[1]), true);
  assert.equal(U.aiFailureBlocksRetry(cases[2]), true);
  assert.equal(U.aiFailureBlocksRetry(cases[0]), false, 'a refusal may not repeat');
});

test('app: truncated AI narrations are recognised', () => {
  assert.equal(U.isTruncatedStop('max_tokens'), true);
  assert.equal(U.isTruncatedStop('length'), true);
  for (const s of ['end_turn', 'stop', null, undefined, '']) assert.equal(U.isTruncatedStop(s), false, String(s));
});

test('app: the fallback exhibit id matches the narrator formula', () => {
  assert.equal(U.fallbackExhibitId('锟斤拷'), 'MBX-2026-6B6B');
  for (const s of ['锟斤拷', 'å¤§å®¶å¥½', 'Hello']) {
    assert.equal(U.fallbackExhibitId(s), MBX.Narrator.narrate(MBX.Engine.analyze(s)).exhibitId, s);
  }
});
