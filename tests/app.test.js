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

// ---------------------------------------------------------------------------
// Interface language (docs/ARCHITECTURE.md §11): the helpers speak en-US on request and stay
// byte-for-byte Chinese by default.
// ---------------------------------------------------------------------------

const I18n = MBX.I18n;
const EN = 'en-US';
const HAN = /\p{Script=Han}/u;

function inLocale(locale, fn) {
  const before = I18n.getLocale();
  I18n.setLocale(locale);
  try {
    return fn();
  } finally {
    I18n.setLocale(before);
  }
}

// A hand-built restored view, so these checks do not depend on the engine's own wording.
function sampleView() {
  return {
    input: 'å¤§', status: 'restored', promotedFrom: null,
    signatures: [{ id: 'kun', title: 'Test relic', match: '锟斤拷', note: 'A famous one.' }],
    best: {
      output: '大', confidence: 0.9, label: 'UTF-8 misread as Windows-1252', lang: { name: 'Simplified Chinese', lang: 'zh-Hans' },
      repairs: [],
      steps: [{
        kind: 'transcode', trueEncoding: 'utf-8', wrongDecoder: 'windows-1252', lossy: true, before: 'å¤§', after: '大',
        bytes: [0xe5, 0xa4, 0xa7],
        segmentsBefore: [{ ch: 'å', start: 0, end: 1 }, { ch: '¤', start: 1, end: 2 }, { ch: '§', start: 2, end: 3 }],
        segmentsAfter: [{ ch: '大', start: 0, end: 3, repaired: true }],
        repairs: [{ index: 0, from: '', to: '大', reason: 'gap', step: 0, candidates: ['大', '夫'] }],
      }],
    },
  };
}

