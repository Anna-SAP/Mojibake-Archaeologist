'use strict';
// Tests for MBX.LLM (src/llm.js). Every network call goes to a mocked globalThis.fetch whose
// Response bodies are ReadableStreams that split SSE at deliberately awkward byte boundaries.

const { test, assert, loadAll } = require('./harness');
const MBX = loadAll();
const LLM = MBX.LLM;
const I = LLM._internals;

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Splits bytes at the given (sorted, unique) offsets. */
function splitAt(bytes, offsets) {
  const cuts = Array.from(new Set(offsets)).filter((o) => o > 0 && o < bytes.length).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const c of cuts) {
    out.push(bytes.slice(prev, c));
    prev = c;
  }
  out.push(bytes.slice(prev));
  return out;
}

function everyByte(bytes) {
  return Array.from(bytes, (b) => new Uint8Array([b]));
}

/** Response whose body emits `chunks` one per pull, each after a macrotask; `hang` never closes. */
function streamResponse(chunks, opts) {
  const o = opts || {};
  let i = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      // setImmediate (not setTimeout, ~15ms on Windows) keeps 1-byte-chunk streams fast.
      await new Promise((r) => setImmediate(r));
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else if (o.hang) await new Promise(() => {});
      else controller.close();
    },
  });
  return new Response(stream, {
    status: o.status || 200,
    headers: { 'content-type': o.contentType || 'text/event-stream; charset=utf-8' },
  });
}

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

/** Installs a fetch mock for the duration of fn; records every call. */
async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null, headers: lowerHeaders(init && init.headers) });
    return impl(url, init, calls.length - 1);
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function lowerHeaders(h) {
  const out = {};
  if (!h) return out;
  for (const k of Object.keys(h)) out[k.toLowerCase()] = h[k];
  return out;
}

function sseEvent(type, data, eol) {
  const nl = eol || '\n';
  return `event: ${type}${nl}data: ${JSON.stringify(Object.assign({ type }, data))}${nl}${nl}`;
}

