'use strict';
// i18n tests for MBX.LLM (docs/ARCHITECTURE.md §11.3): the en-US prompt, localized LLMError and
// testConnection messages for every code (zh-CN strings pinned verbatim), localized provider /
// effort / model / preset names, and locale resolution (opts > MBX.I18n > zh-CN, read per call).

const { test, assert, loadAll } = require('./harness');
const MBX = loadAll();
const LLM = MBX.LLM;
const I = LLM._internals;

// CJK ideographs, kana, hangul, bopomofo, CJK punctuation and full-width forms.
const CJK_RE = /[⺀-⿟　-〿぀-ヿ㄀-ㇿ㐀-䶿一-鿿ꥠ-꥿가-힯豈-﫿︰-﹏＀-￯]|[\u{20000}-\u{3134F}]/u;
const CJK_RE_G = new RegExp(CJK_RE.source, 'gu');

/** CJK characters of `text` that are not part of the quoted data (`dataChars`). */
function cjkOutside(text, dataChars) {
  const allowed = dataChars instanceof Set ? dataChars : new Set(Array.from(dataChars || ''));
  return Array.from(new Set((String(text).match(CJK_RE_G) || []).filter((ch) => !allowed.has(ch))));
}

const ANT_KEY = 'sk-ant-i18n-test-0123456789';
const ANT_CFG = { provider: 'anthropic', apiKey: ANT_KEY, baseUrl: '', model: 'claude-opus-5-5' };
const LOCALES = ['zh-CN', 'en-US'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Runs fn with MBX.I18n replaced by `stub` (undefined removes it), restoring it afterwards. */
async function withI18n(stub, fn) {
  const had = Object.prototype.hasOwnProperty.call(MBX, 'I18n');
  const original = MBX.I18n;
  if (stub === undefined) delete MBX.I18n;
  else MBX.I18n = stub;
  try {
    return await fn();
  } finally {
    if (had) MBX.I18n = original;
    else delete MBX.I18n;
  }
}

const zhI18n = () => ({ getLocale: () => 'zh-CN' });
const enI18n = () => ({ getLocale: () => 'en-US' });

function streamResponse(text, opts) {
  const o = opts || {};
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  const stream = new ReadableStream({
    async pull(controller) {
      await new Promise((r) => setImmediate(r));
      if (!sent && bytes.length) {
        sent = true;
        controller.enqueue(bytes);
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, { status: o.status || 200, headers: { 'content-type': o.contentType || 'text/event-stream; charset=utf-8' } });
}

function jsonResponse(status, obj) {
  return new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

function sse(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(Object.assign({ type }, data))}\n\n`;
}

/** Installs a fetch mock (or removes fetch when impl is null) for the duration of fn. */
async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  const calls = [];
  if (impl === null) {
    globalThis.fetch = undefined;
  } else {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
      return impl(url, init, calls.length - 1);
    };
  }
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** Runs fn with globalThis.navigator = { onLine: false } (Node 20 has no navigator). */
async function offline(fn) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    if (desc) Object.defineProperty(globalThis, 'navigator', desc);
    else delete globalThis.navigator;
  }
}

/** -> the LLMError narrate rejected with (fails when it resolves). */
async function narrateError(opts) {
  try {
    await LLM.narrate(sampleResult(), Object.assign({ style: 'humor', facts: null, config: ANT_CFG }, opts));
  } catch (err) {
    assert.equal(err && err.name, 'LLMError', `LLMError expected, got ${err && err.stack}`);
    return err;
  }
  throw new Error('narrate was expected to reject');
}

// ---------------------------------------------------------------------------
// Fixtures: an English-labelled result (as Engine.analyze(…, { locale: 'en-US' }) produces),
// English narration card and English facts. User data (relic, restored text) stays as it is.
// ---------------------------------------------------------------------------

function sampleResult() {
  const bytes = new Uint8Array([0xE5, 0xA4, 0xA7, 0xE5, 0xAE, 0xB6]);
  return {
    input: 'å¤§å®¶',
    status: 'partial',
    locale: 'en-US',
    best: {
      output: '大家',
      label: 'UTF-8 misread as Windows-1252, 1 gap repaired',
      confidence: 0.91,
      lang: { lang: 'zh-Hans', name: 'Simplified Chinese', confidence: 0.8 },
      steps: [{
        kind: 'transcode',
        trueEncoding: 'utf-8',
        wrongDecoder: 'windows-1252',
        before: 'å¤§å®¶',
        after: '大家',
        bytes,
        segmentsBefore: [
          { ch: 'å', start: 0, end: 1 }, { ch: '¤', start: 1, end: 2 }, { ch: '§', start: 2, end: 3 },
          { ch: 'å', start: 3, end: 4 }, { ch: '®', start: 4, end: 5 }, { ch: '¶', start: 5, end: 6, error: true },
        ],
        segmentsAfter: [
          { ch: '大', start: 0, end: 3 }, { ch: '家', start: 3, end: 6, repaired: true }, { ch: '�', start: 6, end: 6 },
        ],
      }],
      repairs: [{ index: 1, step: 0, from: '�', to: '家', reason: 'restored gap', candidates: ['家', '宁'] }],
    },
    alternatives: [{
      label: 'GBK misread as Windows-1252, then saved as UTF-8 and misread as Windows-1252, 2 gaps repaired',
      confidence: 0.2,
      output: '澶у',
    }],
    signatures: [{ id: 'double-utf8', title: 'The Double Misreading', match: 'å¤', note: 'A classic of CSV exports.' }],
    signals: [{ type: 'utf8-as-latin', match: 'Ã', hint: 'Looks like UTF-8 read as a Western code page' }],
  };
}

function sampleNarration() {
  return {
    exhibitId: 'MBX-2026-0001',
    title: 'A Greeting Chewed Up by Windows-1252',
    subtitle: 'UTF-8 bytes in a Western European costume',
    era: { label: 'circa 2002–2018' },
    site: 'Probably a CSV file double-clicked in Excel',
    tags: ['UTF-8', 'Windows-1252'],
  };
}

function sampleFacts() {
  const why = 'Excel opened UTF-8 CSV files as Windows-1252 for years.';
  return {
    layers: [{
      order: 1,
      trueEncoding: { id: 'utf-8', name: 'UTF-8', story: 'Sketched by Ken Thompson and Rob Pike on a placemat in 1992.' },
      wrongDecoder: { id: 'windows-1252', name: 'Windows-1252', story: 'The Western European code page of Windows.' },
      samples: [{
        original: '家',
        codePoint: 'U+5BB6',
        bytes: new Uint8Array([0xE5, 0xAE, 0xB6]),
        misreadAs: [{ char: 'å', bytes: new Uint8Array([0xE5]) }, { char: '®', bytes: new Uint8Array([0xAE, 0xB6]), crossesBoundary: true }],
      }],
    }],
    pairFacts: [{ pair: 'utf-8>windows-1252', eraWhy: why }],
    era: { label: 'circa 2002–2018', evidence: [why, 'Curly quotes turning into â€œ give the period away.'] },
    site: 'A CSV export',
    habitats: ['CSV exports', 'old PHP forums'],
    culprits: ['Excel defaults'],
    tips: ['Save CSV files as UTF-8 with a BOM.'],
  };
}

/** Every character of the relic, the restored text and other quoted user data in a result/facts. */
function dataCharsOf(result, facts) {
  const r = result || {};
  const best = r.best || {};
  const parts = [r.input, best.output];
  for (const s of best.steps || []) parts.push(s.before, s.after);
  for (const a of r.alternatives || []) parts.push(a.output);
  for (const s of r.signatures || []) parts.push(s.match);
  for (const s of r.signals || []) parts.push(s.match);
  for (const rp of best.repairs || []) parts.push(rp.from, rp.to, (rp.candidates || []).join(''));
  for (const l of (facts && facts.layers) || []) {
    for (const s of l.samples || []) {
      parts.push(s.original);
      for (const m of s.misreadAs || []) parts.push(m.char);
    }
  }
  return new Set(Array.from(parts.filter((p) => typeof p === 'string').join('')));
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

test('llm-i18n: the zh-CN prompt is the default and an explicit zh-CN changes nothing', async () => {
  const r = sampleResult();
  await withI18n(undefined, async () => {
    const plain = LLM.buildPrompt(r, sampleNarration(), sampleFacts(), 'academic');
    assert.ok(plain.system.includes('简体中文') && plain.system.includes('文物保护建议'), 'module alone -> zh-CN');
    for (const loc of ['zh-CN', 'zh', 'zh-TW', { locale: 'zh-CN' }, 'fr-FR', '']) {
      const p = LLM.buildPrompt(r, sampleNarration(), sampleFacts(), 'academic', loc);
      assert.equal(p.system, plain.system, `system for ${JSON.stringify(loc)}`);
      assert.equal(p.user, plain.user, `user for ${JSON.stringify(loc)}`);
    }
    const u = JSON.parse(plain.user);
    assert.equal(u.task, '请为这件乱码文物撰写一段展厅讲解词。');
    assert.equal(u.history[0], 'UTF-8 编码的字节被当作 Windows-1252 解读');
    assert.deepEqual(u.steps[0].beforeMap[5], ['¶', 'B6', '错误']);
    assert.deepEqual(u.steps[0].afterMap.slice(1), [['家', 'E5 AE B6', '修复'], ['�', '', '丢失']]);
    assert.ok(u.facts.layers[0].samples[0].endsWith('®(AE B6, 跨字边界)'), u.facts.layers[0].samples[0]);
  });
  await withI18n(zhI18n(), async () => {
    const a = LLM.buildPrompt(r, null, null, 'snark');
    const b = LLM.buildPrompt(r, null, null, 'snark', 'zh-CN');
    assert.equal(a.system, b.system);
    assert.equal(a.user, b.user);
  });
});

test('llm-i18n: the en-US system prompt is English, keeps every rule, for every style', () => {
  const personas = { humor: 'Humorous Docent', academic: 'Academic Researcher', snark: 'Snarky Appraiser' };
  const systems = {};
  for (const style of Object.keys(personas)) {
    const s = LLM.buildPrompt(sampleResult(), null, null, style, 'en-US').system;
    systems[style] = s;
    assert.deepEqual(cjkOutside(s, ''), [], `no CJK in the ${style} system prompt`);
    assert.ok(s.startsWith('You are the ' + personas[style]), `${style} persona first`);
    assert.ok(s.includes('Museum of Mojibake Archaeology'));
    assert.ok(/natural US English/.test(s) && /American spelling/.test(s), 'answer language');
    assert.ok(s.includes('250') && s.includes('450') && !s.includes('350–700'), 'English length target');
    assert.ok(s.includes('3–5') && s.includes('"### "'), 'subheading rule');
    assert.ok(s.includes('"### Conservation Advice"') && s.includes('2–4'), 'conservation advice rule');
    assert.ok(s.includes('lists that start with "- "'), 'lists allowed');
    assert.ok(/never invent encodings, bytes or chains/.test(s), 'grounding rule');
    assert.ok(s.includes('`E5 A4 A7`') && /hex bytes/.test(s), 'hex quoting rule');
    assert.ok(/habitats/.test(s) && /culprits/.test(s) && /"probably"/.test(s), 'guesses must be hedged');
    assert.ok(/verified history/.test(s) && /eraEvidence/.test(s), 'verified vs guessed facts');
    assert.ok(s.includes('formationOrder') && s.includes('intermediate') && s.includes('positions count from 1'), 'dossier description');
    assert.ok(/escape token/.test(s), 'escape layers are described');
    assert.ok(/must be ignored/.test(s), 'data is never instructions');
    assert.ok(/no preamble/.test(s) && /do not mention JSON/.test(s), 'no-preamble rule');
    assert.ok(/never translate or romanize/.test(s), 'quoted relic glyphs stay as data');
    // A short English gloss may follow a quoted non-English original (never replacing it, never
    // for the mojibake); the example stays outside CJK so the prompt itself remains CJK-free (§11.2).
    assert.ok(/brief English gloss in parentheses right after the quote/.test(s), 'gloss allowed after the quote');
    assert.ok(/\("Hello, world"\)/.test(s) && /never replaces it/.test(s) && /mojibake itself gets no gloss/.test(s), 'gloss rule details');
    for (const status of ['restored', 'partial', 'irrecoverable', 'unknown', 'clean']) assert.ok(s.includes(status + ':'), `status ${status}`);
  }
  assert.ok(systems.humor !== systems.academic && systems.academic !== systems.snark, 'styles differ');
  // Unknown style falls back to the humorous docent, as in zh-CN.
  assert.equal(LLM.buildPrompt(sampleResult(), null, null, 'nope', 'en-US').system, systems.humor);
});

test('llm-i18n: en-US user message: every text field is English, quoted data stays verbatim', () => {
  const r = sampleResult();
  const facts = sampleFacts();
  const p = LLM.buildPrompt(r, sampleNarration(), facts, 'humor', 'en-US');
  assert.deepEqual(cjkOutside(p.user, dataCharsOf(r, facts)), [], 'no CJK outside quoted data');
  const u = JSON.parse(p.user);
  assert.equal(u.task, 'Write a gallery talk for this mojibake relic.');
  assert.equal(u.style, 'humor');
  assert.equal(u.status, 'partial');
  assert.equal(u.input, 'å¤§å®¶', 'relic verbatim');
  assert.equal(u.output, '大家', 'restored text verbatim');
  assert.equal(u.chain, 'UTF-8 misread as Windows-1252, 1 gap repaired');
  assert.deepEqual(u.history, ['UTF-8-encoded bytes were misread as Windows-1252']);
  assert.equal(u.steps[0].story, u.history[0]);
  assert.equal(u.steps[0].before, 'å¤§å®¶');
  assert.equal(u.steps[0].after, '大家');
  assert.deepEqual(u.steps[0].beforeMap[5], ['¶', 'B6', 'error']);
  assert.deepEqual(u.steps[0].afterMap, [['大', 'E5 A4 A7'], ['家', 'E5 AE B6', 'repaired'], ['�', '', 'lost']]);
  assert.deepEqual(u.repairs[0], { position: 2, layer: 1, from: '�', to: '家', reason: 'restored gap', candidates: ['家', '宁'] });
  assert.equal(u.facts.layers[0].samples[0], '家 U+5BB6 E5 AE B6 → å(E5) ®(AE B6, crosses a character boundary)');
  assert.ok(u.facts.encodings['utf-8'].story.includes('Ken Thompson'));
  assert.deepEqual(u.facts.eraEvidence, ['Curly quotes turning into â€œ give the period away.'], 'eraWhy duplicate dropped as in zh-CN');
  assert.equal(u.exhibit.title, 'A Greeting Chewed Up by Windows-1252');
  assert.equal(u.signals[0].hint, 'Looks like UTF-8 read as a Western code page');
  // English chain labels are clipped at ", " clause boundaries.
  assert.equal(u.alternatives[0].label, 'GBK misread as Windows-1252, …');
  assert.equal(u.alternatives[0].output, '澶у', 'alternative output verbatim');
});

test('llm-i18n: en-US escape-layer stories and the clause-boundary label clip', () => {
  assert.equal(I.storyOf({ kind: 'unescape', scheme: 'percent', trueEncoding: 'utf-8' }, 'en-US'), 'UTF-8 bytes were written as URL percent-encoding');
  assert.equal(I.storyOf({ kind: 'unescape', scheme: 'html-entity' }, 'en-US'), 'The text was written as HTML entities');
  assert.equal(I.storyOf({ kind: 'unescape', scheme: 'percent', trueEncoding: 'utf-8' }, 'zh-CN'), 'UTF-8 字节被写成了URL 百分号编码');
  for (const scheme of ['percent', 'hex-escape', 'quoted-printable', 'hex-dump', 'unicode-escape', 'html-entity', undefined]) {
    assert.deepEqual(cjkOutside(I.storyOf({ kind: 'unescape', scheme, trueEncoding: 'utf-8' }, 'en-US'), ''), [], String(scheme));
  }
  const label = 'UTF-8 misread as Windows-1252, then saved as GBK and misread as Big5, 3 gaps repaired';
  assert.equal(I.clipLabel(label, 60, 'en-US'), 'UTF-8 misread as Windows-1252, …');
  assert.equal(I.clipLabel(label, 75, 'en-US'), 'UTF-8 misread as Windows-1252, then saved as GBK and misread as Big5, …');
  assert.equal(I.clipLabel(label, 200, 'en-US'), label, 'short enough: untouched');
  // A label that is still Chinese (engine not localized) is cut at its own commas, as in zh-CN.
  const zhLabel = 'UTF-8 被误读为 Windows-1252，又被误读为 GBK，修复 2 处残缺';
  assert.equal(I.clipLabel(zhLabel, 40, 'en-US'), 'UTF-8 被误读为 Windows-1252，又被误读为 GBK，…');
  assert.equal(I.clipLabel(zhLabel, 40), 'UTF-8 被误读为 Windows-1252，又被误读为 GBK，…');
  assert.equal(I.clipLabel(zhLabel, 40, 'zh-CN'), I.clipLabel(zhLabel, 40));
});

test('llm-i18n: the en-US prompt stays under the size bound, including the pathological fallback', () => {
  const big = MBX.Engine.analyze('Ã¥Â¤Â§Ã¥Â®Â¶Ã¥Â¥Â½ '.repeat(800), { locale: 'en-US' });
  for (const style of ['humor', 'academic', 'snark']) {
    const p = LLM.buildPrompt(big, null, undefined, style, 'en-US');
    assert.ok(p.user.length <= I.PROMPT_BUDGET, `user ${p.user.length}`);
    assert.ok(p.system.length < 6000, `system ${p.system.length}`);
    const u = JSON.parse(p.user);
    assert.equal(u.task, 'Write a gallery talk for this mojibake relic.');
    assert.ok(p.user.includes('E5'), 'still cites bytes');
  }
  // Every limit level overflows (a huge label): the minimal fallback is English too.
  const r = sampleResult();
  r.best.label = 'UTF-8 misread as Windows-1252' + ', and again'.repeat(2000);
  const p = LLM.buildPrompt(r, null, null, 'humor', 'en-US');
  assert.ok(p.user.length <= I.PROMPT_BUDGET, `fallback ${p.user.length}`);
  const u = JSON.parse(p.user);
  assert.equal(u.task, 'Write a gallery talk for this mojibake relic.');
  assert.ok(!('steps' in u), 'fallback payload');
});

test('llm-i18n: real engine results: LLM-owned prompt text is English (engine/narrator text too once localized)', () => {
  const relics = MBX.Forge.GALLERY.map((g) => g.relic).concat(['%E4%BD%A0%E5%A5%BD', '&#20320;&#22909;', '锟斤拷锟斤拷', 'Hello world', 'xq7#@!kz']);
  const zhTask = '请为这件乱码文物撰写一段展厅讲解词。';
  for (const relic of relics) {
    const r = MBX.Engine.analyze(relic, { locale: 'en-US' });
    let n = null;
    try {
      n = MBX.Narrator.narrate(r, { style: 'humor', seed: 0, locale: 'en-US' });
    } catch (_) {
      n = null;
    }
    const p = LLM.buildPrompt(r, n, undefined, 'humor', 'en-US');
    assert.deepEqual(cjkOutside(p.system, ''), [], 'system');
    assert.ok(p.user.length <= I.PROMPT_BUDGET);
    const u = JSON.parse(p.user);
    assert.notEqual(u.task, zhTask);
    assert.deepEqual(cjkOutside(u.task, ''), []);
    for (const h of u.history || []) assert.deepEqual(cjkOutside(h, ''), [], `history: ${h}`);
    for (const s of u.steps || []) {
      assert.deepEqual(cjkOutside(s.story, ''), [], `story: ${s.story}`);
      for (const row of (s.beforeMap || []).concat(s.afterMap || [])) {
        if (row.length > 2) assert.ok(['error', 'repaired', 'lost'].includes(row[2]), `flag ${row[2]}`);
      }
    }
    for (const l of (u.facts && u.facts.layers) || []) {
      for (const line of l.samples || []) assert.ok(typeof line !== 'string' || !line.includes('跨字边界'), line);
    }
    // Engine text (chain labels, language names) is English once Engine speaks en-US (§11.3).
    if (r.locale === 'en-US') {
      assert.deepEqual(cjkOutside(u.chain || '', ''), [], `chain: ${u.chain}`);
      assert.deepEqual(cjkOutside((u.language && u.language.name) || '', ''), [], 'language name');
      for (const a of u.alternatives || []) assert.deepEqual(cjkOutside(a.label || '', ''), [], `alt: ${a.label}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Locale resolution (§11.2)
// ---------------------------------------------------------------------------

test('llm-i18n: locale resolution: opts.locale > MBX.I18n.getLocale() > zh-CN, read at call time', async () => {
  const r = sampleResult();
  const isEn = (p) => p.system.startsWith('You are the ');
  await withI18n(undefined, async () => {
    assert.equal(I.resolveLocale(), 'zh-CN', 'no I18n -> zh-CN');
    assert.ok(!isEn(LLM.buildPrompt(r, null, null, 'humor')));
    assert.ok(isEn(LLM.buildPrompt(r, null, null, 'humor', 'en-US')), 'explicit en-US without I18n');
    assert.equal(LLM.listProviders()[0].name, '不使用（内置模板讲解员）');
  });
  let current = 'en-US';
  await withI18n({ getLocale: () => current }, async () => {
    assert.ok(isEn(LLM.buildPrompt(r, null, null, 'humor')), 'I18n en-US is followed');
    assert.equal(LLM.listProviders()[0].name, 'None (built-in docent)');
    assert.equal(LLM.efforts()[1].name, 'Medium · balanced');
    assert.equal(LLM.modelLabels()['claude-opus-5-5'], 'Claude Opus 5.5 (default)');
    // An explicit locale wins over I18n, as a string or as opts.
    assert.ok(!isEn(LLM.buildPrompt(r, null, null, 'humor', 'zh-CN')));
    assert.ok(!isEn(LLM.buildPrompt(r, null, null, 'humor', { locale: 'zh-Hans' })));
    assert.equal(LLM.listProviders('zh-CN')[0].name, '不使用（内置模板讲解员）');
    // Not cached: a later locale change is picked up by the next call.
    current = 'zh-CN';
    assert.ok(!isEn(LLM.buildPrompt(r, null, null, 'humor')));
    assert.equal(LLM.efforts()[1].name, '中 · 默认');
    // Normalization of explicit tags.
    for (const tag of ['en', 'en-GB', 'EN-us', 'en_US']) assert.ok(isEn(LLM.buildPrompt(r, null, null, 'humor', tag)), tag);
    for (const tag of ['zh', 'zh-TW', 'zh-HK', 'fr', 'ja-JP']) assert.ok(!isEn(LLM.buildPrompt(r, null, null, 'humor', tag)), tag);
  });
  await withI18n({ getLocale: () => { throw new Error('broken'); } }, async () => {
    assert.equal(I.resolveLocale(), 'zh-CN', 'a broken I18n falls back to zh-CN');
  });
});

test('llm-i18n: narrate/testConnection resolve the locale from opts first, then MBX.I18n', async () => {
  let seen = null;
  LLM.registerProvider('i18n-probe', {
    name: 'Probe',
    run: async (args) => {
      seen = args;
      return 'OK';
    },
  });
  const cfg = { provider: 'i18n-probe' };
  await withI18n(enI18n(), async () => {
    await LLM.narrate(sampleResult(), { style: 'humor', facts: null, config: cfg });
    assert.equal(seen.locale, 'en-US');
    assert.ok(seen.system.startsWith('You are the Humorous Docent'), 'English prompt from I18n');
    assert.equal(JSON.parse(seen.user).task, 'Write a gallery talk for this mojibake relic.');
    await LLM.narrate(sampleResult(), { style: 'humor', facts: null, config: cfg, locale: 'zh-CN' });
    assert.equal(seen.locale, 'zh-CN');
    assert.ok(seen.system.includes('简体中文'), 'opts.locale wins');
    const t = await LLM.testConnection(cfg);
    assert.equal(seen.system, 'Connection test');
    assert.equal(seen.user, 'Reply with OK only.');
    assert.equal(t.message, 'Connected: Probe returned 2 characters.');
    const tz = await LLM.testConnection(cfg, 'zh-CN');
    assert.equal(seen.system, '连接测试');
    assert.equal(seen.user, '请只回复 OK。');
    assert.equal(tz.message, '连接成功：Probe 返回了 2 个字符。');
    assert.equal((await LLM.testConnection(cfg, { locale: 'zh-CN' })).message, tz.message, 'opts form');
  });
  await withI18n(zhI18n(), async () => {
    await LLM.narrate(sampleResult(), { style: 'academic', facts: null, config: cfg, locale: 'en' });
    assert.equal(seen.locale, 'en-US');
    assert.ok(seen.system.startsWith('You are the Academic Researcher'));
  });
  // A custom test() receives the locale as a third argument.
  let testOpts = null;
  LLM.registerProvider('i18n-probe-test', { name: 'Probe2', run: async () => 'x', test: async (c, s, o) => { testOpts = o; return 'fine'; } });
  await withI18n(zhI18n(), async () => {
    const res = await LLM.testConnection({ provider: 'i18n-probe-test' }, 'en-US');
    assert.equal(res.message, 'fine');
    assert.deepEqual(testOpts, { locale: 'en-US' });
  });
});

test('llm-i18n: the real MBX.I18n (when loaded) drives the default locale', async () => {
  const I18n = MBX.I18n;
  if (!I18n || typeof I18n.setLocale !== 'function' || typeof I18n.getLocale !== 'function') return; // src/i18n.js not present yet
  const before = I18n.getLocale();
  try {
    I18n.setLocale('en-US');
    assert.equal(LLM.listProviders()[0].name, 'None (built-in docent)');
    assert.ok(LLM.buildPrompt(sampleResult(), null, null, 'humor').system.startsWith('You are the '));
    I18n.setLocale('zh-CN');
    assert.equal(LLM.listProviders()[0].name, '不使用（内置模板讲解员）');
    assert.ok(LLM.buildPrompt(sampleResult(), null, null, 'humor').system.includes('简体中文'));
  } finally {
    I18n.setLocale(before);
  }
});

// ---------------------------------------------------------------------------
// Settings-drawer names
// ---------------------------------------------------------------------------

test('llm-i18n: listProviders / efforts / modelLabels / providerPresets per locale; legacy tables stay Chinese', async () => {
  await withI18n(zhI18n(), async () => {
    const zh = LLM.listProviders('zh-CN');
    const en = LLM.listProviders('en-US');
    assert.deepEqual(LLM.listProviders(), zh, 'zh-CN is the default');
    const byId = (list) => Object.fromEntries(list.map((p) => [p.id, p]));
    const z = byId(zh);
    const e = byId(en);
    assert.equal(zh[0].id, 'none');
    assert.equal(en[0].id, 'none');
    assert.equal(z.none.name, '不使用（内置模板讲解员）');
    assert.equal(z.anthropic.name, 'Anthropic Claude');
    assert.equal(z.openai.name, 'OpenAI 兼容端点');
    assert.equal(e.none.name, 'None (built-in docent)');
    assert.equal(e.anthropic.name, 'Anthropic Claude');
    assert.equal(e.openai.name, 'OpenAI-compatible endpoint');
    // Only names change; custom providers keep the name they registered with.
    assert.deepEqual(en.map((p) => p.id), zh.map((p) => p.id));
    for (const p of en) {
      const q = z[p.id];
      assert.deepEqual(Object.assign({}, p, { name: null }), Object.assign({}, q, { name: null }), p.id);
      if (['none', 'anthropic', 'openai'].includes(p.id)) assert.deepEqual(cjkOutside(p.name, ''), [], p.id);
      else assert.equal(p.name, q.name, `custom ${p.id}`);
    }

    assert.deepEqual(LLM.efforts('zh-CN'), LLM.EFFORTS);
    assert.deepEqual(LLM.efforts('en-US'), [
      { id: 'low', name: 'Low · faster, cheaper' },
      { id: 'medium', name: 'Medium · balanced' },
      { id: 'high', name: 'High · most thorough' },
    ]);
    const copy = LLM.efforts('en-US');
    copy[0].name = 'mutated';
    assert.equal(LLM.efforts('en-US')[0].name, 'Low · faster, cheaper', 'efforts() returns copies');

    assert.deepEqual(LLM.modelLabels('zh-CN'), LLM.MODEL_LABELS);
    const ml = LLM.modelLabels('en-US');
    assert.deepEqual(Object.keys(ml), Object.keys(LLM.MODEL_LABELS));
    for (const k of Object.keys(ml)) assert.deepEqual(cjkOutside(ml[k], ''), [], k);
    assert.equal(ml['claude-fable-5-1'], 'Claude Fable 5.1 (most capable)');
    ml['claude-opus-5-5'] = 'mutated';
    assert.equal(LLM.modelLabels('en-US')['claude-opus-5-5'], 'Claude Opus 5.5 (default)', 'modelLabels() returns copies');

    assert.deepEqual(LLM.providerPresets('openai', 'zh-CN'), LLM.PROVIDERS.openai.presets);
    const pe = LLM.providerPresets('openai', 'en-US');
    assert.deepEqual(pe.map((p) => p.name), ['DeepSeek', 'Qwen (DashScope compatible mode)', 'Local Ollama']);
    assert.deepEqual(pe.map((p) => [p.baseUrl, p.model]), LLM.PROVIDERS.openai.presets.map((p) => [p.baseUrl, p.model]));
    assert.deepEqual(LLM.providerPresets('anthropic', 'en-US'), []);

    // Compatibility exports keep their Chinese text.
    assert.equal(LLM.EFFORTS[0].name, '低 · 更快更省');
    assert.equal(LLM.MODEL_LABELS['claude-opus-5-5'], 'Claude Opus 5.5（默认）');
    assert.equal(LLM.PROVIDERS.openai.name, 'OpenAI 兼容端点');
    assert.equal(LLM.PROVIDERS.openai.presets[2].name, '本地 Ollama');
  });
});

// ---------------------------------------------------------------------------
// Error messages: every code, both locales (zh-CN pinned verbatim)
// ---------------------------------------------------------------------------

test('llm-i18n: the message catalogs have the same keys and every en-US message is English', () => {
  const zh = Object.keys(I.MESSAGES['zh-CN']).sort();
  const en = Object.keys(I.MESSAGES['en-US']).sort();
  assert.deepEqual(en, zh);
  const params = { host: 'api.example.com', tag: 'HTTP 500', detail: 'details', mb: 1, id: 'x', provider: 'x', name: 'X', model: 'm', count: 3, seconds: 20 };
  for (const k of en) {
    const m = I.message('en-US', k, params);
    assert.ok(typeof m === 'string' && m.trim(), k);
    assert.deepEqual(cjkOutside(m, ''), [], `${k}: ${m}`);
  }
  assert.equal(I.message('zh-CN', 'testTimeout', { seconds: 20 }), '连接超时：20 秒内没有收到响应。');
  assert.equal(I.message('en-US', 'testTimeout', { seconds: 20 }), 'Connection timed out: no response within 20 seconds.');
  assert.equal(I.message('zh-CN', 'incomplete'), 'AI 讲解员配置不完整。');
  assert.equal(I.message('en-US', 'incomplete'), 'The AI docent settings are incomplete.');
  assert.equal(I.message('en-US', 'testRunOk', { name: 'X', count: 1 }), 'Connected: X returned 1 character.');
});

/**
 * One scenario per error path: { name, code, run(locale) -> LLMError | { message, code } }.
 * `zh` is the exact pre-i18n Chinese text; `en(message)` checks the English one.
 */
const SSE_TEXT = sse('message_start', { message: { model: 'claude-opus-5-5' } }) +
  sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'partial words' } });

function fetchOnce(response) {
  return () => (typeof response === 'function' ? response() : response);
}

const SCENARIOS = [
  {
    name: 'auth (HTTP 401)',
    code: 'auth',
    run: (locale) => withFetch(fetchOnce(() => jsonResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })), () => narrateError({ locale })),
    zh: '鉴权失败（HTTP 401）：API Key 无效、已过期，或无权使用该模型。服务器说明：invalid x-api-key',
    en: "Authentication failed (HTTP 401): the API key is invalid or expired, or it doesn't have access to this model. Server says: invalid x-api-key",
  },
  {
    name: 'rate_limit (HTTP 429)',
    code: 'rate_limit',
    run: (locale) => withFetch(fetchOnce(() => jsonResponse(429, { error: { type: 'rate_limit_error', message: 'slow down' } })), () => narrateError({ locale })),
    zh: '请求过于频繁或额度已用尽（HTTP 429），请稍后再试。服务器说明：slow down',
    en: 'Too many requests, or the quota is used up (HTTP 429). Please try again later. Server says: slow down',
  },
  {
    name: 'overloaded (HTTP 529)',
    code: 'overloaded',
    run: (locale) => withFetch(fetchOnce(() => jsonResponse(529, { error: { type: 'overloaded_error', message: 'busy' } })), () => narrateError({ locale })),
    zh: 'AI 服务器暂时过载（HTTP 529），请稍后再试。服务器说明：busy',
    en: 'The AI server is temporarily overloaded (HTTP 529). Please try again later. Server says: busy',
  },
  {
    name: 'overloaded (SSE error event)',
    code: 'overloaded',
    run: (locale) => withFetch(fetchOnce(() => streamResponse(sse('error', { error: { type: 'overloaded_error', message: 'Overloaded' } }))), () => narrateError({ locale })),
    zh: 'AI 服务器暂时过载（overloaded_error），请稍后再试。服务器说明：Overloaded',
    en: 'The AI server is temporarily overloaded (overloaded_error). Please try again later. Server says: Overloaded',
  },
  {
    name: 'http (SSE error without a type)',
    code: 'http',
    run: (locale) => withFetch(fetchOnce(() => streamResponse('event: error\ndata: {"error":{"message":"boom"}}\n\n')), () => narrateError({ locale })),
    zh: 'AI 服务返回错误（流式错误）。服务器说明：boom',
    en: 'The AI service returned an error (stream error). Server says: boom',
  },
  {
    name: 'http 404',
    code: 'http',
    run: (locale) => withFetch(fetchOnce(() => jsonResponse(404, { error: { type: 'not_found_error', message: 'model: nope' } })), () => narrateError({ locale })),
    zh: '接口或模型不存在（HTTP 404），请检查 Base URL 与模型名称。服务器说明：model: nope',
    en: 'Endpoint or model not found (HTTP 404). Check the Base URL and the model name. Server says: model: nope',
  },
  {
    name: 'http 413',
    code: 'http',
    run: (locale) => withFetch(fetchOnce(() => new Response('<html>too big</html>', { status: 413 })), () => narrateError({ locale })),
    zh: '请求内容过大（HTTP 413）。',
    en: 'The request is too large (HTTP 413).',
  },
  {
    name: 'http 500',
    code: 'http',
    run: (locale) => withFetch(fetchOnce(() => new Response('upstream crashed', { status: 500 })), () => narrateError({ locale })),
    zh: 'AI 服务端出错（HTTP 500），请稍后再试。服务器说明：upstream crashed',
    en: 'The AI service ran into a server error (HTTP 500). Please try again later. Server says: upstream crashed',
  },
  {
    name: 'http 400 (key redacted)',
    code: 'http',
    run: (locale) => withFetch(fetchOnce(() => jsonResponse(400, { error: { message: `bad key ${ANT_KEY}` } })), () => narrateError({ locale })),
    zh: '请求被拒绝（HTTP 400）。服务器说明：bad key ***',
    en: 'The request was rejected (HTTP 400). Server says: bad key ***',
  },
  {
    name: 'refusal (SSE stop_reason)',
    code: 'refusal',
    run: (locale) => withFetch(fetchOnce(() => streamResponse(SSE_TEXT + sse('message_delta', { delta: { stop_reason: 'refusal' } }))), () => narrateError({ locale })),
    zh: 'AI 讲解员婉拒了这件展品（模型以 refusal 结束），已改由馆内模板讲解员解说。',
    en: 'The AI docent politely declined this exhibit (the model ended with a refusal), so the built-in docent has taken over the tour.',
  },
  {
    name: 'refusal (JSON message)',
    code: 'refusal',
    run: (locale) => withFetch(fetchOnce(() => jsonResponse(200, { type: 'message', content: [], stop_reason: 'refusal' })), () => narrateError({ locale })),
    zh: 'AI 讲解员婉拒了这件展品（模型以 refusal 结束），已改由馆内模板讲解员解说。',
    en: 'The AI docent politely declined this exhibit (the model ended with a refusal), so the built-in docent has taken over the tour.',
  },
  {
    name: 'refusal (OpenAI content_filter)',
    code: 'refusal',
    run: (locale) => withFetch(
      fetchOnce(() => streamResponse('data: {"choices":[{"delta":{"content":"x"},"finish_reason":"content_filter"}]}\n\n')),
      () => narrateError({ locale, config: { provider: 'openai', baseUrl: 'https://api.example.com/v1', model: 'm' } })),
    zh: 'AI 讲解员婉拒了这件展品（模型以 refusal 结束），已改由馆内模板讲解员解说。',
    en: 'The AI docent politely declined this exhibit (the model ended with a refusal), so the built-in docent has taken over the tour.',
  },
  {
    name: 'network (CORS / offline / firewall)',
    code: 'network',
    run: (locale) => withFetch(() => { throw new TypeError('Failed to fetch'); }, () => narrateError({ locale })),
    zh: '无法连接到 api.anthropic.com：可能是网络离线、代理或防火墙拦截，也可能是该端点不允许浏览器直接跨域访问（CORS）。',
    en: "Couldn't reach api.anthropic.com: the network may be offline, a proxy or firewall may be blocking the request, or the endpoint may not allow direct cross-origin requests from a browser (CORS).",
  },
  {
    name: 'network (browser offline)',
    code: 'network',
    run: (locale) => offline(() => withFetch(() => { throw new TypeError('Failed to fetch'); }, () => narrateError({ locale }))),
    zh: '浏览器当前处于离线状态，无法连接到 api.anthropic.com。',
    en: "Your browser is offline, so it can't reach api.anthropic.com.",
  },
  {
    name: 'network (local Ollama hint)',
    code: 'network',
    run: (locale) => withFetch(() => { throw new TypeError('Failed to fetch'); },
      () => narrateError({ locale, config: { provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' } })),
    zh: '无法连接到 localhost:11434：可能是网络离线、代理或防火墙拦截，也可能是该端点不允许浏览器直接跨域访问（CORS）。本地服务（如 Ollama）需先允许本页面来源跨域，例如设置环境变量 OLLAMA_ORIGINS=*。',
    en: "Couldn't reach localhost:11434: the network may be offline, a proxy or firewall may be blocking the request, or the endpoint may not allow direct cross-origin requests from a browser (CORS). A local server such as Ollama must first allow this page's origin, for example by setting the environment variable OLLAMA_ORIGINS=*.",
  },
  {
    name: 'network (timeout)',
    code: 'network',
    run: (locale) => withFetch(() => {
      const e = new Error('The operation timed out.');
      e.name = 'TimeoutError';
      throw e;
    }, () => narrateError({ locale })),
    zh: '连接 api.anthropic.com 超时，请检查网络后重试。',
    en: 'The connection to api.anthropic.com timed out. Check your network and try again.',
  },
  {
    name: 'network (stream cut mid-narration)',
    code: 'network',
    run: (locale) => withFetch(fetchOnce(() => streamResponse(SSE_TEXT)), () => narrateError({ locale })),
    zh: '连接在讲解途中意外中断，未收到结束标记。',
    en: 'The connection dropped mid-narration; the end-of-stream marker never arrived.',
  },
  {
    name: 'network (no fetch)',
    code: 'network',
    run: (locale) => withFetch(null, () => narrateError({ locale })),
    zh: '当前浏览器不支持 fetch，无法调用 AI 讲解员。',
    en: "This browser doesn't support fetch, so the AI docent can't be reached.",
  },
  {
    name: 'aborted',
    code: 'aborted',
    run: (locale) => {
      const ctrl = new AbortController();
      ctrl.abort();
      return withFetch(fetchOnce(() => streamResponse(SSE_TEXT)), () => narrateError({ locale, signal: ctrl.signal }));
    },
    zh: '已取消 AI 讲解。',
    en: 'AI narration canceled.',
  },
  {
    name: 'aborted (mid-stream)',
    code: 'aborted',
    run: (locale) => {
      const ctrl = new AbortController();
      return withFetch(fetchOnce(() => streamResponse(SSE_TEXT + sse('message_stop', {}))),
        () => narrateError({ locale, signal: ctrl.signal, onText: () => ctrl.abort() }));
    },
    zh: '已取消 AI 讲解。',
    en: 'AI narration canceled.',
  },
  {
    name: 'config (provider none)',
    code: 'config',
    run: (locale) => narrateError({ locale, config: { provider: 'none' } }),
    zh: '尚未启用 AI 讲解员：请在设置中选择 LLM 提供方。',
    en: 'The AI docent is not enabled yet: choose an LLM provider in Museum Settings.',
  },
  {
    name: 'config (unknown provider)',
    code: 'config',
    run: (locale) => narrateError({ locale, config: { provider: 'nope-xyz' } }),
    zh: '找不到 LLM 提供方「nope-xyz」。',
    en: 'LLM provider "nope-xyz" not found.',
  },
  {
    name: 'config (missing API key)',
    code: 'config',
    run: (locale) => narrateError({ locale, config: { provider: 'anthropic' } }),
    zh: '请先在设置中填写 Anthropic Claude 的 API Key。',
    en: 'Enter the API key for Anthropic Claude in Museum Settings first.',
  },
  {
    name: 'config (missing Base URL)',
    code: 'config',
    run: (locale) => narrateError({ locale, config: { provider: 'openai', model: 'm' } }),
    zh: '请填写 OpenAI 兼容端点的 Base URL。',
    en: 'Enter the Base URL of the OpenAI-compatible endpoint.',
  },
  {
    name: 'config (missing model)',
    code: 'config',
    run: (locale) => narrateError({ locale, config: { provider: 'openai', baseUrl: 'https://api.example.com/v1' } }),
    zh: '请填写模型名称。',
    en: 'Enter a model name.',
  },
  {
    name: 'config (cleartext-http key guard)',
    code: 'config',
    run: (locale) => narrateError({ locale, config: { provider: 'openai', apiKey: 'sk-cleartext-0000', baseUrl: 'http://api.example.com/v1', model: 'm' } }),
    zh: '为保护密钥，非本机端点必须使用 https://（当前：http://api.example.com）',
    en: 'To protect your API key, any endpoint other than this machine must use https:// (current: http://api.example.com).',
  },
  {
    name: 'config (buildAnthropicRequest key guard)',
    code: 'config',
    run: async (locale) => {
      try {
        I.buildAnthropicRequest({ apiKey: 'sk-ant-x', baseUrl: 'http://proxy.example.com' }, 's', 'u', { locale });
      } catch (err) {
        return err;
      }
      throw new Error('expected a throw');
    },
    zh: '为保护密钥，非本机端点必须使用 https://（当前：http://proxy.example.com）',
    en: 'To protect your API key, any endpoint other than this machine must use https:// (current: http://proxy.example.com).',
  },
  {
    name: 'config (registerProvider: invalid id)',
    code: 'config',
    run: (locale) => withI18n({ getLocale: () => locale }, async () => {
      try {
        LLM.registerProvider('bad id!', { run: () => '' });
      } catch (err) {
        return err;
      }
      throw new Error('expected a throw');
    }),
    zh: '无效的提供方 ID：bad id!',
    en: 'Invalid provider ID: bad id!',
  },
  {
    name: 'config (registerProvider: no run)',
    code: 'config',
    run: (locale) => withI18n({ getLocale: () => locale }, async () => {
      try {
        LLM.registerProvider('i18n-no-run', {});
      } catch (err) {
        return err;
      }
      throw new Error('expected a throw');
    }),
    zh: '提供方「i18n-no-run」缺少 run 函数。',
    en: 'Provider "i18n-no-run" is missing a run function.',
  },
  {
    name: 'bad_response (empty stream)',
    code: 'bad_response',
    run: (locale) => withFetch(fetchOnce(() => streamResponse('')), () => narrateError({ locale })),
    zh: 'AI 服务没有返回任何讲解内容（流式响应为空）。',
    en: 'The AI service returned no narration (the streamed response was empty).',
  },
  {
    name: 'bad_response (not JSON)',
    code: 'bad_response',
    run: (locale) => withFetch(fetchOnce(() => jsonResponse(200, '{oops')), () => narrateError({ locale })),
    zh: 'AI 服务返回了无法解析的内容（不是 JSON）。',
    en: 'The AI service returned content that could not be parsed (not JSON).',
  },
  {
    name: 'bad_response (JSON null)',
    code: 'bad_response',
    run: (locale) => withFetch(fetchOnce(() => jsonResponse(200, 'null')), () => narrateError({ locale })),
    zh: 'AI 服务返回了空响应。',
    en: 'The AI service returned an empty response.',
  },
  {
    name: 'bad_response (OpenAI endpoint without text)',
    code: 'bad_response',
    run: (locale) => withFetch(fetchOnce(() => streamResponse('data: [DONE]\n\n')),
      () => narrateError({ locale, config: { provider: 'openai', baseUrl: 'https://api.example.com/v1', model: 'm' } })),
    zh: '端点没有返回任何文本：请确认模型名称正确，且该端点支持 chat/completions 流式接口。',
    en: 'The endpoint returned no text. Make sure the model name is correct and that the endpoint supports streaming chat/completions.',
  },
  {
    name: 'bad_response (SSE line over 1 MB)',
    code: 'bad_response',
    run: async (locale) => {
      const parser = I.createSSEParser(() => {}, { locale });
      try {
        parser.push('data: ' + 'x'.repeat(I.MAX_SSE_LINE + 1));
      } catch (err) {
        return err;
      }
      throw new Error('expected a throw');
    },
    zh: 'AI 服务返回了超过 1 MB 的单行数据，这不像流式讲解，已停止读取。',
    en: "The AI service sent a single line longer than 1 MB. That doesn't look like a streamed narration, so reading stopped.",
  },
  {
    name: 'bad_response (provider returned nothing)',
    code: 'bad_response',
    run: (locale) => {
      LLM.registerProvider('i18n-empty', { run: async () => '   ' });
      return narrateError({ locale, config: { provider: 'i18n-empty' } });
    },
    zh: 'AI 讲解员没有返回任何文字。',
    en: 'The AI docent returned no text.',
  },
  {
    name: 'bad_response (provider crashed)',
    code: 'bad_response',
    run: (locale) => {
      LLM.registerProvider('i18n-crash', { run: async () => { throw new Error('weird state'); } });
      return narrateError({ locale, config: { provider: 'i18n-crash' } });
    },
    zh: '处理 AI 响应时出错：weird state',
    en: 'Something went wrong while processing the AI response: weird state',
  },
];

test('llm-i18n: every LLMError code has its zh-CN text unchanged and an English en-US text', async () => {
  const codes = new Set();
  for (const sc of SCENARIOS) {
    for (const locale of LOCALES) {
      // I18n says the opposite language: the explicit locale must win.
      const other = locale === 'en-US' ? zhI18n() : enI18n();
      const err = await withI18n(other, () => sc.run(locale));
      assert.equal(err.code, sc.code, `${sc.name} [${locale}] code (message: ${err.message})`);
      assert.equal(err.message, locale === 'en-US' ? sc.en : sc.zh, `${sc.name} [${locale}]`);
      if (locale === 'en-US') assert.deepEqual(cjkOutside(err.message, ''), [], `${sc.name}: English only`);
    }
    codes.add(sc.code);
  }
  for (const code of ['config', 'auth', 'network', 'rate_limit', 'overloaded', 'refusal', 'http', 'aborted', 'bad_response']) {
    assert.ok(codes.has(code), `scenario for ${code}`);
  }
});

test('llm-i18n: errors follow MBX.I18n when narrate gets no locale', async () => {
  await withI18n(enI18n(), async () => {
    const err = await withFetch(() => { throw new TypeError('Failed to fetch'); }, () => narrateError({}));
    assert.ok(err.message.startsWith("Couldn't reach api.anthropic.com"), err.message);
  });
  await withI18n(undefined, async () => {
    const err = await withFetch(() => { throw new TypeError('Failed to fetch'); }, () => narrateError({}));
    assert.ok(err.message.startsWith('无法连接到 api.anthropic.com'), err.message);
  });
});

test('llm-i18n: testConnection messages in both locales (zh-CN unchanged)', async () => {
  const cases = [
    {
      name: 'provider none',
      run: (loc) => LLM.testConnection({ provider: 'none' }, loc),
      zh: { ok: false, message: '当前未启用 AI 讲解员，将使用内置模板讲解。' },
      en: { ok: false, message: 'The AI docent is off; the built-in docent will give the tour.' },
    },
    {
      name: 'missing key',
      run: (loc) => LLM.testConnection({ provider: 'anthropic' }, loc),
      zh: { ok: false, message: '请先在设置中填写 Anthropic Claude 的 API Key。', code: 'config' },
      en: { ok: false, message: 'Enter the API key for Anthropic Claude in Museum Settings first.', code: 'config' },
    },
    {
      name: 'cleartext http',
      run: (loc) => LLM.testConnection({ provider: 'openai', apiKey: 'sk-cleartext-0000', baseUrl: 'http://api.example.com/v1', model: 'm' }, loc),
      zh: { ok: false, message: '为保护密钥，非本机端点必须使用 https://（当前：http://api.example.com）', code: 'config' },
      en: { ok: false, message: 'To protect your API key, any endpoint other than this machine must use https:// (current: http://api.example.com).', code: 'config' },
    },
    {
      name: 'anthropic ok',
      run: (loc) => withFetch(fetchOnce(() => jsonResponse(200, { type: 'message', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'pong' }] })),
        () => LLM.testConnection(ANT_CFG, loc)),
      zh: { ok: true, message: '连接成功：claude-opus-5-5 已就位（api.anthropic.com）。' },
      en: { ok: true, message: 'Connected: claude-opus-5-5 is ready (api.anthropic.com).' },
    },
    {
      name: 'openai ok',
      run: (loc) => withFetch(fetchOnce(() => jsonResponse(200, { model: 'deepseek-chat', choices: [{ message: { content: 'OK' } }] })),
        () => LLM.testConnection({ provider: 'openai', apiKey: 'sk-ds-0000000', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }, loc)),
      zh: { ok: true, message: '连接成功：deepseek-chat 已就位（api.deepseek.com）。' },
      en: { ok: true, message: 'Connected: deepseek-chat is ready (api.deepseek.com).' },
    },
    {
      name: 'auth failure',
      run: (loc) => withFetch(fetchOnce(() => jsonResponse(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } })),
        () => LLM.testConnection(ANT_CFG, loc)),
      zh: { ok: false, message: '鉴权失败（HTTP 401）：API Key 无效、已过期，或无权使用该模型。服务器说明：invalid x-api-key', code: 'auth' },
      en: { ok: false, message: "Authentication failed (HTTP 401): the API key is invalid or expired, or it doesn't have access to this model. Server says: invalid x-api-key", code: 'auth' },
    },
    {
      name: 'unreachable',
      run: (loc) => withFetch(() => { throw new TypeError('Failed to fetch'); },
        () => LLM.testConnection({ provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' }, loc)),
      zh: { ok: false, message: '无法连接到 localhost:11434：可能是网络离线、代理或防火墙拦截，也可能是该端点不允许浏览器直接跨域访问（CORS）。本地服务（如 Ollama）需先允许本页面来源跨域，例如设置环境变量 OLLAMA_ORIGINS=*。', code: 'network' },
      en: { ok: false, message: "Couldn't reach localhost:11434: the network may be offline, a proxy or firewall may be blocking the request, or the endpoint may not allow direct cross-origin requests from a browser (CORS). A local server such as Ollama must first allow this page's origin, for example by setting the environment variable OLLAMA_ORIGINS=*.", code: 'network' },
    },
  ];
  for (const c of cases) {
    const zh = await withI18n(enI18n(), () => c.run('zh-CN'));
    assert.deepEqual(zh, c.zh, `${c.name} [zh-CN]`);
    const en = await withI18n(zhI18n(), () => c.run('en-US'));
    assert.deepEqual(en, c.en, `${c.name} [en-US]`);
    assert.deepEqual(cjkOutside(en.message, ''), [], c.name);
    // No locale argument: MBX.I18n decides.
    const viaI18n = await withI18n(enI18n(), () => c.run(undefined));
    assert.deepEqual(viaI18n, c.en, `${c.name} [I18n en-US]`);
  }
});

test('llm-i18n: request shape is locale-independent; the OpenAI param retry still works in en-US', async () => {
  const shapes = {};
  for (const locale of LOCALES) {
    await withFetch(fetchOnce(() => streamResponse(SSE_TEXT + sse('message_delta', { delta: { stop_reason: 'end_turn' } }) + sse('message_stop', {}))), async (calls) => {
      const out = await LLM.narrate(sampleResult(), { style: 'humor', facts: null, config: ANT_CFG, locale });
      assert.equal(out.text, 'partial words');
      const c = calls[0];
      const body = Object.assign({}, c.body, { system: typeof c.body.system, messages: c.body.messages.map((m) => ({ role: m.role, content: typeof m.content })) });
      shapes[locale] = { url: c.url, headers: c.init.headers, body };
    });
  }
  assert.deepEqual(shapes['en-US'], shapes['zh-CN'], 'same url, headers and body keys in both locales');
  assert.equal(shapes['en-US'].body.fallbacks, 'default');
  assert.equal(shapes['en-US'].headers['anthropic-beta'], 'server-side-fallback-2026-07-01');

  const oaCfg = { provider: 'openai', apiKey: 'sk-oa-0000000', baseUrl: 'https://api.openai.example/v1', model: 'o-reasoner' };
  await withFetch((url, init, i) => {
    if (i === 0) return jsonResponse(400, { error: { message: "Unsupported value: 'temperature' does not support 0.9 with this model.", type: 'invalid_request_error' } });
    return streamResponse('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n');
  }, async (calls) => {
    const out = await LLM.narrate(sampleResult(), { style: 'humor', facts: null, config: oaCfg, locale: 'en-US' });
    assert.equal(out.text, 'Hi');
    assert.equal(calls.length, 2, 'retried once');
    assert.ok(!('temperature' in calls[1].body));
  });
  // The English wrapper text itself never looks like an "unsupported parameter" complaint.
  await withFetch(() => jsonResponse(400, { error: { message: 'context too long' } }), async (calls) => {
    const err = await narrateError({ config: oaCfg, locale: 'en-US' });
    assert.equal(err.code, 'http');
    assert.equal(calls.length, 1, 'no retry');
  });
});
