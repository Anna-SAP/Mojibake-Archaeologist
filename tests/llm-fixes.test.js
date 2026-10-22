'use strict';
// Regression tests for the LLM review fixes: provider-bound API keys, https-only keys, prompt
// byte maps / repair positions / facts grounding, OpenAI parameter retries, SSE line cost and
// system-prompt wording. Network calls go to a mocked globalThis.fetch.

const { test, assert, loadAll } = require('./harness');
const MBX = loadAll();
const LLM = MBX.LLM;
const I = LLM._internals;

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// Helpers (kept local so this file runs on its own: node tests/run.js llm-fixes)
// ---------------------------------------------------------------------------

function streamResponse(chunks, opts) {
  const o = opts || {};
  let i = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      await new Promise((r) => setImmediate(r));
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
  return new Response(stream, { status: o.status || 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

function lowerHeaders(h) {
  const out = {};
  if (!h) return out;
  for (const k of Object.keys(h)) out[k.toLowerCase()] = h[k];
  return out;
}

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

/** Storage with the full Web Storage surface (length / key) so stored keys can be enumerated. */
function fakeStorage() {
  const map = new Map();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

async function withStorage(local, session, fn) {
  const saved = {};
  for (const [name, value] of [['localStorage', local], ['sessionStorage', session]]) {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  try {
    return await fn();
  } finally {
    LLM.clearConfig();
    for (const name of ['localStorage', 'sessionStorage']) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
      else delete globalThis[name];
    }
  }
}

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

function openaiChunk(delta, finish) {
  return `data: ${JSON.stringify({ id: 'c1', model: 'gpt-x', choices: [{ index: 0, delta, finish_reason: finish || null }] })}\n\n`;
}

const OPENAI_OK = () => streamResponse([enc.encode(openaiChunk({ content: '讲解' }, 'stop') + 'data: [DONE]\n\n')]);

const CLEAN = { input: 'hello', status: 'clean', best: null, alternatives: [], signatures: [], signals: [] };

/** The prompt the app builds: analysis + narration (visitor's seed) + Narrator.factsFor. */
function promptFor(input, seed, facts) {
  const r = MBX.Engine.analyze(input);
  const narration = MBX.Narrator.narrate(r, { style: 'humor', seed: seed || 0 });
  const p = LLM.buildPrompt(r, narration, facts === undefined ? MBX.Narrator.factsFor(r) : facts, 'humor');
  return { r, p, u: JSON.parse(p.user) };
}

// ---------------------------------------------------------------------------
// 1. API keys are bound to the provider they were entered for
// ---------------------------------------------------------------------------

const ANT_KEY = 'sk-ant-api03-provider-bound-0123456789';

test('llm-fixes: a key saved for anthropic never comes back for openai (session storage)', async () => {
  const ls = fakeStorage();
  const ss = fakeStorage();
  await withStorage(ls, ss, async () => {
    LLM.saveConfig({ provider: 'anthropic', apiKey: ANT_KEY, remember: false });
    assert.deepEqual(Array.from(ss.map.keys()), [I.SESSION_KEY_PREFIX + 'anthropic'], 'session entry carries the provider');
    assert.ok(!ss.map.has(I.SESSION_KEY), 'no provider-less legacy entry is written');

    LLM.saveConfig({ provider: 'openai', apiKey: '', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' });
    const c = LLM.loadConfig();
    assert.equal(c.provider, 'openai');
    assert.equal(c.apiKey, '', 'openai gets no key');

    // The settings form still holding the anthropic key when the provider changes.
    const saved = LLM.saveConfig({ provider: 'openai', apiKey: ANT_KEY, baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' });
    assert.equal(saved.apiKey, '', 'saveConfig drops a key owned by another provider');
    assert.equal(LLM.loadConfig().apiKey, '');
    assert.equal(LLM.resolveConfig({ provider: 'openai', apiKey: ANT_KEY, baseUrl: 'http://localhost:11434/v1' }).apiKey, '');

    await withFetch(OPENAI_OK, async (calls) => {
      await LLM.narrate(CLEAN, { facts: null, config: LLM.loadConfig() });
      await LLM.narrate(CLEAN, { facts: null, config: { provider: 'openai', apiKey: ANT_KEY, baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' } });
      await LLM.testConnection({ provider: 'openai', apiKey: ANT_KEY, baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' });
      assert.equal(calls.length, 3);
      for (const call of calls) {
        assert.ok(!('authorization' in call.headers), 'no Authorization header with the anthropic key');
        assert.ok(!JSON.stringify(call).includes(ANT_KEY), 'the anthropic key appears nowhere in the request');
      }
    });

    // The anthropic key stays bound to anthropic while openai is selected ...
    assert.equal(ss.getItem(I.SESSION_KEY_PREFIX + 'anthropic'), ANT_KEY);
    assert.equal(ss.getItem(I.SESSION_KEY_PREFIX + 'openai'), null);
    // ... a key typed for openai stays with openai ...
    LLM.saveConfig({ provider: 'openai', apiKey: 'sk-openai-own-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' });
    assert.equal(LLM.loadConfig().apiKey, 'sk-openai-own-key');
    LLM.saveConfig({ provider: 'anthropic', apiKey: ANT_KEY });
    assert.equal(LLM.loadConfig().apiKey, ANT_KEY);
    assert.equal(ss.getItem(I.SESSION_KEY_PREFIX + 'openai'), 'sk-openai-own-key');
    // ... and saving a provider with an empty key field forgets that provider's key only.
    LLM.saveConfig({ provider: 'anthropic', apiKey: '' });
    assert.equal(LLM.loadConfig().apiKey, '');
    assert.equal(ss.getItem(I.SESSION_KEY_PREFIX + 'openai'), 'sk-openai-own-key');

    LLM.clearConfig();
    assert.equal(ss.map.size, 0, 'clearConfig removes every per-provider key');
    assert.equal(ls.map.size, 0);
  });
});

test('llm-fixes: remembered keys live in an apiKeys map keyed by provider', async () => {
  const ls = fakeStorage();
  const ss = fakeStorage();
  await withStorage(ls, ss, async () => {
    LLM.saveConfig({ provider: 'anthropic', apiKey: ANT_KEY, remember: true });
    LLM.saveConfig({ provider: 'openai', apiKey: ANT_KEY, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', remember: true });
    const stored = JSON.parse(ls.map.get('mbx.llm'));
    assert.deepEqual(stored.apiKeys, { anthropic: ANT_KEY }, 'the anthropic key is not copied to openai');
    assert.ok(!('apiKey' in stored));
    assert.equal(LLM.loadConfig().apiKey, '');
    assert.equal(ss.map.size, 0);
  });
});

test('llm-fixes: the legacy provider-less session key migrates only to the saved provider', async () => {
  const ls = fakeStorage();
  const ss = fakeStorage();
  ls.setItem('mbx.llm', JSON.stringify({ provider: 'anthropic', remember: false }));
  ss.setItem(I.SESSION_KEY, 'sk-legacy-anthropic-key');
  await withStorage(ls, ss, async () => {
    assert.equal(LLM.loadConfig().apiKey, 'sk-legacy-anthropic-key');
    assert.equal(ss.getItem(I.SESSION_KEY_PREFIX + 'anthropic'), 'sk-legacy-anthropic-key', 'migrated to its provider');
    assert.equal(ss.getItem(I.SESSION_KEY), null);
    LLM.saveConfig({ provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'q' });
    assert.equal(LLM.loadConfig().apiKey, '', 'the migrated key does not follow a provider switch');
  });
  // A legacy remembered config ({ provider, apiKey }) keeps working for its own provider only.
  const ls2 = fakeStorage();
  ls2.setItem('mbx.llm', JSON.stringify({ provider: 'anthropic', apiKey: 'sk-legacy-remembered', remember: true }));
  await withStorage(ls2, fakeStorage(), async () => {
    assert.equal(LLM.loadConfig().apiKey, 'sk-legacy-remembered');
    LLM.saveConfig({ provider: 'openai', apiKey: 'sk-legacy-remembered', baseUrl: 'https://api.deepseek.com', model: 'm', remember: true });
    assert.equal(LLM.loadConfig().apiKey, '');
  });
});

// ---------------------------------------------------------------------------
// 2. Keys only travel over https (or to this machine)
// ---------------------------------------------------------------------------

test('llm-fixes: an API key is never sent over plain http to a non-local host', async () => {
  const insecure = [
    { provider: 'anthropic', apiKey: 'sk-ant-k', baseUrl: 'http://api.anthropic.com' },
    { provider: 'anthropic', apiKey: 'sk-ant-k', baseUrl: 'http://my-gateway.example.com' },
    { provider: 'openai', apiKey: 'sk-k', baseUrl: 'http://example.com/v1', model: 'm' },
    { provider: 'openai', apiKey: 'sk-k', baseUrl: 'http://192.168.1.20:11434/v1', model: 'm' },
  ];
  await withFetch(() => { throw new Error('must not be called'); }, async (calls) => {
    for (const cfg of insecure) {
      const err = await expectLLMError(LLM.narrate(CLEAN, { facts: null, config: cfg }), 'config');
      assert.ok(err.message.includes('https://') && err.message.includes(new URL(cfg.baseUrl).host), err.message);
      const t = await LLM.testConnection(cfg);
      assert.equal(t.ok, false);
      assert.equal(t.code, 'config');
    }
    assert.throws(() => I.buildAnthropicRequest(LLM.resolveConfig(insecure[0]), 's', 'u'));
    assert.equal(calls.length, 0, 'no request left the page');
  });

  // Loopback with a key, and any host without a key, are allowed.
  await withFetch(OPENAI_OK, async (calls) => {
    await LLM.narrate(CLEAN, { facts: null, config: { provider: 'openai', apiKey: 'sk-local', baseUrl: 'http://localhost:11434/v1', model: 'm' } });
    assert.equal(calls[0].headers.authorization, 'Bearer sk-local');
    await LLM.narrate(CLEAN, { facts: null, config: { provider: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', model: 'm', apiKey: 'k2' } });
    await LLM.narrate(CLEAN, { facts: null, config: { provider: 'openai', baseUrl: 'http://example.com/v1', model: 'm' } });
    assert.equal(calls[2].url, 'http://example.com/v1/chat/completions');
    assert.ok(!('authorization' in calls[2].headers));
  });
  const ok = I.buildAnthropicRequest(LLM.resolveConfig({ provider: 'anthropic', apiKey: 'k', baseUrl: 'http://localhost:8080' }), 's', 'u');
  assert.equal(ok.url, 'http://localhost:8080/v1/messages');
});

// ---------------------------------------------------------------------------
// 3. Byte maps: escapes as tokens, no pass-through rows
// ---------------------------------------------------------------------------

test('llm-fixes: escape layers map whole escape tokens to their bytes', () => {
  const dump = promptFor('E5 A4 A7 E5 AE B6 E5 A5 BD').u.steps[0];
  assert.equal(dump.kind, 'unescape');
  assert.deepEqual(dump.beforeMap.slice(0, 2), [['E5', 'E5'], ['A4', 'A4']]);
  assert.equal(dump.beforeMap.length, 9, 'one row per byte, separators skipped');
  assert.deepEqual(dump.afterMap[0], ['大', 'E5 A4 A7']);

  const pct = promptFor('%E5%A4%A7%E5%AE%B6%E5%A5%BD').u.steps[0];
  assert.deepEqual(pct.beforeMap[0], ['%E5', 'E5']);
  assert.deepEqual(pct.beforeMap[1], ['%A4', 'A4']);

  const hexEsc = promptFor(String.raw`\xE5\xA4\xA7\xE5\xAE\xB6`).u.steps[0];
  assert.deepEqual(hexEsc.beforeMap[0], ['\\xE5', 'E5']);
});

test('llm-fixes: partial maps start at the first misread character, never with empty hex', () => {
  const { u } = promptFor('欢迎来到 å¤§å®¶å¥½ 的世界，这里是正常文字。');
  const s = u.steps[0];
  assert.deepEqual(s.beforeMap[0], ['å', 'E5']);
  assert.deepEqual(s.afterMap[0], ['大', 'E5 A4 A7']);
  for (const row of s.beforeMap.concat(s.afterMap)) {
    assert.ok(row[1] !== '', `row without bytes: ${JSON.stringify(row)}`);
    assert.ok(row[0] !== 'U+0020', `pass-through space row: ${JSON.stringify(row)}`);
  }
  // Plain transcodes are unchanged.
  assert.deepEqual(promptFor('å¤§å®¶å¥½').u.steps[0].beforeMap.slice(0, 3), [['å', 'E5'], ['¤', 'A4'], ['§', 'A7']]);
  // A byte-less U+FFFD in a lossy relic is labelled as lost data.
  const lossy = promptFor('浣犲ソ锛屼笘鐣�').u.steps[0];
  assert.deepEqual(lossy.beforeMap[lossy.beforeMap.length - 1], ['�', '', '丢失']);
});

test('llm-fixes: Seg.kept rows are skipped even outside partial steps', () => {
  const bytes = new Uint8Array([0x41, 0xe5, 0xa4, 0xa7]);
  const r = {
    input: 'Aå¤§',
    status: 'restored',
    best: {
      output: 'A大', confidence: 0.9, label: 'UTF-8 被误读为 Windows-1252', repairs: [],
      steps: [{
        kind: 'transcode', wrongDecoder: 'windows-1252', trueEncoding: 'utf-8', before: 'Aå¤§', after: 'A大', bytes,
        segmentsBefore: [{ ch: 'A', start: 0, end: 1, kept: true }, { ch: 'å', start: 1, end: 2 }, { ch: '¤', start: 2, end: 3 }, { ch: '§', start: 3, end: 4 }],
        segmentsAfter: [{ ch: 'A', start: 0, end: 1, kept: true }, { ch: '大', start: 1, end: 4 }],
        repairs: [],
      }],
    },
    alternatives: [], signatures: [], signals: [],
  };
  const s = JSON.parse(LLM.buildPrompt(r, null, null, 'humor').user).steps[0];
  assert.deepEqual(s.beforeMap, [['å', 'E5'], ['¤', 'A4'], ['§', 'A7']]);
  assert.deepEqual(s.afterMap, [['大', 'E5 A4 A7']]);
  assert.ok(LLM.buildPrompt(r, null, null, 'humor').system.includes('转义层的 beforeMap 是转义记号与它代表的字节'));
});

// ---------------------------------------------------------------------------
// 4. One 1-based position per repair, with its layer
// ---------------------------------------------------------------------------

test('llm-fixes: repairs carry the same 1-based position as facts, plus layer / intermediate', () => {
  const { u } = promptFor('â€œDonâ€™t panic!â€');
  assert.ok(u.repairs && u.repairs.length >= 1);
  const rp = u.repairs[0];
  assert.ok(!('at' in rp), 'no 0-based `at`');
  assert.equal(rp.position, 14);
  assert.equal(u.facts.repairs[0].position, 14, 'facts agree');
  assert.equal(rp.layer, 1);
  assert.ok(!rp.intermediate, 'a single-layer repair is in the final output');

  const relic = MBX.Forge.corrupt('日本語のテキスト、こんにちは', [{ encoding: 'utf-8', misreadAs: 'gbk' }, { encoding: 'utf-8', misreadAs: 'windows-1252' }], { dropInvisible: true });
  const text = typeof relic === 'string' ? relic : relic.text || relic.output;
  const multi = promptFor(text);
  const steps = multi.r.best.steps;
  assert.ok(steps.length >= 2, 'double layer');
  for (const [i, src] of multi.r.best.repairs.entries()) {
    const out = multi.u.repairs[i];
    assert.equal(out.layer, src.step + 1);
    assert.equal(out.intermediate === true, src.step !== steps.length - 1, `repair ${i} intermediate flag`);
    if (src.index >= 0) assert.equal(out.position, src.index + 1);
    else assert.ok(!('position' in out));
  }
  assert.ok(multi.u.repairs.some((x) => x.intermediate), 'the dropped bytes sit in the intermediate layer');
  const sys = multi.p.system;
  assert.ok(sys.includes('修复位置从 1 开始计数') && sys.includes('intermediate'));

  // Untraceable repairs (index -1) carry no position at all, never "position 0".
  const r = multi.r;
  const view = Object.assign({}, r, { best: Object.assign({}, r.best, { repairs: r.best.repairs.map((x) => Object.assign({}, x, { index: -1 })) }) });
  const payload = JSON.parse(LLM.buildPrompt(view, null, null, 'academic').user);
  assert.ok(payload.repairs.length && payload.repairs.every((x) => !('position' in x) && !('at' in x) && x.layer === 1));
});

// ---------------------------------------------------------------------------
// 5 & 6. Facts: evidence kept, no duplicates, no contradictions
// ---------------------------------------------------------------------------

test('llm-fixes: gallery prompts carry flattened byte samples, no null tokens, under budget', () => {
  const gallery = MBX.Forge.GALLERY;
  assert.ok(Array.isArray(gallery) && gallery.length >= 20);
  for (const g of gallery) {
    for (const seed of [0, 1]) {
      const { r, p, u } = promptFor(g.relic, seed);
      const tag = `${g.id} seed ${seed}`;
      assert.ok(!/\bnull\b/.test(p.user), `${tag}: null token in prompt`);
      assert.ok(p.user.length < 8000, `${tag}: ${p.user.length} chars`);
      const facts = MBX.Narrator.factsFor(r);
      const hasSamples = (facts.layers || []).some((l) => Array.isArray(l.samples) && l.samples.length);
      if (hasSamples) {
        assert.ok(u.facts.layers.some((l) => Array.isArray(l.samples) && typeof l.samples[0] === 'string'), `${tag}: sample strings`);
      }
      if (u.facts) {
        for (const k of ['exhibitId', 'status', 'input', 'output', 'confidence', 'label', 'language', 'alternatives', 'signals']) {
          assert.ok(!(k in u.facts), `${tag}: facts.${k} duplicates the payload`);
        }
      }
      const sites = (u.exhibit && u.exhibit.site ? 1 : 0) + (u.facts && u.facts.site ? 1 : 0);
      assert.ok(sites <= 1, `${tag}: one site only`);
      assert.ok(!(u.exhibit && u.facts && u.facts.era), `${tag}: era comes from the exhibit card`);
    }
  }
});

test('llm-fixes: dajiahao facts keep the per-character evidence and encoding stories once', () => {
  const { p, u } = promptFor('å¤§å®¶å¥½');
  const layer = u.facts.layers[0];
  assert.equal(layer.samples[0], '大 U+5927 E5 A4 A7 → å(E5) ¤(A4) §(A7)');
  assert.equal(layer.trueEncoding, 'utf-8', 'layers reference encodings by id');
  assert.equal(layer.wrongDecoder, 'windows-1252');
  assert.ok(u.facts.encodings['utf-8'].story.includes('Ken Thompson'));
  assert.equal(p.user.split('Ken Thompson').length - 1, 1, 'the UTF-8 story appears once');

  // Cross-boundary misreadings are spelled out.
  const gbk = promptFor('浣犲ソ').u.facts.layers[0].samples[0];
  assert.ok(gbk.includes('跨字边界'), gbk);
});

test('llm-fixes: exhibit and facts never disagree on the site; layers numbered like steps', () => {
  const one = promptFor('å¤§å®¶å¥½', 1).u;
  assert.ok(one.exhibit.site, 'the visitor-facing site');
  assert.ok(!('site' in one.facts), 'no second, different site');

  const g = MBX.Forge.GALLERY.find((x) => x.id === 'double-layer');
  const { u, p } = promptFor(g.relic);
  assert.equal(u.steps.length, 2);
  assert.equal(u.facts.layers.length, 2);
  for (const fl of u.facts.layers) {
    const step = u.steps[fl.layer - 1];
    assert.ok(step, `step for layer ${fl.layer}`);
    assert.equal(fl.before, step.before, `layer ${fl.layer} before`);
    assert.equal(fl.after, step.after, `layer ${fl.layer} after`);
    assert.equal(fl.formationOrder, u.facts.layers.length - fl.layer + 1);
    assert.ok(!('order' in fl));
  }
  assert.ok(p.system.includes('formationOrder'));
});

// ---------------------------------------------------------------------------
// 7. OpenAI reasoning models: retry without rejected parameters
// ---------------------------------------------------------------------------

const GPT5 = { provider: 'openai', apiKey: 'sk-proj-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5' };

test('llm-fixes: narrate retries once without temperature after "Unsupported value: temperature"', async () => {
  const rejectTemp = { error: { message: "Unsupported value: 'temperature' does not support 0.9 with this model. Only the default (1) value is supported.", type: 'invalid_request_error', param: 'temperature', code: 'unsupported_value' } };
  await withFetch((url, init, i) => (i === 0 ? jsonResponse(400, rejectTemp) : OPENAI_OK()), async (calls) => {
    const out = await LLM.narrate(CLEAN, { facts: null, config: GPT5 });
    assert.equal(out.text, '讲解');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.temperature, 0.9, 'the documented default is tried first');
    assert.ok(!('temperature' in calls[1].body), 'retry drops temperature');
    assert.equal(calls[1].body.stream, true);
    assert.equal(calls[1].headers.authorization, 'Bearer sk-proj-test');
  });
  // Any other 400 is reported, not retried.
  await withFetch(() => jsonResponse(400, { error: { message: 'messages: field required' } }), async (calls) => {
    await expectLLMError(LLM.narrate(CLEAN, { facts: null, config: GPT5 }), 'http');
    assert.equal(calls.length, 1);
  });
  // A model that keeps rejecting stops after the parameter is gone.
  await withFetch(() => jsonResponse(400, rejectTemp), async (calls) => {
    await expectLLMError(LLM.narrate(CLEAN, { facts: null, config: GPT5 }), 'http');
    assert.equal(calls.length, 2);
  });
});

test('llm-fixes: testConnection retries with max_completion_tokens after "Unsupported parameter: max_tokens"', async () => {
  const rejectMax = { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", type: 'invalid_request_error', param: 'max_tokens', code: 'unsupported_parameter' } };
  await withFetch((url, init, i) => (i === 0 ? jsonResponse(400, rejectMax) : jsonResponse(200, { model: 'gpt-5', choices: [{ message: { content: 'ok' } }] })), async (calls) => {
    const r = await LLM.testConnection(GPT5);
    assert.equal(r.ok, true, r.message);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].body.max_tokens >= 16, 'room for a reasoning model to answer');
    assert.ok(!('max_tokens' in calls[1].body));
    assert.equal(calls[1].body.max_completion_tokens, calls[0].body.max_tokens);
    assert.equal(calls[1].body.stream, false);
  });
});

// ---------------------------------------------------------------------------
// 8. SSE: a long line costs linear time and is capped
// ---------------------------------------------------------------------------

test('llm-fixes: SSE parser handles a 1 MiB line in 256-byte chunks in linear time', () => {
  const events = [];
  const p = I.createSSEParser((e) => events.push(e));
  const chunk = 'a'.repeat(256);
  const t0 = Date.now();
  p.push('data: ');
  const n = (I.MAX_SSE_LINE - 6) / 256; // exactly at the cap
  for (let i = 0; i < Math.floor(n); i++) p.push(chunk);
  p.push('\n\n');
  const ms = Date.now() - t0;
  assert.ok(ms < 200, `took ${ms}ms`);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.length, Math.floor(n) * 256);

  // Past the cap: a bad_response error, quickly.
  const q = I.createSSEParser(() => {});
  const t1 = Date.now();
  let err = null;
  try {
    for (let i = 0; i < 8192; i++) q.push(chunk);
  } catch (e) {
    err = e;
  }
  assert.ok(err && err.name === 'LLMError' && err.code === 'bad_response', 'over-long line rejected');
  assert.ok(Date.now() - t1 < 200);

  // CR / LF split across chunks still works with the incremental scanner.
  const ev = [];
  const r = I.createSSEParser((e) => ev.push(e));
  for (const piece of ['da', 'ta: o', 'ne\r', '\n', '\r', '\nda', 'ta: two\r', '\r']) r.push(piece);
  r.end();
  assert.deepEqual(ev, [{ event: 'message', data: 'one' }, { event: 'message', data: 'two' }]);
});

// ---------------------------------------------------------------------------
// 9. System prompt wording and alternative labels
// ---------------------------------------------------------------------------

test('llm-fixes: system prompt allows "- " lists, separates verified facts from guesses', () => {
  const sys = LLM.buildPrompt(CLEAN, null, null, 'humor').system;
  assert.ok(sys.includes('以 "- " 开头的列表'), 'lists are allowed by the formatting rule');
  assert.ok(sys.includes('用 "- " 列出 2–4 条'), 'the advice rule asks for that list form');
  assert.ok(sys.includes('文物保护建议'));
  assert.ok(!sys.includes('本馆知识库核实过的编码史实'), 'facts are not all called verified');
  assert.ok(sys.includes('habitats') && sys.includes('culprits') && /可能/.test(sys), 'guesses must be hedged');
});

test('llm-fixes: alternative labels are clipped at a clause boundary', () => {
  const label = 'Windows-1252 被误读为 Mac OS Roman，再以 Windows-1252 保存后被误读为 UTF-16LE，再以 GBK 保存后被误读为 Windows-1252';
  assert.equal(I.clipLabel(label, 80), 'Windows-1252 被误读为 Mac OS Roman，再以 Windows-1252 保存后被误读为 UTF-16LE，…');
  assert.equal(I.clipLabel(label, 60), 'Windows-1252 被误读为 Mac OS Roman，…');
  assert.equal(I.clipLabel('KOI8-R 被误读为 Windows-1251，又被误读为 Windows-1251，又被误读为 KOI8-R，修复 3 处残缺', 50), 'KOI8-R 被误读为 Windows-1251，又被误读为 Windows-1251，…');
  assert.equal(I.clipLabel('短标签', 60), '短标签');
  const r = { input: 'x', status: 'unknown', best: null, signatures: [], signals: [], alternatives: [{ label, confidence: 0.3, output: 'y' }] };
  const shipped = JSON.parse(LLM.buildPrompt(r, null, null, 'humor').user).alternatives[0].label;
  assert.equal(shipped, 'Windows-1252 被误读为 Mac OS Roman，…');
  assert.ok(!/Windows-125…|-…/.test(shipped), 'never cut inside an encoding name');
});
