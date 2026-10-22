'use strict';
// End-to-end smoke tests across module boundaries:
//   Forge relic -> Engine.analyze -> Narrator.narrate (every style) -> LLM.buildPrompt / LLM.narrate
//   -> MBX.App.util (the UI's pure helpers),
// plus static checks that keep index.html and src/*.js loadable as classic scripts under file://.
// Unit behaviour lives in the per-module test files; this file only checks that the pieces fit.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const ROOT = path.join(__dirname, '..');
// app.js exports its pure helpers (MBX.App) and skips the DOM controller when there is no document.
const App = require(path.join(ROOT, 'src', 'app.js'));

// docs/ARCHITECTURE.md §0: classic scripts, loaded in this order.
// i18n.js comes first and the en-US docent pack right after the narrator (§11).
const SCRIPT_ORDER = ['i18n', 'lexicon', 'codecs', 'scorer', 'forge', 'engine', 'narrator', 'narrator-en', 'llm', 'app'];
const STATUSES = ['restored', 'clean', 'irrecoverable', 'partial', 'unknown'];
const SECTION_IDS = ['opening', 'identify', 'mechanism', 'dating', 'repair', 'conservation', 'easter', 'closing'];
const LEAKS = /undefined|NaN|\[object Object\]/;
const FFFD = String.fromCodePoint(0xfffd);
const BS = String.fromCharCode(0x5c); // a backslash, spelled out so no tool can "unescape" it

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const count = (s, needle) => s.split(needle).length - 1;

// Analyse every gallery relic once; several tests below share the results.
let galleryCache = null;
function gallery() {
  if (!galleryCache) {
    galleryCache = MBX.Forge.GALLERY.map((item) => ({ item, result: MBX.Engine.analyze(item.relic) }));
  }
  return galleryCache;
}

// Inputs chosen so that, together with the gallery, every status and every signature family
// passes through the narrator and the prompt builder at least once.
function edgeCases() {
  const gbk = (...b) => MBX.Codecs.decode('gbk', Uint8Array.from(b)).text;
  const w1252 = (...b) => MBX.Codecs.decode('windows-1252', Uint8Array.from(b)).text;
  const unknown = MBX.Forge.corrupt('报告.docx', [
    { encoding: 'gbk', misreadAs: 'windows-1252' },
    { encoding: 'utf-8', misreadAs: 'windows-1252' },
  ]);
  return {
    'clean-mixed': { input: 'Hello, world! 你好，世界。', status: 'clean' },
    'clean-ascii': { input: 'just ascii', status: 'clean' },
    qiqiqi: { input: gbk(0xdd, 0xdd, 0xdd, 0xdd, 0xdd, 0xdd), status: 'irrecoverable', sig: 'qiqiqi' },
    tuntuntun: { input: gbk(0xcd, 0xcd, 0xcd, 0xcd), status: 'irrecoverable', sig: 'tuntuntun' },
    'question-marks': { input: '?????? ???? ??', status: 'irrecoverable', sig: 'question-marks' },
    'utf16-nul': {
      input: w1252(0x48, 0, 0x65, 0, 0x6c, 0, 0x6c, 0, 0x6f, 0, 0x20, 0, 0x57, 0, 0x6f, 0, 0x72, 0, 0x6c, 0, 0x64, 0),
      status: 'restored', sig: 'utf16-nul', expect: 'Hello World',
    },
    'utf16-bom': { input: w1252(0xff, 0xfe, 0x48, 0, 0x69, 0), status: 'restored', sig: 'utf16-bom', expect: 'Hi' },
    'bom-partial': { input: 'ï»¿Hello 文档', status: 'partial', sig: 'utf8-bom-1252' },
    'gbk-then-utf8-unknown': { input: unknown.output, status: 'unknown' },
    'html-entity': { input: '&#20320;&#x597D;&amp;世界', status: 'restored', expect: '你好&世界' },
    'hex-escape': { input: [BS + 'xe4', BS + 'xbd', BS + 'xa0', BS + 'xe5', BS + 'xa5', BS + 'xbd'].join(''), status: 'restored', expect: '你好' },
    'hex-dump': { input: 'E5 A4 A7 E5 AE B6 E5 A5 BD', status: 'restored', expect: '大家好' },
    'long-sampled': { input: 'å¤§å®¶å¥½'.repeat(300), status: 'restored', expect: '大家好'.repeat(300), truncated: true },
  };
}