/** A realistic Anthropic stream: ping, comment, thinking block (ignored), two text deltas. */
function anthropicStream(texts, opts) {
  const o = opts || {};
  const nl = o.eol || '\n';
  let s = sseEvent('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: o.model || 'claude-opus-5-5', content: [], stop_reason: null } }, nl);
  s += sseEvent('ping', {}, nl);
  s += `: keep-alive comment${nl}${nl}`;
  s += sseEvent('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } }, nl);
  s += sseEvent('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: '秘密思考，不应出现' } }, nl);
  s += sseEvent('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'SIGNATURE' } }, nl);
  s += sseEvent('content_block_stop', { index: 0 }, nl);
  s += sseEvent('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }, nl);
  for (const t of texts) s += sseEvent('content_block_delta', { index: 1, delta: { type: 'text_delta', text: t } }, nl);
  s += sseEvent('content_block_stop', { index: 1 }, nl);
  if (o.stopReason !== null) {
    s += sseEvent('message_delta', { delta: { stop_reason: o.stopReason || 'end_turn', stop_sequence: null }, usage: { output_tokens: 42 } }, nl);
    if (!o.noStop) s += sseEvent('message_stop', {}, nl);
  }
  return s;
}

const TEXTS = ['### 展品来历\n各位观众，这件文物', '的字节 `E5 A4 A7` 讲述了一切。', '\n### 文物保护建议\n统一使用 UTF-8。'];
const EXPECTED = TEXTS.join('');

const ANTHROPIC_CFG = { provider: 'anthropic', apiKey: 'sk-ant-test-0123456789abcdefXYZ', model: 'claude-opus-5-5', effort: 'medium' };

function makeSegs(chars, widths) {
  let pos = 0;
  return chars.map((ch, i) => {
    const seg = { ch, start: pos, end: pos + widths[i] };
    pos += widths[i];
    return seg;
  });
}

/** Hand-built AnalysisResult per docs §6: 'å¤§å®¶å¥½' = UTF-8 bytes read as Windows-1252. */
function fixtureResult(input) {
  const bytes = new Uint8Array([0xe5, 0xa4, 0xa7, 0xe5, 0xae, 0xb6, 0xe5, 0xa5, 0xbd]);
  const before = 'å¤§å®¶å¥½';
  const after = '大家好';
  const step = {
    kind: 'transcode',
    wrongDecoder: 'windows-1252',
    trueEncoding: 'utf-8',
    scheme: null,
    before,
    after,
    bytes,
    segmentsBefore: makeSegs(Array.from(before), [1, 1, 1, 1, 1, 1, 1, 1, 1]),
    segmentsAfter: makeSegs(Array.from(after), [3, 3, 3]),
    repairs: [],
    lossy: false,
    scoreBefore: -8.2,
    scoreAfter: -1.9,
    prior: 1,
  };
  const best = {
    output: after,
    confidence: 0.9731,
    score: { value: -1.9, total: -5.7, length: 3, lang: 'zh-Hans', script: 'Han', badness: 0, flags: [] },
    steps: [step],
    repairs: [],
    lang: { lang: 'zh-Hans', name: '简体中文', confidence: 0.95 },
    label: 'UTF-8 被误读为 Windows-1252',
  };
  return {
    input: input || before,
    status: 'restored',
    best,
    alternatives: [
      { output: '¤j®a¦n', confidence: 0.01, steps: [], repairs: [], label: 'Big5 被误读为 Windows-1252', lang: { lang: 'zh-Hant', name: '繁体中文', confidence: 0.2 } },
    ],
    signatures: [],
    signals: [{ type: 'utf8-as-1252', match: 'å¤', index: 0, hint: 'UTF-8 被当成 1252' }],
    inputScore: { value: -8.2, total: -73.8, length: 9, lang: 'latin', script: 'Latin', badness: 3, flags: [] },
    stats: { explored: 42, ms: 12, truncated: false },
  };
}

const FIXTURE_FACTS = {
  pair: { era: [2000, 2015], habitats: ['PHP + MySQL latin1'], tips: ['统一 UTF-8'] },
  sampleBytes: new Uint8Array([0xef, 0xbb, 0xbf]),
};

async function expectLLMError(promise, code) {
  try {
    await promise;
  } catch (err) {
    assert.equal(err && err.name, 'LLMError', `expected LLMError, got ${err && err.stack}`);
    assert.equal(err.code, code, `error code (message: ${err.message})`);
    return err;
  }
  throw new Error(`expected rejection with LLMError(${code})`);
}

// ---------------------------------------------------------------------------
// Anthropic request shape
// ---------------------------------------------------------------------------

test('llm: anthropic request has documented URL, headers and body (no sampling params)', async () => {
  await withFetch(() => streamResponse([enc.encode(anthropicStream(TEXTS))]), async (calls) => {
    const out = await LLM.narrate(fixtureResult(), { style: 'humor', facts: FIXTURE_FACTS, config: ANTHROPIC_CFG });
    assert.equal(out.text, EXPECTED.trim());
    assert.equal(calls.length, 1);
    const c = calls[0];
    assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(c.init.method, 'POST');
    assert.equal(c.headers['content-type'], 'application/json');
    assert.equal(c.headers['x-api-key'], ANTHROPIC_CFG.apiKey);
    assert.equal(c.headers['anthropic-version'], '2023-06-01');
    assert.equal(c.headers['anthropic-dangerous-direct-browser-access'], 'true');
    assert.equal(c.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    const b = c.body;
    assert.equal(b.model, 'claude-opus-5-5');
    assert.equal(b.max_tokens, 16000);
    assert.equal(b.stream, true);
    assert.equal(typeof b.system, 'string');
    assert.equal(b.messages.length, 1);
    assert.equal(b.messages[0].role, 'user');
    assert.equal(typeof b.messages[0].content, 'string');
    assert.deepEqual(b.output_config, { effort: 'medium' });
    assert.equal(b.fallbacks, 'default');
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(k in b), `body must not contain ${k}`);
  });
});

test('llm: server-side fallbacks only for the listed models on the official base URL', () => {
  const cases = [
    ['claude-opus-5-5', '', true],
    ['claude-opus-5', 'https://api.anthropic.com', true],
    ['claude-sonnet-5-5', 'https://api.anthropic.com/', true],
    ['claude-fable-5-1', 'https://api.anthropic.com/v1', true],
    ['claude-haiku-5-5', '', false],
    ['claude-opus-4-8', '', false],
    ['claude-opus-5-5', 'https://my-proxy.example.com', false],
  ];
  for (const [model, baseUrl, expected] of cases) {
    const req = I.buildAnthropicRequest(LLM.resolveConfig({ provider: 'anthropic', apiKey: 'k', model, baseUrl }), 'sys', 'user');
    const body = JSON.parse(req.init.body);
    assert.equal(body.fallbacks === 'default', expected, `fallbacks body for ${model} @ ${baseUrl || 'default'}`);
    assert.equal(req.init.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01', expected, `beta header for ${model} @ ${baseUrl || 'default'}`);
    if (!expected) assert.ok(!('anthropic-beta' in req.init.headers), 'no beta header at all');
  }
  // Plain http is not the official API (and with a key it is refused outright, see below).
  assert.equal(I.usesServerFallback('claude-opus-5-5', 'http://api.anthropic.com'), false);
});

test('llm: base URL normalisation and effort handling', () => {
  assert.equal(I.anthropicUrl(''), 'https://api.anthropic.com/v1/messages');
  assert.equal(I.anthropicUrl('https://api.anthropic.com/v1/'), 'https://api.anthropic.com/v1/messages');
  assert.equal(I.anthropicUrl('https://gw.example.com/anthropic//'), 'https://gw.example.com/anthropic/v1/messages');
  assert.equal(I.openaiUrl('https://api.deepseek.com/'), 'https://api.deepseek.com/chat/completions');
  assert.equal(I.openaiUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1/chat/completions');
  assert.equal(I.openaiUrl('localhost:11434/v1'), 'http://localhost:11434/v1/chat/completions');
  assert.equal(I.openaiUrl('https://x.example.com/v1/chat/completions'), 'https://x.example.com/v1/chat/completions');

  const high = JSON.parse(I.buildAnthropicRequest(LLM.resolveConfig({ provider: 'anthropic', apiKey: 'k', effort: 'high' }), 's', 'u').init.body);
  assert.deepEqual(high.output_config, { effort: 'high' });
  assert.equal(high.model, 'claude-opus-5-5', 'default model');
  const bogus = JSON.parse(I.buildAnthropicRequest(LLM.resolveConfig({ provider: 'anthropic', apiKey: 'k', effort: 'turbo' }), 's', 'u').init.body);
  assert.deepEqual(bogus.output_config, { effort: 'medium' }, 'unknown effort falls back to medium');
  // A free-text legacy model that rejects effort does not get it.
  const legacy = JSON.parse(I.buildAnthropicRequest(LLM.resolveConfig({ provider: 'anthropic', apiKey: 'k', model: 'claude-haiku-4-5' }), 's', 'u').init.body);
  assert.ok(!('output_config' in legacy));
  assert.ok(I.supportsEffort('claude-haiku-5-5') && I.supportsEffort('claude-opus-4-6') && !I.supportsEffort('claude-3-5-sonnet-latest'));
});

// ---------------------------------------------------------------------------
// SSE streaming
// ---------------------------------------------------------------------------

test('llm: SSE split mid-UTF-8 character and between CR and LF still yields exact text', async () => {
  const raw = anthropicStream(TEXTS, { eol: '\r\n' });
  const bytes = enc.encode(raw);
  // Byte offset inside the 3-byte character '观' and right between a '\r' and its '\n'.
  const zhAt = enc.encode(raw.slice(0, raw.indexOf('观'))).length;
  const crAt = enc.encode(raw.slice(0, raw.indexOf('\r\n', raw.indexOf('text_delta')))).length;
  const chunks = splitAt(bytes, [zhAt + 1, zhAt + 2, crAt + 1, 7, 100, 101, bytes.length - 3]);
  assert.ok(chunks.some((c) => c[c.length - 1] === 0x0d), 'a chunk ends with a bare CR');

  const deltas = [];
  await withFetch(() => streamResponse(chunks), async () => {
    const out = await LLM.narrate(fixtureResult(), {
      facts: null,
      config: ANTHROPIC_CFG,
      onText: (delta, full) => deltas.push([delta, full]),
    });
    assert.equal(out.text, EXPECTED.trim());
    assert.equal(out.stopReason, 'end_turn');
    assert.equal(out.provider, 'anthropic');
    assert.equal(out.model, 'claude-opus-5-5');
  });
  assert.deepEqual(deltas.map((d) => d[0]), TEXTS, 'one onText call per text_delta, thinking ignored');
  assert.equal(deltas[deltas.length - 1][1], EXPECTED, 'full text accumulates');
  assert.ok(!deltas.some((d) => d[1].includes('秘密') || d[1].includes('SIGNATURE')));
});

test('llm: one-byte chunks, LF endings, multi-line data and comments', async () => {
  // A data payload split over two `data:` lines is joined with "\n" (valid JSON whitespace).
  let raw = anthropicStream(['甲'], { stopReason: null });
  raw += 'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,\ndata: "delta":{"type":"text_delta","text":"乙丙"}}\n\n';
  raw += ':ping\n\n';
  raw += sseEvent('message_delta', { delta: { stop_reason: 'end_turn' } }) + sseEvent('message_stop', {});
  await withFetch(() => streamResponse(everyByte(enc.encode(raw))), async () => {
    const out = await LLM.narrate(fixtureResult(), { facts: null, config: ANTHROPIC_CFG });
    assert.equal(out.text, '甲乙丙');
  });
});

test('llm: SSE parser unit — CR-only endings, missing space after colon, unterminated tail', () => {
  const events = [];
  const p = I.createSSEParser((e) => events.push(e));
  p.push('event:a\rdata:1\r\r');
  p.push('data: x\r');
  p.push('\ndata: y\r\n');
  p.push('\r\n: comment\n\ndata: tail');
  p.end();
  assert.deepEqual(events, [
    { event: 'a', data: '1' },
    { event: 'message', data: 'x\ny' },
    { event: 'message', data: 'tail' },
  ]);
});

test('llm: server-side fallback block updates the served model', async () => {
  let raw = sseEvent('message_start', { message: { model: 'claude-opus-5-5', content: [] } });
  raw += sseEvent('content_block_start', { index: 0, content_block: { type: 'text', text: '前半' } });
  raw += sseEvent('content_block_start', { index: 1, content_block: { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } } });
  raw += sseEvent('content_block_delta', { index: 2, delta: { type: 'text_delta', text: '后半' } });
  raw += sseEvent('message_delta', { delta: { stop_reason: 'end_turn' } }) + sseEvent('message_stop', {});
  const phases = [];
  await withFetch(() => streamResponse([enc.encode(raw)]), async () => {
    const out = await LLM.narrate(fixtureResult(), { facts: null, config: ANTHROPIC_CFG, onStatus: (p) => phases.push(p) });
    assert.equal(out.text, '前半后半');
    assert.equal(out.model, 'claude-opus-5');
    assert.equal(out.requestedModel, 'claude-opus-5-5');
  });
  assert.ok(phases.includes('connecting') && phases.includes('writing') && phases.includes('fallback'));
});

test('llm: refusal stop_reason throws LLMError refusal and discards partial text', async () => {
  const raw = anthropicStream(['这段文字不应', '被当成完整讲解'], { stopReason: 'refusal' });
  let seen = '';
  await withFetch(() => streamResponse(splitAt(enc.encode(raw), [50, 333])), async () => {
    const err = await expectLLMError(
      LLM.narrate(fixtureResult(), { facts: null, config: ANTHROPIC_CFG, onText: (d, full) => { seen = full; } }),
      'refusal',
    );
    assert.ok(/婉拒|拒/.test(err.message));
    assert.equal(err.partialText, undefined, 'no partial text attached');
  });
  assert.ok(seen.length > 0, 'deltas were streamed before the refusal');
});

test('llm: SSE error events map to overloaded / rate_limit / auth / http', async () => {
  const cases = [
    ['overloaded_error', 'overloaded'],
    ['rate_limit_error', 'rate_limit'],
    ['authentication_error', 'auth'],
    ['api_error', 'http'],
  ];
  for (const [type, code] of cases) {
    let raw = anthropicStream(['半句'], { stopReason: null });
    raw += sseEvent('error', { error: { type, message: `upstream says ${type}` } });
    await withFetch(() => streamResponse([enc.encode(raw)]), async () => {
      const err = await expectLLMError(LLM.narrate(fixtureResult(), { facts: null, config: ANTHROPIC_CFG }), code);
      assert.ok(err.message.includes(`upstream says ${type}`), err.message);
    });
  }
});

test('llm: stream that ends without a stop marker is a network error carrying the partial', async () => {
  const raw = anthropicStream(['半截'], { stopReason: null });
  await withFetch(() => streamResponse([enc.encode(raw)]), async () => {
    const err = await expectLLMError(LLM.narrate(fixtureResult(), { facts: null, config: ANTHROPIC_CFG }), 'network');
    assert.equal(err.partialText, '半截');
  });
  await withFetch(() => streamResponse([]), async () => {
    await expectLLMError(LLM.narrate(fixtureResult(), { facts: null, config: ANTHROPIC_CFG }), 'bad_response');
  });
});

test('llm: non-streaming JSON answer from a gateway is still accepted', async () => {
  const body = { type: 'message', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '整段讲解' }], stop_reason: 'end_turn' };
  await withFetch(() => jsonResponse(200, body), async () => {
    const out = await LLM.narrate(fixtureResult(), { facts: null, config: ANTHROPIC_CFG });
    assert.equal(out.text, '整段讲解');
    assert.equal(out.stopReason, 'end_turn');
  });
});

// ---------------------------------------------------------------------------
// HTTP / network / abort errors
// ---------------------------------------------------------------------------

test('llm: HTTP 401/403/429/529/400/500 map to codes with the server message', async () => {
  const cases = [
    [401, 'authentication_error', 'invalid x-api-key', 'auth'],
    [403, 'permission_error', 'no access to model', 'auth'],
    [429, 'rate_limit_error', 'Number of requests has exceeded your rate limit', 'rate_limit'],
    [529, 'overloaded_error', 'Overloaded', 'overloaded'],
    [400, 'invalid_request_error', 'messages: field required', 'http'],
    [500, 'api_error', 'Internal server error', 'http'],
  ];
  for (const [status, type, message, code] of cases) {
    await withFetch(() => jsonResponse(status, { type: 'error', error: { type, message } }), async () => {
      const err = await expectLLMError(LLM.narrate(fixtureResult(), { facts: null, config: ANTHROPIC_CFG }), code);
      assert.equal(err.status, status);
      assert.ok(err.message.includes(message), `message for ${status}: ${err.message}`);
      assert.ok(err.message.includes(String(status)));
    });
  }
});

test('llm: API key never leaks into error messages', async () => {
  const key = ANTHROPIC_CFG.apiKey;
  await withFetch(() => jsonResponse(401, { error: { type: 'authentication_error', message: `bad key ${key}` } }), async () => {
    const err = await expectLLMError(LLM.narrate(fixtureResult(), { facts: null, config: ANTHROPIC_CFG }), 'auth');
    assert.ok(!err.message.includes(key), err.message);
    assert.ok(!err.message.includes('0123456789abcdef'), err.message);
  });
  await withFetch(() => new Response('<html>bad gateway</html>', { status: 502 }), async () => {
    const err = await expectLLMError(LLM.narrate(fixtureResult(), { facts: null, config: ANTHROPIC_CFG }), 'http');
    assert.ok(!err.message.includes('<html>'), 'HTML error pages are not echoed');
  });
});

test('llm: fetch TypeError maps to network with a CORS/offline/proxy hint', async () => {
  await withFetch(() => Promise.reject(new TypeError('Failed to fetch')), async () => {
    const err = await expectLLMError(LLM.narrate(fixtureResult(), { facts: null, config: ANTHROPIC_CFG }), 'network');
    assert.ok(err.message.includes('CORS'), err.message);
    assert.ok(err.message.includes('离线') && err.message.includes('代理'), err.message);
    assert.ok(err.message.includes('api.anthropic.com'), err.message);
  });
});

test('llm: abort before the request and in the middle of the stream', async () => {
  const pre = new AbortController();
  pre.abort();
  await withFetch(() => streamResponse([enc.encode(anthropicStream(TEXTS))]), async (calls) => {
    await expectLLMError(LLM.narrate(fixtureResult(), { facts: null, config: ANTHROPIC_CFG, signal: pre.signal }), 'aborted');
    assert.equal(calls.length, 0, 'no request after an early abort');
  });

  // The mock body ignores the signal and never closes; the abort must still settle the promise.
  const ctrl = new AbortController();
  const raw = anthropicStream(['第一句', '第二句'], { stopReason: null });
  await withFetch(() => streamResponse(splitAt(enc.encode(raw), [200]), { hang: true }), async () => {
    const err = await expectLLMError(
      LLM.narrate(fixtureResult(), { facts: null, config: ANTHROPIC_CFG, signal: ctrl.signal, onText: () => ctrl.abort() }),
      'aborted',
    );
    assert.ok(err.message.includes('取消'));
  });

  // fetch itself rejecting with AbortError (what browsers do).
  const ctrl2 = new AbortController();
  await withFetch((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    setTimeout(() => ctrl2.abort(), 0);
  }), async () => {
    await expectLLMError(LLM.narrate(fixtureResult(), { facts: null, config: ANTHROPIC_CFG, signal: ctrl2.signal }), 'aborted');
  });
});

test('llm: narrate without a usable config throws LLMError config', async () => {
  await withFetch(() => { throw new Error('must not be called'); }, async (calls) => {
    await expectLLMError(LLM.narrate(fixtureResult(), { config: { provider: 'none' } }), 'config');
    await expectLLMError(LLM.narrate(fixtureResult(), { config: { provider: 'anthropic', apiKey: '' } }), 'config');
    await expectLLMError(LLM.narrate(fixtureResult(), { config: { provider: 'openai', model: 'x' } }), 'config');
    await expectLLMError(LLM.narrate(fixtureResult(), { config: { provider: 'nope', apiKey: 'k' } }), 'config');
    assert.equal(calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// OpenAI-compatible provider
// ---------------------------------------------------------------------------

function openaiChunk(delta, finish) {
  return `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', model: 'deepseek-chat', choices: [{ index: 0, delta, finish_reason: finish || null }] })}\n\n`;
}

test('llm: OpenAI-compatible endpoint request and streaming parse', async () => {
  let raw = ': keep-alive\n\n';
  raw += openaiChunk({ role: 'assistant', content: '' });
  raw += openaiChunk({ reasoning_content: '内部推理' });
  raw += openaiChunk({ content: '### 鉴定\n这是' });
  raw += openaiChunk({ content: null });
  raw += openaiChunk({ content: '一件 UTF-8 文物。' }, 'stop');
  raw += 'data: {"id":"c1","choices":[],"usage":{"total_tokens":9}}\n\n';
  raw += 'data: [DONE]\n\n';
  raw += openaiChunk({ content: '（DONE 之后的内容被忽略）' });
  const cfg = { provider: 'openai', apiKey: 'sk-deepseek-123', baseUrl: 'https://api.deepseek.com/', model: 'deepseek-chat' };
  await withFetch(() => streamResponse(everyByte(enc.encode(raw))), async (calls) => {
    const out = await LLM.narrate(fixtureResult(), { facts: null, style: 'academic', config: cfg });
    assert.equal(out.text, '### 鉴定\n这是一件 UTF-8 文物。');
    assert.equal(out.provider, 'openai');
    assert.equal(out.stopReason, 'stop');
    const c = calls[0];
    assert.equal(c.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(c.headers.authorization, 'Bearer sk-deepseek-123');
    assert.equal(c.headers['content-type'], 'application/json');
    assert.equal(c.body.model, 'deepseek-chat');
    assert.equal(c.body.stream, true);
    assert.equal(c.body.temperature, 0.9);
    assert.deepEqual(c.body.messages.map((m) => m.role), ['system', 'user']);
    assert.ok(c.body.messages[0].content.includes('学术'), 'system prompt carries the style');
    assert.ok(!('x-api-key' in c.headers));
  });
});

test('llm: OpenAI-compatible local endpoint without key, errors and content filter', async () => {
  const cfg = { provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' };
  assert.ok(LLM.isReady(cfg), 'key is optional for OpenAI-compatible endpoints');
  await withFetch(() => streamResponse([enc.encode(openaiChunk({ content: '本地' }) + 'data: [DONE]\n\n')]), async (calls) => {
    const out = await LLM.narrate(fixtureResult(), { facts: null, config: cfg });
    assert.equal(out.text, '本地');
    assert.equal(calls[0].url, 'http://localhost:11434/v1/chat/completions');
    assert.ok(!('authorization' in calls[0].headers), 'no Authorization header without a key');
  });
  await withFetch(() => jsonResponse(401, { error: { message: 'Authentication Fails (no such user)', type: 'authentication_error' } }), async () => {
    const err = await expectLLMError(LLM.narrate(fixtureResult(), { facts: null, config: cfg }), 'auth');
    assert.ok(err.message.includes('Authentication Fails'));
  });
  await withFetch(() => Promise.reject(new TypeError('Failed to fetch')), async () => {
    const err = await expectLLMError(LLM.narrate(fixtureResult(), { facts: null, config: cfg }), 'network');
    assert.ok(err.message.includes('OLLAMA_ORIGINS'), 'local endpoints get the Ollama CORS hint');
  });
  await withFetch(() => streamResponse([enc.encode(openaiChunk({ content: '部分' }, 'content_filter'))]), async () => {
    await expectLLMError(LLM.narrate(fixtureResult(), { facts: null, config: cfg }), 'refusal');
  });
  await withFetch(() => streamResponse([enc.encode('data: {"error":{"message":"model not found","type":"invalid_request_error"}}\n\n')]), async () => {
    const err = await expectLLMError(LLM.narrate(fixtureResult(), { facts: null, config: cfg }), 'http');
    assert.ok(err.message.includes('model not found'));
  });
});

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

test('llm: registerProvider plugs a custom provider into narrate/listProviders/isReady', async () => {
  let received = null;
  LLM.registerProvider('test-echo', {
    name: '测试回声',
    defaultModel: 'echo-1',
    run: async (args) => {
      received = args;
      args.onText('回声');
      args.onText('讲解');
      return '回声讲解';
    },
  });
  const listed = LLM.listProviders();
  assert.equal(listed[0].id, 'none');
  assert.ok(listed.some((p) => p.id === 'anthropic' && p.needsKey && p.defaultModel === 'claude-opus-5-5' && p.models.includes('claude-fable-5-1')));
  assert.ok(listed.some((p) => p.id === 'openai' && !p.needsKey));
  const mine = listed.find((p) => p.id === 'test-echo');
  assert.ok(mine && mine.name === '测试回声' && mine.defaultModel === 'echo-1' && mine.needsKey === false);
  assert.ok(LLM.PROVIDERS['test-echo'], 'custom provider exposed in PROVIDERS');
  assert.ok(LLM.isReady({ provider: 'test-echo' }));

  const fulls = [];
  const out = await LLM.narrate(fixtureResult(), { facts: null, config: { provider: 'test-echo' }, onText: (d, full) => fulls.push(full) });
  assert.equal(out.text, '回声讲解');
  assert.equal(out.provider, 'test-echo');
  assert.equal(out.model, 'echo-1');
  assert.deepEqual(fulls, ['回声', '回声讲解'], 'delta-only callbacks are accumulated');
  assert.ok(received.system.includes('文物保护建议') && received.user.includes('E5 A4 A7'));
  assert.equal(received.config.provider, 'test-echo');

  const test1 = await LLM.testConnection({ provider: 'test-echo' });
  assert.equal(test1.ok, true);

  LLM.registerProvider('test-broken', { run: async () => { throw new TypeError('Failed to fetch'); } });
  await expectLLMError(LLM.narrate(fixtureResult(), { facts: null, config: { provider: 'test-broken' } }), 'network');
  assert.throws(() => LLM.registerProvider('none', { run: () => '' }));
  assert.throws(() => LLM.registerProvider('bad id!', { run: () => '' }));
  assert.throws(() => LLM.registerProvider('no-run', {}));
});

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function withStorage(local, session, fn) {
  const saved = {};
  for (const [name, value] of [['localStorage', local], ['sessionStorage', session]]) {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, typeof value === 'function'
      ? { configurable: true, get: value }
      : { configurable: true, writable: true, value });
  }
  try {
    return fn();
  } finally {
    LLM.clearConfig();
    for (const name of ['localStorage', 'sessionStorage']) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
      else delete globalThis[name];
    }
  }
}

test('llm: config defaults, remember=true persists the key in localStorage', () => {
  const ls = fakeStorage();
  const ss = fakeStorage();
  withStorage(ls, ss, () => {
    LLM.clearConfig();
    const def = LLM.loadConfig();
    assert.equal(def.provider, 'none');
    assert.equal(def.effort, 'medium');
    assert.equal(LLM.isReady(), false);

    LLM.saveConfig({ provider: 'anthropic', apiKey: ' sk-ant-remember ', model: 'claude-sonnet-5-5', effort: 'low', remember: true });
    const stored = JSON.parse(ls.map.get('mbx.llm'));
    // The key is stored bound to its provider, never as a provider-less `apiKey`.
    assert.deepEqual(stored.apiKeys, { anthropic: 'sk-ant-remember' });
    assert.ok(!('apiKey' in stored));
    assert.equal(ss.map.size, 0);
    const loaded = LLM.loadConfig();
    assert.equal(loaded.apiKey, 'sk-ant-remember');
    assert.equal(loaded.model, 'claude-sonnet-5-5');
    assert.equal(loaded.effort, 'low');
    assert.equal(loaded.remember, true);
    assert.equal(LLM.isReady(), true);
  });
});

test('llm: remember=false keeps the key only in sessionStorage; clearConfig wipes both', () => {
  const ls = fakeStorage();
  const ss = fakeStorage();
  withStorage(ls, ss, () => {
    LLM.saveConfig({ provider: 'anthropic', apiKey: 'sk-ant-session', remember: false });
    const stored = JSON.parse(ls.map.get('mbx.llm'));
    assert.ok(!('apiKey' in stored), 'no key in localStorage');
    assert.equal(stored.provider, 'anthropic');
    assert.ok([...ss.map.values()].includes('sk-ant-session'), 'key in sessionStorage');
    assert.equal(LLM.loadConfig().apiKey, 'sk-ant-session');

    // Switching to remember=true moves the key and drops the session copy, and vice versa.
    LLM.saveConfig({ provider: 'anthropic', apiKey: 'sk-ant-session', remember: true });
    assert.equal(ss.map.size, 0);
    LLM.saveConfig({ provider: 'anthropic', apiKey: 'sk-ant-session', remember: false });
    assert.ok(!('apiKey' in JSON.parse(ls.map.get('mbx.llm'))));

    LLM.clearConfig();
    assert.equal(ls.map.size, 0);
    assert.equal(ss.map.size, 0);
    assert.equal(LLM.loadConfig().provider, 'none');
  });

  // A new tab: localStorage survives, sessionStorage does not -> key gone, config otherwise kept.
  const ls2 = fakeStorage();
  ls2.setItem('mbx.llm', JSON.stringify({ provider: 'anthropic', model: 'claude-haiku-5-5', remember: false }));
  withStorage(ls2, fakeStorage(), () => {
    const c = LLM.loadConfig();
    assert.equal(c.apiKey, '');
    assert.equal(c.model, 'claude-haiku-5-5');
    assert.equal(LLM.isReady(c), false);
  });

  // Corrupted JSON falls back to defaults.
  const ls3 = fakeStorage();
  ls3.setItem('mbx.llm', '{not json');
  withStorage(ls3, fakeStorage(), () => assert.equal(LLM.loadConfig().provider, 'none'));
});

test('llm: throwing or missing storage never breaks config handling', () => {
  const boom = () => { throw new Error('SecurityError: storage disabled'); };
  withStorage(boom, boom, () => {
    assert.equal(LLM.loadConfig().provider, 'none');
    LLM.saveConfig({ provider: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'k1', remember: false });
    const c = LLM.loadConfig();
    assert.equal(c.provider, 'openai', 'in-memory fallback for this page session');
    assert.equal(c.apiKey, 'k1');
    LLM.clearConfig();
    assert.equal(LLM.loadConfig().provider, 'none');
  });
  const throwingMethods = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => { throw new Error('denied'); },
  };
  withStorage(throwingMethods, throwingMethods, () => {
    LLM.saveConfig({ provider: 'anthropic', apiKey: 'k2', remember: true });
    assert.equal(LLM.loadConfig().apiKey, 'k2');
  });
  withStorage(undefined, undefined, () => {
    LLM.saveConfig({ provider: 'anthropic', apiKey: 'k3' });
    assert.equal(LLM.loadConfig().apiKey, 'k3');
  });
});

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

test('llm: buildPrompt system prompt encodes persona and hard rules per style', () => {
  const r = fixtureResult();
  const humor = LLM.buildPrompt(r, null, FIXTURE_FACTS, 'humor').system;
  const academic = LLM.buildPrompt(r, null, FIXTURE_FACTS, 'academic').system;
  const snark = LLM.buildPrompt(r, null, FIXTURE_FACTS, 'snark').system;
  assert.ok(humor.includes('幽默') && academic.includes('学术') && snark.includes('毒舌'));
  assert.notEqual(humor, academic);
  assert.equal(LLM.buildPrompt(r, null, null, 'unknown-style').system, humor, 'unknown style -> humor');
  for (const s of [humor, academic, snark]) {
    assert.ok(s.includes('350') && s.includes('700'), 'length rule');
    assert.ok(s.includes('###'), 'subheading rule');
    assert.ok(s.includes('文物保护建议'), 'conservation advice rule');
    assert.ok(s.includes('简体中文'));
    assert.ok(s.includes('不得编造'), 'grounding rule');
    assert.ok(s.includes('十六进制'), 'hex quoting rule');
    assert.ok(s.includes('前言'), 'no-preamble rule');
  }
});

test('llm: buildPrompt user JSON carries chain, hex mappings, facts and template metadata', () => {
  const narration = { exhibitId: 'MBX-2026-0A3F', title: '『UTF-8 · 西欧误读型』', subtitle: '单层地层', era: { label: '约 2005–2015 年', reason: 'x' }, site: '某台 LAMP 服务器', tags: ['UTF-8', 'Windows-1252'], sections: [], plainText: '很长的模板讲解'.repeat(100) };
  const { user } = LLM.buildPrompt(fixtureResult(), narration, FIXTURE_FACTS, 'snark');
  const j = JSON.parse(user);
  assert.equal(j.status, 'restored');
  assert.equal(j.chain, 'UTF-8 被误读为 Windows-1252');
  assert.equal(j.input, 'å¤§å®¶å¥½');
  assert.equal(j.output, '大家好');
  assert.equal(j.confidence, 0.973);
  assert.equal(j.style, 'snark');
  assert.equal(j.language.name, '简体中文');
  assert.equal(j.steps.length, 1);
  const s = j.steps[0];
  assert.equal(s.kind, 'transcode');
  assert.equal(s.wrongDecoder, 'windows-1252');
  assert.equal(s.trueEncoding, 'utf-8');
  assert.deepEqual(s.afterMap[0], ['大', 'E5 A4 A7']);
  assert.deepEqual(s.beforeMap.slice(0, 3), [['å', 'E5'], ['¤', 'A4'], ['§', 'A7']]);
  assert.ok(j.history[0].includes('windows-1252') || j.history[0].includes('Windows-1252'));
  assert.ok(user.includes('E5 A4 A7'));
  assert.equal(j.facts.sampleBytes, 'EF BB BF', 'Uint8Array in facts becomes hex');
  assert.deepEqual(j.facts.pair.era, [2000, 2015]);
  assert.equal(j.exhibit.id, 'MBX-2026-0A3F');
  assert.equal(j.exhibit.era, '约 2005–2015 年');
  assert.ok(!user.includes('很长的模板讲解很长'), 'template body text is not shipped');
  // A 1 % alternative next to a restored verdict is noise and is left out ...
  assert.ok(!('alternatives' in j), 'near-zero alternatives of a restored result are omitted');
  assert.ok(!/"bytes":\{/.test(user), 'no raw Uint8Array serialisation');
  // ... but kept when the verdict is not 'restored' or the alternative is a real contender.
  const partial = fixtureResult();
  partial.status = 'partial';
  assert.equal(JSON.parse(LLM.buildPrompt(partial, narration, FIXTURE_FACTS, 'snark').user).alternatives[0].label, 'Big5 被误读为 Windows-1252');
  const strong = fixtureResult();
  strong.alternatives[0].confidence = 0.2;
  assert.equal(JSON.parse(LLM.buildPrompt(strong, narration, FIXTURE_FACTS, 'snark').user).alternatives[0].confidence, 0.2);
});

test('llm: buildPrompt stays under the size budget for 10k-char inputs and huge analyses', () => {
  const r = fixtureResult();
  const longIn = 'å¤§å®¶å¥½'.repeat(1200); // 10.8k code points
  const longOut = '大家好'.repeat(1200);
  r.input = longIn;
  r.best.output = longOut;
  const step = r.best.steps[0];
  step.before = longIn;
  step.after = longOut;
  step.bytes = new Uint8Array(10800).fill(0xe5);
  step.segmentsBefore = makeSegs(Array.from(longIn), new Array(longIn.length).fill(1));
  step.segmentsAfter = makeSegs(Array.from(longOut), new Array(longOut.length).fill(3));
  step.repairs = Array.from({ length: 500 }, (_, i) => ({ index: i, from: '�', to: '大', candidates: ['大', '太', '犬', '天'], reason: 'gap' }));
  r.best.repairs = step.repairs;
  r.best.steps = [step, Object.assign({}, step, { kind: 'unescape', scheme: 'percent' }), step, step];
  r.signals = Array.from({ length: 300 }, (_, i) => ({ type: 'utf8-as-1252', match: 'Ã©'.repeat(50), index: i, hint: '提示'.repeat(100) }));
  r.alternatives = Array.from({ length: 5 }, () => ({ output: longOut, confidence: 0.1, label: '标签'.repeat(200) }));
  const hugeFacts = { story: '史'.repeat(20000), list: Array.from({ length: 1000 }, (_, i) => ({ i, text: '字'.repeat(500), bytes: new Uint8Array(1000) })) };
  hugeFacts.self = hugeFacts; // cycles must not explode

  const t0 = Date.now();
  const { user } = LLM.buildPrompt(r, null, hugeFacts, 'humor');
  const ms = Date.now() - t0;
  assert.ok(user.length <= I.PROMPT_BUDGET, `user message ${user.length} chars`);
  assert.ok(ms < 500, `buildPrompt took ${ms}ms`);
  const j = JSON.parse(user);
  assert.ok(j.input.length <= 301 && j.input.endsWith('…'), 'input truncated to 300 code points');
  assert.equal(j.inputLength, longIn.length);
  assert.ok(j.steps[0].beforeMap.length <= 12);
  assert.equal(j.chain, 'UTF-8 被误读为 Windows-1252');
  assert.ok(user.includes('E5'), 'still cites bytes');

  // Pathological: control characters inflate JSON escaping; the hard fallback must still fit.
  const ctl = fixtureResult('\u0001'.repeat(10000));
  ctl.best.label = '\u0002'.repeat(10000);
  const tiny = LLM.buildPrompt(ctl, null, null, 'humor').user;
  assert.ok(tiny.length <= I.PROMPT_BUDGET, `fallback payload ${tiny.length}`);
  JSON.parse(tiny);
});

test('llm: buildPrompt handles clean / irrecoverable results without a best hypothesis', () => {
  const clean = { input: 'hello world', status: 'clean', best: null, alternatives: [], signatures: [], signals: [], stats: {} };
  const j = JSON.parse(LLM.buildPrompt(clean, null, null, 'academic').user);
  assert.equal(j.status, 'clean');
  assert.equal(j.input, 'hello world');
  assert.ok(!('steps' in j) && !('chain' in j));

  const kun = { input: '锟斤拷锟斤拷', status: 'irrecoverable', best: null, alternatives: [], signals: [],
    signatures: [{ id: 'kunjinkao', title: '锟斤拷', match: '锟斤拷', index: 0, note: 'EF BF BD 成对被 GBK 解读' }] };
  const k = JSON.parse(LLM.buildPrompt(kun, null, { bytes: new Uint8Array([0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd]) }, 'humor').user);
  assert.equal(k.signatures[0].id, 'kunjinkao');
  assert.equal(k.facts.bytes, 'EF BF BD EF BF BD');
  // No result at all must not throw either.
  JSON.parse(LLM.buildPrompt(null, null, null).user);
});

// ---------------------------------------------------------------------------
// testConnection
// ---------------------------------------------------------------------------

test('llm: testConnection sends a small non-streaming request and reports in Chinese', async () => {
  await withFetch(() => jsonResponse(200, { type: 'message', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'pong' }], stop_reason: 'end_turn' }), async (calls) => {
    const r = await LLM.testConnection(ANTHROPIC_CFG);
    assert.equal(r.ok, true);
    assert.ok(r.message.includes('连接成功') && r.message.includes('claude-opus-5-5'), r.message);
    const b = calls[0].body;
    assert.ok(!b.stream, 'non-streaming');
    assert.ok(b.max_tokens <= 64, 'small max_tokens');
    assert.equal(calls[0].headers['anthropic-dangerous-direct-browser-access'], 'true');
    assert.ok(!('temperature' in b) && !('thinking' in b));
  });
  await withFetch(() => jsonResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), async () => {
    const r = await LLM.testConnection(ANTHROPIC_CFG);
    assert.equal(r.ok, false);
    assert.ok(r.message.includes('鉴权失败') && r.message.includes('invalid x-api-key'), r.message);
  });
  await withFetch(() => jsonResponse(200, { id: 'x', model: 'deepseek-chat', choices: [{ message: { content: 'ok' } }] }), async (calls) => {
    const r = await LLM.testConnection({ provider: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'k' });
    assert.equal(r.ok, true);
    assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
    assert.equal(calls[0].body.stream, false);
  });
  await withFetch(() => Promise.reject(new TypeError('Failed to fetch')), async () => {
    const r = await LLM.testConnection(ANTHROPIC_CFG);
    assert.equal(r.ok, false);
    assert.ok(r.message.includes('CORS'));
  });
  assert.equal((await LLM.testConnection({ provider: 'none' })).ok, false);
  const missing = await LLM.testConnection({ provider: 'anthropic', apiKey: '' });
  assert.equal(missing.ok, false);
  assert.ok(missing.message.includes('API Key'));
});