// Report text outside fenced blocks and inline code: what the dictionary wrote.
const prose = (md) => md.replace(/```[\s\S]*?```/g, '').replace(/`+[^`\n]*`+/g, '');

test('app i18n: the Markdown report follows opts.locale', () => {
  const view = sampleView();
  const date = new Date(2026, 0, 2, 3, 4);
  const en = U.buildMarkdownReport({ view, date, exhibitId: 'MBX-2026-0001', locale: EN });
  const lines = en.split('\n');
  assert.equal(lines[0], '# Mojibake Appraisal Report · MBX-2026-0001');
  assert.equal(lines[2], '> Generated by Mojibake Archaeologist on 2026-01-02 03:04');
  for (const want of [
    '| Item | Finding |', '| Appraisal status | Restored (`restored`) |', '| Confidence | 90% |', '| Language | Simplified Chinese |',
    '| Strata | 1 |', '## Excavated mojibake', '## Restored text', '## Misreading chain (chronological)',
    '1. Bytes encoded as **UTF-8** were misread as **Windows-1252** (lossy: some bytes were lost along the way).',
    '## Stratigraphy of Bytes (surface to bedrock)', '### Layer 1: UTF-8 misread as Windows-1252',
    '- Bytes (3 in total): `E5 A4 A7`', '- Lossy layer: some bytes were lost in transit; repaired as best we could',
    '- Repair: Character 1: "(lost)" → "大" · gap filled; candidates: 大, 夫', '| Misread | Bytes | Restored |',
    '## Famous relics identified', '- **Test relic**: `锟斤拷` — A famous one.',
    '_Generated locally in your browser. When in doubt, trust the byte data._',
  ]) assert.ok(lines.includes(want), `missing line: ${want}`);
  assert.ok(lines.some((l) => /^\| `.+` \| E5 A4 A7 \| `大` \(repaired\) \|$/.test(l)), 'char map row');
  assert.ok(!HAN.test(prose(en).replace('- Repair: Character 1: "(lost)" → "大" · gap filled; candidates: 大, 夫', '')), 'no Chinese outside the data');
  // The same view in Chinese, explicitly or by default.
  const zh = U.buildMarkdownReport({ view, date, exhibitId: 'MBX-2026-0001' });
  assert.equal(U.buildMarkdownReport({ view, date, exhibitId: 'MBX-2026-0001', locale: 'zh-CN' }), zh);
  assert.ok(zh.startsWith('# 乱码考古鉴定报告 · MBX-2026-0001'), 'zh-CN by default');
  assert.equal(inLocale(EN, () => U.buildMarkdownReport({ view, date, exhibitId: 'MBX-2026-0001', locale: 'zh-CN' })), zh, 'explicit zh-CN while the page is English');
  assert.equal(inLocale(EN, () => U.buildMarkdownReport({ view, date, exhibitId: 'MBX-2026-0001' })), en, 'current locale when none is passed');
});

test('app i18n: a real analysis renders an English report skeleton', () => {
  const r = U.normalizeResult(MBX.Engine.analyze('å¤§å®¶å¥½', { locale: EN }), 'å¤§å®¶å¥½');
  const md = U.buildMarkdownReport({ view: U.deriveView(r, 1), engineBest: r.best, locale: EN });
  assert.ok(md.startsWith('# Mojibake Appraisal Report · MBX-2026-'), md.slice(0, 60));
  assert.ok(md.includes('| Appraisal status | Unsolved Mystery (`unknown`; candidate adopted by the visitor) |'), 'adopted candidate is marked, in one pair of parentheses');
  assert.ok(!md.includes('Restored (`restored`'), 'a 1% guess is not a restoration');
  assert.ok(md.includes('_Generated locally in your browser.'), 'footer');
});

test('app i18n: status copy, facts and repair lines in English', () => {
  assert.deepEqual(U.statusCopy({ status: 'restored' }, null, EN).label, 'Restored');
  assert.equal(U.statusCopy({ status: 'clean' }, null, EN).label, 'Authentic');
  assert.equal(U.statusCopy({ status: 'weird' }, null, EN).label, 'Unsolved Mystery');
  const promoted = U.statusCopy({ status: 'unknown', promotedFrom: 1, best: { output: 'x', confidence: 0.01 } }, { output: '大家好' }, EN);
  assert.equal(promoted.headline, 'You adopted a candidate verdict');
  assert.equal(promoted.desc, 'This is an alternative reading with 1% confidence; the chief verdict is still "大家好".');
  assert.equal(U.statusCopy({ status: 'partial', best: { output: `a${FFFD}b` } }, null, EN).label, 'Partially Restored');
  assert.equal(U.languageFact({ status: 'unknown', input: 'Ã¦', best: null }, EN), 'Undetermined');
  assert.equal(U.repairPosition({ index: -1 }, EN), 'Somewhere');
  assert.equal(U.repairPosition({ index: 4 }, EN), 'Character 5');
  assert.equal(U.repairLine({ index: 4, from: '', to: '嗁', reason: 'dropped', step: 0, candidates: ['嗁', '嗎'] }, [{}, {}], EN),
    'Layer 1 (intermediate): "(lost)" → "嗁" · swallowed bytes filled back in; candidates: 嗁, 嗎');
  assert.equal(U.repairLine({ index: 0, from: ' ', to: String.fromCodePoint(0xa0), reason: 'nbsp', step: 0 }, [{}], EN).split(' · ')[1],
    'NBSP had been downgraded to a space; restored');
  assert.equal(U.stepTitle({ kind: 'transcode', trueEncoding: 'utf-8', wrongDecoder: 'gbk' }, EN), 'UTF-8 misread as GBK / GB18030');
  assert.equal(U.stepTitle({ kind: 'unescape', scheme: 'percent', trueEncoding: 'utf-8' }, EN), 'URL percent-encoding (%XX) · bytes read as UTF-8');
  assert.equal(U.chainSentence([{ kind: 'unescape', scheme: 'percent' }, { kind: 'transcode', trueEncoding: 'utf-8', wrongDecoder: 'windows-1252' }], EN),
    'UTF-8 misread as Windows-1252, then written as URL percent-encoding (%XX)');
  assert.equal(U.schemeName('mystery', EN), 'mystery');
  assert.equal(U.schemeName(null, EN), 'escape');
  assert.equal(U.encName(null, EN), 'unknown encoding');
  assert.equal(U.displayChar(' ', EN).title, 'Space U+0020');
  assert.equal(U.displayChar(String.fromCodePoint(0x81), EN).title, 'C1 control U+0081 (usually invisible, and easily lost in copy-paste)');
  assert.equal(U.inlineCode('', EN), '(empty)');
  assert.deepEqual(U.groupSignals([{ match: 'x' }], EN).map((g) => g.hint), ['Mojibake trait']);
});

test('app i18n: dig log, relative times and English plurals', () => {
  const lines = U.digLines('%E5 锟', EN);
  assert.equal(lines[0], 'Brushing away the topsoil…');
  assert.equal(lines[1], 'Measuring the stratum: 5 characters');
  assert.ok(lines.includes('Breaking the clay seal on an escape layer…') && lines.includes('Suspicious inscription spotted: a famous relic, perhaps…'));
  assert.equal(U.digLines('a', EN)[1], 'Measuring the stratum: 1 character');
  assert.ok(!lines.some((l) => HAN.test(l)), 'no Chinese in the English dig log');
  const now = Date.UTC(2026, 5, 1);
  assert.deepEqual([0, 61e3, 5 * 60e3, 3600e3, 3 * 3600e3, 86400e3, 2 * 86400e3].map((d) => U.relativeTime(now - d, now, EN)),
    ['just now', '1 minute ago', '5 minutes ago', '1 hour ago', '3 hours ago', '1 day ago', '2 days ago']);
  assert.equal(U.relativeTime(now - 5 * 60e3, now), '5 分钟前', 'Chinese by default');
});

test('app i18n: AI failure notices in English are one clean sentence', () => {
  const refusal = llmError('refusal', 'The AI docent politely declined this exhibit (the model ended with a refusal), so the built-in docent has taken over the tour.');
  assert.equal(U.aiErrorMessage(refusal, EN),
    'The AI docent politely declined this exhibit (the model ended with a refusal). The built-in docent is back on duty.');
  const net = llmError('network', 'Could not reach http://localhost:11434/v1 (a network problem, or set OLLAMA_ORIGINS=*.).');
  assert.equal(U.aiErrorMessage(net, EN), 'Could not reach http://localhost:11434/v1 (a network problem, or set OLLAMA_ORIGINS=*). The built-in docent is back on duty.');
  assert.equal(U.aiErrorMessage(llmError('cors', ''), EN),
    'The browser\'s cross-origin rules blocked the request (this endpoint may not allow direct calls from web pages). The built-in docent is back on duty.');
  assert.equal(U.aiErrorMessage(Object.assign(new Error('boom'), { code: 'http', status: 500 }), EN),
    'The AI service returned an error (HTTP 500): boom. The built-in docent is back on duty.');
  assert.equal(U.aiErrorMessage(Object.assign(new Error('x'), { code: 'toString' }), EN), 'The AI docent is unexpectedly absent: x. The built-in docent is back on duty.',
    'an unknown code never reads a prototype property');
  for (const e of [refusal, net]) assert.equal(count(U.aiErrorMessage(e, EN), 'back on duty'), 1);
});

test('app i18n: English speech chunks keep words whole and sentences spaced', () => {
  const text = 'First sentence here. Second one! ' + 'word '.repeat(60) + 'end.';
  const chunks = U.splitForSpeech(text, 60, EN);
  assert.ok(chunks.length > 2, 'split into several utterances');
  for (const c of chunks) {
    assert.ok(c.length <= 60, `chunk within the limit: ${c.length}`);
    assert.ok(!/^\s|\s$/.test(c), 'trimmed');
    assert.ok(!/\bwor$|^d\b/.test(c), `no word cut in half: "${c}"`);
  }
  assert.equal(chunks[0], 'First sentence here. Second one!', 'sentences joined with a space');
  assert.deepEqual(U.splitForSpeech('第一句。第二句！', 160), ['第一句。第二句！'], 'Chinese unchanged');
});

test('app i18n: the English audio tour speaks every line, titles and headings included', () => {
  const title = 'UTF-8 · Western European Misreading · Two Strata';
  const spoken = U.splitForSpeech(`${title}\n[Welcome]\nCome in.`, 160, EN).join(' ');
  assert.ok(spoken.includes(title) && spoken.includes('Welcome'), spoken);
  // Lines without final punctuation get a full stop so the voice pauses between them.
  assert.deepEqual(U.splitForSpeech('Title line\nThe exhibit has 2 strata, so we dig from the bottom up:\n· first item\nDone', 160, EN),
    ['Title line. The exhibit has 2 strata, so we dig from the bottom up: · first item. Done.']);
  // Markdown headings of an AI narration survive stripMarkup and are spoken too.
  assert.ok(U.splitForSpeech('### The Verdict\nIt was UTF-8.', 160, EN).join(' ').startsWith('The Verdict. It was UTF-8.'));
  // Decimals, versions and code are not sentence ends.
  assert.deepEqual(U.splitForSpeech('Version 1.5 is out. Run s.encode("cp1252").decode("utf-8") now! Done', 160, EN),
    ['Version 1.5 is out. Run s.encode("cp1252").decode("utf-8") now! Done.']);
  assert.deepEqual(U.splitForSpeech('PHP 5.4 is old.', 160, EN), ['PHP 5.4 is old.']);
  // Nothing narrated is dropped: every word of every English narration reaches the voice.
  const r = MBX.Engine.analyze('Ã¦â€“â€¡Ã§â€°Â©', { locale: EN });
  const words = (s) => (s.match(/[A-Za-z]+/g) || []).length;
  for (const style of ['humor', 'academic', 'snark']) {
    const text = U.narrationPlainText(MBX.Narrator.narrate(r, { style, seed: 1, locale: EN }));
    assert.equal(words(U.splitForSpeech(text, 160, EN).join(' ')), words(text), `${style}: words spoken`);
  }
  // Linear on hostile input.
  const t0 = Date.now();
  U.splitForSpeech('a.'.repeat(10000) + '!?'.repeat(10000), 160, EN);
  assert.ok(Date.now() - t0 < 1000, 'no catastrophic backtracking');
});

test('app i18n: relabelResult rewords an analysis exactly as a fresh one in the other language', () => {
  const extra = ['', 'Hello world', '今天天气很好，我们去公园散步吧。', 'Ã¥Â¤Â§Ã¥Â®Â¶Ã¥Â¥Â½', '%E4%BD%A0%E5%A5%BD', '锟斤拷锟斤拷',
    '屯屯屯', 'ï»¿Hello', '????????', '桴獩愠灰挠湡戠敲歡', '订单状态：å·²å‘è´§，请查收', '�����'];
  const noMs = (r) => JSON.stringify(r, (k, v) => (k === 'ms' ? undefined : v));
  for (const input of MBX.Forge.GALLERY.map((g) => g.relic).concat(extra)) {
    for (const [from, to] of [['zh-CN', EN], [EN, 'zh-CN']]) {
      const a = U.normalizeResult(MBX.Engine.analyze(input, { locale: from }), input);
      const b = U.normalizeResult(MBX.Engine.analyze(input, { locale: to }), input);
      const r = U.relabelResult(a, to);
      assert.ok(r, `relabeled ${from} -> ${to}: ${input}`);
      assert.equal(noMs(r), noMs(b), `${from} -> ${to}: ${input}`);
    }
  }
  const a = MBX.Engine.analyze('å¤§å®¶å¥½', { locale: 'zh-CN' });
  assert.equal(U.relabelResult(a, 'zh-CN'), a, 'same language: the result itself');
  assert.equal(U.relabelResult(Object.assign({}, a, { locale: undefined }), EN), null, 'unknown source language');
  const forged = Object.assign({}, a, { best: Object.assign({}, a.best, { label: 'something else' }) });
  assert.equal(U.relabelResult(forged, EN), null, 'a label the engine would not write: re-analyze instead');
});

test('app: without src/i18n.js, verdict and scheme names fall back to the Chinese tables', () => {
  const saved = MBX.I18n;
  delete MBX.I18n;
  try {
    assert.equal(U.tr('status.restored.label'), App.STATUS_COPY.restored.label);
    assert.equal(U.tr('status.partialClean.desc'), App.PARTIAL_CLEAN_COPY.desc);
    assert.equal(U.tr('scheme.percent'), App.SCHEME_NAMES.percent);
    assert.equal(U.statusCopy({ status: 'irrecoverable' }).label, '不可逆损毁');
    assert.equal(U.currentLocale(), 'zh-CN');
    // Everything else needs the dictionary: the key shows, never a crash (index.html always loads it).
    assert.equal(U.tr('dig.start'), 'dig.start');
    assert.equal(U.tr('status.toString.label'), 'status.toString.label');
  } finally {
    MBX.I18n = saved;
  }
});

test('app i18n: share links never carry ?lang=, preferences remember the language', () => {
  assert.equal(U.buildShareUrl('http://x/a.html?lang=en-US#old', 'å'), 'http://x/a.html#q=%C3%A5');
  assert.equal(U.buildShareUrl('http://x/?a=1&lang=zh-CN&b=2#q=1', 'q'), 'http://x/?a=1&b=2#q=q');
  assert.equal(U.buildShareUrl('http://x/?b=1#old', 'q'), 'http://x/?b=1#q=q', 'other parameters stay');
  assert.equal(U.stripLangParam('http://x/?lang=en#q=%3F'), 'http://x/#q=%3F');
  assert.equal(U.stripLangParam('http://x/?language=en'), 'http://x/?language=en', 'only the lang parameter');
  assert.equal(U.mergePrefs({ lang: 'en' }).lang, EN);
  assert.equal(U.mergePrefs({ lang: 'zh-TW' }).lang, 'zh-CN');
  assert.equal('lang' in U.mergePrefs({ lang: 'fr' }), false, 'unknown languages are dropped');
  assert.equal('lang' in U.mergePrefs(null), false, 'no language until the visitor picks one');
});

test('app i18n: helpers follow the current language when none is passed', () => {
  assert.equal(U.currentLocale(), 'zh-CN');
  inLocale(EN, () => {
    assert.equal(U.currentLocale(), EN);
    assert.equal(U.currentLocale('zh'), 'zh-CN', 'an explicit locale wins');
    assert.equal(U.statusCopy({ status: 'irrecoverable' }).label, 'Irrecoverable');
    assert.equal(U.tr('dig.start'), 'Start Digging');
    assert.deepEqual(U.fallbackStyles().map((s) => s.name), ['Humorous Docent', 'Academic Researcher', 'Snarky Appraiser']);
    assert.ok(U.fallbackGallery().every((g) => !HAN.test(g.title + g.blurb) && g.relic), 'fallback relics are labelled in English');
  });
  assert.equal(U.statusCopy({ status: 'irrecoverable' }).label, '不可逆损毁', 'back to Chinese');
  assert.deepEqual(U.fallbackStyles().map((s) => s.name), ['幽默讲解员', '学术讲解员', '毒舌讲解员']);
});