// Shared Narration shape checks (docs/ARCHITECTURE.md §7).
function checkNarration(n, where) {
  assert.ok(n && typeof n === 'object', `${where}: narration object`);
  assert.ok(/^MBX-\d{4}-[0-9A-F]{4}$/.test(n.exhibitId), `${where}: exhibitId ${n.exhibitId}`);
  for (const k of ['title', 'subtitle', 'site', 'plainText']) {
    assert.equal(typeof n[k], 'string', `${where}: ${k} is a string`);
  }
  assert.ok(n.title && n.plainText.trim(), `${where}: title and plainText are not empty`);
  assert.ok(n.era && typeof n.era.label === 'string' && n.era.label, `${where}: era label`);
  assert.ok(Array.isArray(n.tags), `${where}: tags array`);
  assert.ok(Array.isArray(n.sections) && n.sections.length >= 3, `${where}: has sections`);
  const seen = new Set();
  for (const s of n.sections) {
    assert.ok(SECTION_IDS.includes(s.id), `${where}: known section id ${s.id}`);
    assert.ok(!seen.has(s.id), `${where}: section ${s.id} appears once`);
    seen.add(s.id);
    assert.ok(typeof s.heading === 'string' && s.heading, `${where}/${s.id}: heading`);
    assert.ok(typeof s.text === 'string' && s.text.trim(), `${where}/${s.id}: text`);
    // §7 mini-markup must be balanced or the UI would render stray ** / ` characters.
    assert.equal(count(s.text, '**') % 2, 0, `${where}/${s.id}: balanced **`);
    assert.equal(count(s.text.replace(/\*\*/g, ''), '`') % 2, 0, `${where}/${s.id}: balanced backticks`);
  }
  for (const k of ['title', 'subtitle', 'site', 'plainText']) {
    assert.ok(!LEAKS.test(n[k]), `${where}: no leaked template value in ${k}: ${(n[k].match(/.{0,20}(undefined|NaN|\[object Object\]).{0,20}/) || [''])[0]}`);
  }
  assert.ok(!n.plainText.includes('**'), `${where}: plainText carries no markup`);
}

// ---------------------------------------------------------------------------
// Static checks: the page must keep working when index.html is double-clicked.
// ---------------------------------------------------------------------------

test('integration: every src file passes node --check', () => {
  for (const name of SCRIPT_ORDER) {
    const file = path.join(ROOT, 'src', `${name}.js`);
    assert.ok(fs.existsSync(file), `src/${name}.js exists`);
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(res.status, 0, `node --check src/${name}.js: ${res.stderr}`);
  }
});

test('integration: index.html loads the stylesheet and classic scripts in contract order', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  assert.ok(scripts.every((attrs) => !/type\s*=\s*["']?module/i.test(attrs)), 'no ES module scripts (blocked under file://)');
  const srcs = scripts.map((attrs) => (attrs.match(/\bsrc="([^"]+)"/) || [])[1]).filter(Boolean);
  assert.deepEqual(srcs, SCRIPT_ORDER.map((n) => `src/${n}.js`), 'script order matches docs/ARCHITECTURE.md §0');
  assert.ok(html.includes('<link rel="stylesheet" href="assets/styles.css">'), 'local stylesheet is linked');
  assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'styles.css')), 'assets/styles.css exists');
  // Every local reference must be relative: absolute paths break when the folder is opened via file://.
  const localRefs = [...html.matchAll(/\b(?:src|href)="([^"#][^"]*)"/g)].map((m) => m[1])
    .filter((u) => !/^(?:https?:|data:)/.test(u));
  for (const ref of localRefs) {
    assert.ok(!ref.startsWith('/'), `relative reference: ${ref}`);
    assert.ok(fs.existsSync(path.join(ROOT, ref)), `referenced file exists: ${ref}`);
  }
});

test('integration: every element id app.js caches exists exactly once in index.html', () => {
  const html = read('index.html');
  const app = read('src/app.js');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [], 'no duplicate ids');
  const block = app.match(/const ids = \[([\s\S]*?)\];/);
  assert.ok(block, 'found the cacheEls id list in app.js');
  const wanted = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(wanted.length > 50, 'id list parsed');
  assert.deepEqual(wanted.filter((id) => !ids.includes(id)), [], 'ids missing from index.html');
});

test('integration: src files are classic scripts that never fetch local data', () => {
  for (const name of SCRIPT_ORDER) {
    const code = read(`src/${name}.js`);
    assert.ok(!/^\s*(?:import|export)\s/m.test(code), `src/${name}.js has no ES module syntax`);
    assert.ok(/\}\)\(typeof globalThis !== 'undefined' \? globalThis : this\);\s*$/.test(code), `src/${name}.js ends with the §0 wrapper`);
    // Only the optional AI channel talks to the network, and only to user-configured endpoints.
    if (name !== 'llm') assert.ok(!/\bfetch\s*\(|XMLHttpRequest/.test(code), `src/${name}.js does not fetch`);
  }
});

test('integration: every MBX module named in the contract is loaded', () => {
  for (const name of ['I18n', 'Lexicon', 'Codecs', 'Scorer', 'Forge', 'Engine', 'Narrator', 'LLM', 'App']) {
    assert.ok(MBX[name], `MBX.${name} is defined`);
  }
  assert.equal(MBX.App, App, 'app.js registers MBX.App and module.exports alike');
});

// ---------------------------------------------------------------------------
// Engine on the curated gallery
// ---------------------------------------------------------------------------

test('integration: Engine.analyze restores every gallery relic through a coherent chain', () => {
  assert.ok(gallery().length >= 15, 'gallery has 15+ relics');
  for (const { item, result } of gallery()) {
    const where = `gallery ${item.id}`;
    assert.ok(STATUSES.includes(result.status), `${where}: status ${result.status}`);
    assert.equal(result.input, item.relic, `${where}: input echoed`);
    if (item.expect === null) {
      assert.equal(result.status, 'irrecoverable', `${where}: lost bytes are reported as irrecoverable`);
    } else {
      assert.equal(result.status, 'restored', `${where}: status`);
      assert.equal(result.best.output, item.expect, `${where}: restored text`);
    }
    const hyps = [result.best].concat(result.alternatives).filter(Boolean);
    const outputs = hyps.map((h) => h.output);
    assert.equal(new Set(outputs).size, outputs.length, `${where}: alternatives have distinct outputs`);
    hyps.forEach((h, k) => {
      const at = `${where}#${k}`;
      assert.ok(h.confidence >= 0 && h.confidence <= 1, `${at}: confidence in [0,1]`);
      assert.ok(typeof h.label === 'string' && h.label, `${at}: label`);
      assert.ok(h.lang && typeof h.lang.name === 'string', `${at}: lang`);
      assert.ok(h.steps.length >= 1, `${at}: has steps`);
      // steps[0] touches the input, steps[n-1] yields the output, and each layer feeds the next.
      assert.equal(h.steps[0].before, result.input, `${at}: steps[0].before is the input`);
      assert.equal(h.steps[h.steps.length - 1].after, h.output, `${at}: last step yields the output`);
      h.steps.forEach((s, i) => {
        if (i + 1 < h.steps.length) assert.equal(s.after, h.steps[i + 1].before, `${at}: layer ${i} feeds layer ${i + 1}`);
        assert.ok(s.kind === 'transcode' || s.kind === 'unescape', `${at}: step kind`);
        assert.ok(s.bytes === null || s.bytes instanceof Uint8Array, `${at}: bytes type`);
        for (const key of ['segmentsBefore', 'segmentsAfter']) {
          const segs = s[key];
          if (segs === null) continue;
          const text = key === 'segmentsBefore' ? s.before : s.after;
          assert.equal(segs.map((x) => x.ch).join(''), text, `${at}: ${key} spell out the layer text`);
          assert.ok(segs.every((x) => x.start <= x.end && x.end <= s.bytes.length), `${at}: ${key} ranges inside bytes`);
        }
      });
      assert.equal(MBX.Engine.applyChain(result.input, h.steps).output, h.output, `${at}: applyChain reproduces the output`);
    });
  }
});

// ---------------------------------------------------------------------------
// Narrator on real engine output
// ---------------------------------------------------------------------------

test('integration: Narrator narrates every gallery relic in every style, deterministically', () => {
  const styles = MBX.Narrator.STYLES.map((s) => s.id);
  assert.deepEqual(styles.slice().sort(), ['academic', 'humor', 'snark'], 'the three §7 styles');
  for (const { item, result } of gallery()) {
    const texts = new Set();
    for (const style of styles) {
      for (const seed of [0, 7]) {
        const where = `${item.id}/${style}/${seed}`;
        const n = MBX.Narrator.narrate(result, { style, seed });
        checkNarration(n, where);
        assert.equal(n.style, style, `${where}: style honoured`);
        assert.equal(MBX.Narrator.narrate(result, { style, seed }).plainText, n.plainText, `${where}: deterministic`);
        if (item.expect) assert.ok(n.plainText.includes(item.expect), `${where}: names the restored text`);
        texts.add(n.plainText);
      }
    }
    assert.ok(texts.size >= 3, `${item.id}: styles and seeds produce different narrations`);
  }
});

test('integration: narration quotes real bytes from the deepest layer', () => {
  for (const { item, result } of gallery()) {
    const steps = result.best ? result.best.steps : [];
    const deep = steps[steps.length - 1];
    if (!deep || !deep.bytes || !deep.segmentsAfter) continue;
    // Hex of every non-ASCII original character, e.g. 'E5 A4 A7' for 大 in UTF-8.
    const hexes = deep.segmentsAfter
      .filter((s) => s.end > s.start && s.ch.codePointAt(0) > 0x7f)
      .map((s) => MBX.Codecs.hex(deep.bytes, s.start, s.end));
    if (!hexes.length) continue;
    const n = MBX.Narrator.narrate(result, { style: 'academic', seed: 1 });
    const mech = n.sections.find((s) => s.id === 'mechanism');
    assert.ok(mech, `${item.id}: has a mechanism section`);
    assert.ok(hexes.some((hx) => mech.text.includes(hx)), `${item.id}: mechanism cites one of ${hexes.slice(0, 3).join(' / ')}`);
  }
});

test('integration: Narrator.factsFor is JSON-serialisable for every relic', () => {
  for (const { item, result } of gallery()) {
    const facts = MBX.Narrator.factsFor(result);
    const json = JSON.stringify(facts);
    assert.ok(typeof json === 'string' && json.length > 2, `${item.id}: facts serialise`);
    assert.deepEqual(JSON.parse(json), facts, `${item.id}: facts survive a JSON round trip`);
  }
});

// ---------------------------------------------------------------------------
// LLM prompt and provider plumbing (no network)
// ---------------------------------------------------------------------------

test('integration: LLM.buildPrompt grounds every relic in compact, valid JSON', () => {
  for (const { item, result } of gallery()) {
    for (const style of ['humor', 'academic', 'snark']) {
      const where = `${item.id}/${style}`;
      const narration = MBX.Narrator.narrate(result, { style, seed: 2 });
      const facts = MBX.Narrator.factsFor(result);
      for (const p of [MBX.LLM.buildPrompt(result, narration, facts, style), MBX.LLM.buildPrompt(result, narration, undefined, style)]) {
        assert.ok(typeof p.system === 'string' && p.system.includes('文物保护建议'), `${where}: system prompt sets the docent task`);
        assert.ok(p.user.length <= 8000, `${where}: user message within budget (${p.user.length})`);
        const payload = JSON.parse(p.user);
        assert.equal(payload.status, result.status, `${where}: status`);
        assert.equal(payload.style, style, `${where}: style`);
        assert.ok(payload.facts, `${where}: facts included (explicit or via Narrator.factsFor)`);
        assert.equal(payload.exhibit.id, narration.exhibitId, `${where}: exhibit id from the narration`);
        if (result.best) {
          assert.equal(payload.chain, result.best.label, `${where}: chain label`);
          assert.equal(payload.steps.length, Math.min(result.best.steps.length, 6), `${where}: one entry per layer`);
          if (result.best.output.length <= 40) assert.equal(payload.output, result.best.output, `${where}: output`);
        }
      }
    }
  }
  // The headline exhibit must hand the model its real byte evidence.
  const dajia = gallery().find((g) => g.item.relic === 'å¤§å®¶å¥½');
  assert.ok(dajia, 'gallery contains the 大家好 classic');
  assert.ok(MBX.LLM.buildPrompt(dajia.result, null, null, 'humor').user.includes('E5 A4 A7'), 'prompt cites E5 A4 A7');
});

test('integration: LLM.narrate streams an engine result through a registered provider', async () => {
  const { result } = gallery().find((g) => g.item.relic === 'å¤§å®¶å¥½');
  const narration = MBX.Narrator.narrate(result, { style: 'snark', seed: 0 });
  let received = null;
  MBX.LLM.registerProvider('integration-mock', {
    name: '集成测试讲解员',
    defaultModel: 'mock-1',
    run: async (args) => {
      received = args;
      args.onText('### 鉴定\n');
      args.onText('字节 `E5 A4 A7` 就是「大」。');
      return { text: '### 鉴定\n字节 `E5 A4 A7` 就是「大」。', stopReason: 'end_turn' };
    },
  });
  const config = { provider: 'integration-mock' };
  assert.ok(MBX.LLM.isReady(config), 'custom provider is ready without a key');
  const fulls = [];
  const out = await MBX.LLM.narrate(result, {
    style: 'snark',
    narration,
    facts: MBX.Narrator.factsFor(result),
    config,
    onText: (delta, full) => fulls.push(full),
  });
  assert.equal(out.provider, 'integration-mock');
  assert.equal(out.model, 'mock-1');
  assert.ok(out.text.includes('E5 A4 A7'), 'final text returned');
  assert.equal(fulls[fulls.length - 1], out.text, 'onText accumulates the full text');
  const payload = JSON.parse(received.user);
  assert.equal(payload.output, '大家好', 'provider receives the engine output');
  assert.equal(payload.style, 'snark', 'provider receives the requested style');
});

// ---------------------------------------------------------------------------
// The UI's pure helpers on real engine output
// ---------------------------------------------------------------------------

test('integration: App helpers render byte grids, reports and promoted alternatives', () => {
  const U = App.util;
  for (const { item, result } of gallery()) {
    const normalized = U.normalizeResult(result, item.relic);
    const view = U.deriveView(normalized, null);
    assert.equal(view.best, normalized.best, `${item.id}: engine verdict view`);
    for (const step of view.best ? view.best.steps : []) {
      const model = U.buildGridModel(step, 48);
      if (!step.bytes || !step.bytes.length) {
        assert.equal(model, null, `${item.id}: no grid without bytes`);
        continue;
      }
      assert.equal(model.shown, Math.min(48, step.bytes.length), `${item.id}: first 48 bytes shown`);
      assert.equal(model.hex.join(' '), MBX.Codecs.hex(step.bytes, 0, model.shown), `${item.id}: hex row`);
      for (const it of model.top.concat(model.bottom)) {
        assert.ok(it.start >= 0 && it.start <= model.shown, `${item.id}: block inside the grid`);
        if (!it.gap) assert.ok(it.span >= 1 && it.start + it.span <= model.shown, `${item.id}: block span fits`);
      }
      assert.ok(model.bottom.length >= 1, `${item.id}: restored row has characters`);
    }
    const n = MBX.Narrator.narrate(view, { style: 'humor', seed: 0 });
    const md = U.buildMarkdownReport({ view, narrationText: n.plainText, exhibitId: n.exhibitId, date: new Date(2026, 0, 2, 3, 4) });
    assert.ok(md.startsWith(`# 乱码考古鉴定报告 · ${n.exhibitId}`), `${item.id}: report heading`);
    assert.ok(md.includes(item.relic), `${item.id}: report quotes the relic`);
    if (view.best) assert.ok(md.includes(view.best.output), `${item.id}: report quotes the restored text`);
    assert.ok(!LEAKS.test(md.replace(n.plainText, '')), `${item.id}: report has no leaked values`);

    // Clicking "其他考古学家的看法" promotes an alternative; it must narrate and prompt cleanly too.
    U.hypotheses(normalized).forEach((hyp, i) => {
      const promoted = U.deriveView(normalized, i);
      assert.equal(promoted.best, hyp, `${item.id}: alternative ${i} promoted`);
      const pn = MBX.Narrator.narrate(promoted, { style: 'academic', seed: i });
      checkNarration(pn, `${item.id}/alt${i}`);
      JSON.parse(MBX.LLM.buildPrompt(promoted, pn, undefined, 'academic').user);
    });
  }
});

// ---------------------------------------------------------------------------
// Forged relics and edge inputs
// ---------------------------------------------------------------------------

test('integration: relics forged from every Forge preset come back through the full pipeline', () => {
  assert.ok(MBX.Forge.PRESETS.length >= 20, 'presets cover the §8 pairs');
  for (const p of MBX.Forge.PRESETS) {
    const forged = MBX.Forge.corrupt(p.sample, p.chain, p.opts);
    assert.ok(forged.ok, `${p.id}: forge succeeds (${forged.error || ''})`);
    const result = MBX.Engine.analyze(forged.output);
    const where = `preset ${p.id}`;
    assert.ok(STATUSES.includes(result.status), `${where}: status`);
    if (!forged.output.includes(FFFD)) {
      // Nothing was lost while forging, so the original must come back exactly.
      assert.equal(result.status, 'restored', `${where}: status`);
      assert.equal(result.best.output, p.sample, `${where}: restored text`);
    } else {
      assert.ok(result.status !== 'clean', `${where}: damaged relic is not called clean`);
    }
    const n = MBX.Narrator.narrate(result, { style: 'humor', seed: 0 });
    checkNarration(n, where);
    assert.ok(MBX.LLM.buildPrompt(result, n, undefined, 'humor').user.length <= 8000, `${where}: prompt budget`);
  }
});

test('integration: edge inputs cover every status and signature family without breaking', () => {
  const statuses = new Set();
  for (const [name, c] of Object.entries(edgeCases())) {
    const result = MBX.Engine.analyze(c.input);
    statuses.add(result.status);
    assert.equal(result.status, c.status, `${name}: status`);
    if (c.expect) assert.equal(result.best.output, c.expect, `${name}: restored text`);
    if (c.sig) assert.ok(result.signatures.some((s) => s.id === c.sig), `${name}: signature ${c.sig}`);
    if (c.truncated) assert.equal(result.stats.truncated, true, `${name}: long input searched on a sample`);
    if (result.status === 'clean') assert.equal(result.best, null, `${name}: clean has no best`);
    for (const style of ['humor', 'academic', 'snark']) {
      const n = MBX.Narrator.narrate(result, { style, seed: 5 });
      checkNarration(n, `${name}/${style}`);
      const payload = JSON.parse(MBX.LLM.buildPrompt(result, n, undefined, style).user);
      assert.equal(payload.status, result.status, `${name}/${style}: prompt status`);
    }
    App.util.buildMarkdownReport({ view: App.util.deriveView(App.util.normalizeResult(result, c.input), null) });
  }
  assert.deepEqual([...statuses].sort(), STATUSES.slice().sort(), 'all five statuses exercised');
});

test('integration: engine-only signatures and code-point escapes get proper narration', () => {
  const cases = edgeCases();
  // qiqiqi / utf16-nul are engine extensions; the narrator must explain them, not fall back.
  for (const id of ['qiqiqi', 'utf16-nul']) {
    assert.ok(MBX.Engine.SIGNATURES.some((s) => s.id === id), `engine defines ${id}`);
    assert.ok(MBX.Narrator.SIGNATURE_FACTS[id], `narrator has facts for ${id}`);
  }
  for (const sig of MBX.Engine.SIGNATURES) {
    assert.ok(MBX.Narrator.SIGNATURE_FACTS[sig.id], `every engine signature has narrator facts: ${sig.id}`);
  }
  const qi = MBX.Narrator.narrate(MBX.Engine.analyze(cases.qiqiqi.input), { style: 'academic', seed: 0 });
  assert.ok(qi.plainText.includes('0xDD'), 'qiqiqi narration explains the 0xDD fill byte');
  assert.ok(qi.era.label !== '年代不详', 'qiqiqi narration is dated');
  // \u and &#…; escapes carry code points, so the deepest "encoding" is Unicode, not unknown.
  const ent = MBX.Narrator.narrate(MBX.Engine.analyze(cases['html-entity'].input), { style: 'humor', seed: 0 });
  assert.ok(ent.title.includes('Unicode') && !ent.title.includes('未知编码'), `entity title: ${ent.title}`);
  assert.ok(!ent.subtitle.includes('未知编码'), `entity subtitle: ${ent.subtitle}`);
});

test('integration: untraceable repairs (index -1) are worded as "somewhere", never "char 0"', () => {
  const { result } = gallery().find((g) => g.result.best && g.result.best.repairs.length) || {};
  assert.ok(result, 'gallery has a repaired relic');
  const best = Object.assign({}, result.best, {
    repairs: result.best.repairs.map((r) => Object.assign({}, r, { index: -1 })),
  });
  const view = Object.assign({}, result, { best });
  const n = MBX.Narrator.narrate(view, { style: 'academic', seed: 0 });
  assert.ok(!n.plainText.includes('第 0 个字'), 'narrator');
  assert.ok(!App.util.buildMarkdownReport({ view }).includes('第 0 个字'), 'markdown report');
  assert.equal(App.util.repairPosition({ index: -1 }), '某处');
  assert.equal(App.util.repairPosition({ index: 4 }), '第 5 个字');
  const payload = JSON.parse(MBX.LLM.buildPrompt(view, n, null, 'academic').user);
  assert.ok(payload.repairs.length > 0, 'prompt lists the repairs');
  assert.ok(payload.repairs.every((r) => r.position === undefined && r.at === undefined), 'prompt omits untraceable positions');
});
