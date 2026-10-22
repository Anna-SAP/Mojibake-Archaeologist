'use strict';
// End-to-end en-US leak guard (docs/ARCHITECTURE.md §11.2): with the interface in English, every
// user-visible text the modules produce must be free of Chinese/Japanese/Korean script, except DATA
// (the input, restored outputs, every step's before/after, Seg glyphs, repair from/to/candidates,
// signature and signal matches) and the famous relics' own names (锟斤拷 and friends).
// The same calls in zh-CN must still speak Chinese.
//
// LEAK_VERBOSE=1 node tests/run.js i18n-leak   prints every leak instead of the first few.

const path = require('path');
const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const App = require(path.join(__dirname, '..', 'src', 'app.js'));
const U = App.util;
const { I18n, Engine, Narrator, LLM, Forge, Codecs, Scorer } = MBX;

const EN = 'en-US';
const ZH = 'zh-CN';
const STYLES = ['humor', 'academic', 'snark'];
const SEEDS = [0, 7];

// Han, kana, Hangul, Bopomofo, CJK punctuation and full-width forms: none belongs in English prose.
const CJK = /[ᄀ-ᇿ⺀-⿟　-ヿ㄀-ㇿ㐀-䶿一-鿿ꥠ-꥿가-힯豈-﫿︰-﹏＀-￯]|[\u{20000}-\u{3134f}]/u;
const CJK_RUN = new RegExp(`(?:${CJK.source})+`, 'gu');
const HAN = /\p{Script=Han}/u;

// The relics' own names are data in every language (§11.2): 锟斤拷, 嚙踝蕭 (Big5), the debug-memory
// fills, the GBK reading of a UTF-8 BOM, the "Bush hid the facts" sentence (and its first glyph,
// "Bu" read as U+7542), and 文字化け. The signal hints quote the tell-tale glyphs that UTF-8 leaves
// behind in GBK (锛 銆 鐨) and Shift_JIS (縺 繧 繝): mojibake specimens, also data.
const RELIC_NAMES = ['锟斤拷', '嚙踝蕭', '烫', '屯', '葺', '锘', '畂桳栠摩琠敨映捡獴', '畂', '文字化け',
  '锛', '銆', '鐨', '縺', '繧', '繝'];

function inLocale(locale, fn) {
  const before = I18n.getLocale();
  I18n.setLocale(locale);
  try {
    return fn();
  } finally {
    I18n.setLocale(before);
  }
}

async function inLocaleAsync(locale, fn) {
  const before = I18n.getLocale();
  I18n.setLocale(locale);
  try {
    return await fn();
  } finally {
    I18n.setLocale(before);
  }
}

// Every string inside a value (objects, arrays), skipping functions and byte arrays.
function stringsOf(value, out = [], seen = new Set()) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object' && !seen.has(value) && !ArrayBuffer.isView(value)) {
    seen.add(value);
    for (const v of Array.isArray(value) ? value : Object.values(value)) stringsOf(v, out, seen);
  }
  return out;
}

// The data strings of one analysis: everything the visitor typed or the engine dug up.
function dataOf(r, extra) {
  const data = [];
  const add = (s) => {
    if (typeof s === 'string' && s && CJK.test(s)) data.push(s);
  };
  for (const s of extra || []) add(s);
  if (!r) return data;
  add(r.input);
  const hyps = [r.best].concat(Array.isArray(r.alternatives) ? r.alternatives : []).filter(Boolean);
  for (const h of hyps) {
    add(h.output);
    for (const step of h.steps || []) {
      add(step.before);
      add(step.after);
      for (const seg of (step.segmentsBefore || []).concat(step.segmentsAfter || [])) {
        add(seg && seg.ch);
        for (const c of (seg && seg.candidates) || []) add(c);
      }
      for (const rep of step.repairs || []) [rep.from, rep.to].concat(rep.candidates || []).forEach(add);
    }
    for (const rep of h.repairs || []) [rep.from, rep.to].concat(rep.candidates || []).forEach(add);
  }
  for (const s of r.signatures || []) add(s && s.match);
  for (const s of r.signals || []) add(s && s.match);
  return data;
}

// CJK and full-width punctuation: what a Chinese template leaks most easily into English
// ("：", "，", "（…）"), and too common in the data to be excused glyph by glyph. (Half-width
// katakana and its punctuation, U+FF61–FF9F, is Shift_JIS mojibake, i.e. data.)
const CJK_PUNCT = /[　-〿︰-﹏！-／：-＠［-｀｛-｠￠-￮]/u;

// Quote pairs the narrations and reports put around glyphs they cite.
const QUOTES = { '“': '”', '"': '"', '‘': '’', '`': '`', '「': '」', '『': '』', '«': '»' };

/*
 * Is text[start, end) inside a quotation that holds glyphs only (“你好，世�”, `大`, "，"), as
 * opposed to an English phrase? The nearest opening quote on the same line is paired with its
 * closing quote after the run, and the quoted text must contain no Latin letters.
 */
function inGlyphQuote(text, start, end) {
  for (let i = start - 1; i >= 0 && start - i <= 120; i--) {
    const c = text[i];
    if (c === '\n') return false;
    // Mojibake itself is full of quote marks (â€œ, ‘): try every opener until one pairs up.
    if (!Object.prototype.hasOwnProperty.call(QUOTES, c)) continue;
    const j = text.indexOf(QUOTES[c], end);
    if (j < 0 || j - end > 120) continue;
    const inner = text.slice(i + 1, j);
    if (!inner.includes('\n') && !/[A-Za-z]/.test(inner)) return true;
  }
  return false;
}

// A single glyph cited with its own code point right after it: "考 U+8003", "，(U+FF0C)".
function citesCodePoint(text, run, end) {
  const cps = Array.from(run);
  if (cps.length !== 1) return false;
  const m = /^\s?\(?U\+([0-9A-Fa-f]{4,6})\b/.exec(text.slice(end, end + 12));
  return !!m && parseInt(m[1], 16) === cps[0].codePointAt(0);
}

/*
 * The CJK left in `text` once the data has been cut out of it. Data strings of two or more
 * characters and the relic names are removed by substring (longest first), so a whole input or
 * output is fine, but a stray "：" or "编码" is not excused just because the same glyph occurs
 * somewhere in the data (a per-glyph test would hide a Chinese colon leaking into every English
 * label of a relic whose data holds one). What is left is accepted only when it is
 *   - a run of single data glyphs (Seg glyphs, repair candidates) with no CJK punctuation,
 *   - a quoted citation of glyphs taken from the data (a fragment of an output, “，”), or
 *   - a whole string that is nothing but data glyphs (a fact sheet's { original: '，' }), or
 *   - one data glyph followed by its own code point ("考 U+8003", "， (U+FF0C)").
 */
function leaksIn(text, data) {
  const strings = [...new Set(data.filter((d) => Array.from(d).length >= 2).concat(RELIC_NAMES))]
    .sort((a, b) => b.length - a.length);
  const glyphs = new Set(data.filter((d) => Array.from(d).length === 1));
  let rest = String(text);
  for (const d of strings) if (rest.includes(d)) rest = rest.split(d).join('\u0000');
  const leaks = [];
  for (const m of rest.matchAll(CJK_RUN)) {
    const run = m[0];
    const glyphList = Array.from(run).every((ch) => glyphs.has(ch));
    // Back-to-back data glyphs ("EF BF→锟", a candidate list); never CJK punctuation.
    if (glyphList && !CJK_PUNCT.test(run)) continue;
    const fromData = glyphList || data.some((d) => d.includes(run));
    if (fromData && inGlyphQuote(rest, m.index, m.index + run.length)) continue;
    if (fromData && rest.trim() === run) continue;
    if (fromData && citesCodePoint(rest, run, m.index + run.length)) continue;
    leaks.push(run);
  }
  return leaks;
}

class LeakLog {
  constructor() { this.items = []; }

  check(where, value, data) {
    for (const s of stringsOf(value)) {
      const runs = leaksIn(s, data || []);
      if (runs.length) this.items.push({ where, runs, text: s.length > 160 ? s.slice(0, 160) + '…' : s });
    }
  }

  assertClean(label) {
    if (process.env.LEAK_VERBOSE) for (const l of this.items) console.log(`  [leak] ${l.where}: ${l.runs.join(' ')} :: ${l.text}`);
    const sample = this.items.slice(0, 6).map((l) => `${l.where}: ${l.runs.join(' ')} :: ${l.text}`).join('\n    ');
    assert.equal(this.items.length, 0, `${label}: ${this.items.length} CJK leak(s) in en-US output\n    ${sample}\n `);
  }
}

// ---------------------------------------------------------------------------
// Inputs: every gallery relic plus a spread of statuses, scripts, escapes and famous relics.
// ---------------------------------------------------------------------------

function forged(text, chain, opts) {
  const r = Forge.corrupt(text, chain.map(([encoding, misreadAs]) => ({ encoding, misreadAs })), opts || {});
  if (!r.ok) throw new Error(`forge failed for ${text}: ${r.error}`);
  return r.output;
}

function escaped(text, scheme, encoding) {
  const r = Forge.escape(text, scheme, encoding ? { encoding } : {});
  if (!r.ok) throw new Error(`escape failed for ${text}: ${r.error}`);
  return r.output;
}

const EXTRA_INPUTS = [
  'Hello, world! Nothing to see here.',
  '今天天气很好，我们去公园散步吧。',
  forged('안녕하세요 여러분', [['euc-kr', 'windows-1252']]),
  forged('Привет, как дела?', [['utf-8', 'windows-1251']]),
  forged('Grüße aus München — “Zitat”', [['utf-8', 'windows-1252']]),
  forged('Ελληνικά γράμματα', [['utf-8', 'windows-1252']]),
  forged('שלום עולם', [['utf-8', 'windows-1252']]),
  forged('İstanbul’da güzel bir gün', [['utf-8', 'windows-1252']]),
  forged('Zażółć gęślą jaźń', [['utf-8', 'windows-1252']]),
  forged('日本語のテキストです', [['utf-8', 'windows-1252']]),
  forged('乱码考古', [['utf-8', 'windows-1252'], ['utf-8', 'windows-1252']]),
  forged('数据库连接失败', [['utf-8', 'gbk']]),
  forged('繁體中文測試', [['big5', 'gbk']]),
  forged('大家好，欢迎光临', [['utf-8', 'windows-1252']], { dropInvisible: true }),
  `订单状态：${forged('已发货', [['utf-8', 'windows-1252']])}，请查收`,
  // Partial verdicts whose data holds no CJK punctuation, so a "：" leaking into a label shows.
  `订单状态 ${forged('已发货', [['utf-8', 'windows-1252']])} 请查收`,
  `状态: ${forged('已发货', [['utf-8', 'windows-1252']])} - thanks`,
  `Статус заказа: ${forged('отправлен', [['utf-8', 'windows-1252']])} - спасибо`,
  escaped('数据库连接失败', 'percent'),
  escaped('文件名', 'hex-escape'),
  escaped('编码测试', 'quoted-printable'),
  escaped('你好世界', 'hex-dump'),
  escaped('考古学', 'html-entity'),
  escaped(forged('大家好', [['utf-8', 'windows-1252']]), 'percent'),
  '锟斤拷锟斤拷锟斤拷',
  '屯屯屯屯屯屯',
  'ï»¿Hello BOM',
  '????? ???? ?? ???',
  '�����',
  'Ã¦ zq Ã xx Â',
];

function allInputs() {
  return Forge.GALLERY.map((g) => g.relic).concat(EXTRA_INPUTS);
}

// One analysis in a locale, with the views the page would show (best and an adopted candidate).
function analysisIn(locale, input) {
  const r = Engine.analyze(input, { locale });
  const nr = U.normalizeResult(r, input);
  const views = [U.deriveView(nr, null)];
  if (nr.alternatives && nr.alternatives.length) views.push(U.deriveView(nr, 1));
  return { r, nr, views };
}

// Everything the page, the report and the AI prompt show for one analysis.
function textsFor(locale, input) {
  const { r, nr, views } = analysisIn(locale, input);
  const out = [];
  const push = (where, value) => out.push({ where, value });
  const hyps = [r.best].concat(r.alternatives || []).filter(Boolean);
  hyps.forEach((h, i) => push(`hyp${i}.label`, h.label));
  hyps.forEach((h, i) => push(`hyp${i}.lang`, h.lang && h.lang.name));
  for (const s of r.signatures || []) push(`signature ${s.id}`, [s.title, s.note]);
  for (const s of r.signals || []) push(`signal ${s.type}`, s.hint);

  for (const style of STYLES) {
    for (const seed of SEEDS) {
      const n = Narrator.narrate(r, { style, seed, locale });
      push(`narrate ${style}/${seed}`, {
        title: n.title, subtitle: n.subtitle, era: n.era, site: n.site, tags: n.tags,
        sections: (n.sections || []).map((s) => [s.heading, s.text]), plainText: n.plainText,
        docent: n.docent && [n.docent.name, n.docent.styleName],
      });
    }
  }
  const facts = Narrator.factsFor(r, { locale });
  push('factsFor', facts);
  const narration = Narrator.narrate(r, { style: 'humor', seed: 0, locale });
  for (const style of STYLES) {
    const p = LLM.buildPrompt(r, narration, facts, style, locale);
    push(`buildPrompt.system ${style}`, p.system);
    if (style === 'humor') push('buildPrompt.user', p.user);
  }

  views.forEach((view, vi) => {
    const tag = vi ? 'adopted' : 'view';
    push(`${tag} statusCopy`, U.statusCopy(view, nr.best, locale));
    push(`${tag} languageFact`, U.languageFact(view, locale));
    const steps = (view.best && view.best.steps) || [];
    steps.forEach((step, i) => push(`${tag} stepTitle ${i}`, U.stepTitle(step, locale)));
    push(`${tag} chainSentence`, U.chainSentence(steps, locale));
    steps.forEach((step, i) => (step.repairs || []).forEach((rep) => push(`${tag} repairLine L${i}`,
      U.repairLine(Number.isInteger(rep.step) ? rep : Object.assign({}, rep, { step: i }), steps, locale))));
    push(`${tag} report`, U.buildMarkdownReport({
      view, engineBest: nr.best, exhibitId: narration.exhibitId, date: new Date(2026, 0, 2, 3, 4),
      narrationText: narration.plainText, locale,
    }));
  });
  push('groupSignals', U.groupSignals(nr.signals, locale).map((g) => g.hint));
  push('digLines', U.digLines(input, locale));
  push('displayChar', Array.from(input).slice(0, 40).map((ch) => U.displayChar(ch, locale).title));
  return { r, texts: out, data: dataOf(r) };
}

// ---------------------------------------------------------------------------
// en-US: no CJK outside the data
// ---------------------------------------------------------------------------

test('i18n-leak: every analysis, narration, fact sheet, AI prompt and report is CJK-free in en-US', () => {
  const log = new LeakLog();
  inLocale(EN, () => {
    for (const input of allInputs()) {
      // Once with the locale passed explicitly, once following the current I18n locale.
      for (const locale of [EN, undefined]) {
        const { r, texts, data } = textsFor(locale, input);
        assert.equal(r.locale, EN, `analysis locale for ${input}`);
        for (const { where, value } of texts) log.check(`${JSON.stringify(input.slice(0, 24))} ${where}${locale ? '' : ' (implicit)'}`, value, data);
      }
    }
  });
  log.assertClean('analyses');
});

test('i18n-leak: tables, presets, providers and UI copy are CJK-free in en-US', async () => {
  const log = new LeakLog();
  await inLocaleAsync(EN, async () => {
    // Docent styles: names, taglines and docent rosters.
    for (const loc of [EN, undefined]) log.check(`Narrator.styles(${loc || ''})`, Narrator.styles(loc).map((s) => [s.name, s.tagline, s.docents]), []);

    // Gallery and forge recipes: titles, blurbs, names and stories (relic/sample glyphs are data).
    for (const g of Forge.gallery(EN)) {
      const data = dataOf(Engine.analyze(g.relic, { locale: EN }), [g.relic, g.expect, g.source]);
      log.check(`gallery ${g.id}`, [g.title, g.blurb], data);
    }
    assert.deepEqual(Forge.gallery().map((g) => g.title), Forge.gallery(EN).map((g) => g.title), 'gallery follows I18n');
    for (const p of Forge.presets(EN)) {
      const res = Forge.corrupt(p.sample, p.chain, Object.assign({}, p.opts, { locale: EN }));
      log.check(`preset ${p.id}`, [p.name, p.story], dataOf(null, [p.sample, res.output]));
    }
    const bad = Forge.corrupt('大家好', [{ encoding: 'nope', misreadAs: 'gbk' }], { locale: EN });
    log.check('Forge.corrupt error', bad.error, ['大家好']);
    const unencodable = Forge.corrupt('大家好', [{ encoding: 'windows-1252', misreadAs: 'utf-8' }], { locale: EN });
    log.check('Forge.corrupt unencodable', unencodable.error, ['大家好', '大', '家', '好']);

    // Encodings, language names, signatures, escape schemes.
    for (const e of Codecs.ENCODINGS) log.check(`Codecs.describe ${e.id}`, Codecs.describe(e.id, EN), []);
    for (const e of Codecs.ENCODINGS) log.check(`Codecs.describe ${e.id} (implicit)`, Codecs.describe(e.id), []);
    for (const code of Object.keys(Scorer.LANG_NAMES)) log.check(`Scorer.langName ${code}`, Scorer.langName(code, EN), []);
    if (typeof Engine.signatures === 'function') {
      for (const s of Engine.signatures(EN)) log.check(`Engine.signatures ${s.id}`, [s.title, s.note], [s.glyph, s.match].filter(Boolean));
    }
    if (typeof Engine.schemeName === 'function') {
      for (const s of ['percent', 'hex-escape', 'quoted-printable', 'hex-dump', 'unicode-escape', 'html-entity']) {
        log.check(`Engine.schemeName ${s}`, Engine.schemeName(s, EN), []);
        log.check(`App schemeName ${s}`, U.schemeName(s, EN), []);
      }
    }

    // AI docent: providers, effort levels, model labels, presets, prompts with no analysis, errors.
    log.check('LLM.listProviders', LLM.listProviders(EN), []);
    log.check('LLM.listProviders (implicit)', LLM.listProviders(), []);
    if (typeof LLM.efforts === 'function') log.check('LLM.efforts', LLM.efforts(EN), []);
    if (typeof LLM.modelLabels === 'function') log.check('LLM.modelLabels', LLM.modelLabels(EN), []);
    if (typeof LLM.providerPresets === 'function') log.check('LLM.providerPresets', LLM.providerPresets('openai', EN), []);
    const conn = await LLM.testConnection({ provider: 'anthropic', apiKey: '', baseUrl: 'http://example.com' }, EN);
    log.check('LLM.testConnection', conn.message, []);
    let err = null;
    try {
      await LLM.narrate(Engine.analyze('å¤§å®¶å¥½', { locale: EN }), { style: 'humor', config: { provider: 'anthropic', apiKey: '' }, locale: EN });
    } catch (e) { err = e; }
    assert.ok(err && err.code === 'config', 'a keyless Anthropic narration fails with a config error');
    log.check('LLMError.message', err.message, []);
    log.check('aiErrorMessage(LLMError)', U.aiErrorMessage(err, EN), []);
    for (const code of ['config', 'auth', 'network', 'cors', 'rate_limit', 'overloaded', 'refusal', 'http', 'aborted', 'bad_response', 'weird']) {
      log.check(`aiErrorMessage ${code}`, U.aiErrorMessage(Object.assign(new Error(''), { code, status: code === 'http' ? 502 : undefined }), EN), []);
    }

    // App shell: status copy, fallbacks, relative times, every dictionary entry.
    for (const s of ['restored', 'clean', 'partial', 'partialClean', 'irrecoverable', 'unknown']) log.check(`copyFor ${s}`, U.copyFor(s, EN), []);
    log.check('fallbackStyles', U.fallbackStyles(EN).map((s) => s.name), []);
    for (const g of U.fallbackGallery(EN)) log.check(`fallbackGallery ${g.id}`, [g.title, g.blurb], [g.relic, g.expect]);
    const now = Date.UTC(2026, 5, 1);
    log.check('relativeTime', [0, 61e3, 7200e3, 3 * 86400e3, 90 * 86400e3].map((d) => U.relativeTime(now - d, now, EN)), []);
    log.check('displayChar specials', [' ', ' ', '\t', '\n', '\r', '\u0001', '\u0081', '­', '﻿', '​', '́', ''].map((c) => U.displayChar(c, EN).title), []);
    for (const key of I18n.keys(EN)) log.check(`I18n ${key}`, I18n.t(key, { n: 2, count: 2 }, EN), []);
  });
  log.assertClean('tables');
});

// ---------------------------------------------------------------------------
// The guard itself: data never hides a leak that merely shares its glyphs
// ---------------------------------------------------------------------------

test('i18n-leak: leaksIn excuses data, but not template text that shares its glyphs', () => {
  const input = `订单状态：${forged('已发货', [['utf-8', 'windows-1252']])}，请查收`;
  const r = Engine.analyze(input, { locale: EN });
  const data = dataOf(r);
  assert.ok(data.some((d) => d.includes('：')) && data.some((d) => d.includes('，')), 'the data itself holds "：" and "，"');
  // Data: whole strings, quoted fragments, glyphs cited by code point, relic names.
  assert.deepEqual(leaksIn(`Full text: “${r.best.output}”.`, data), []);
  assert.deepEqual(leaksIn('Kept as is: “订单状态：” and “，请查收”.', data), []);
  assert.deepEqual(leaksIn('Take “，” (U+FF0C) as an example; 已 U+5DF2 too.', data), []);
  assert.deepEqual(leaksIn('A famous relic: 锟斤拷.', data), []);
  // Leaks: template punctuation or words, even when every glyph also occurs in the data.
  assert.deepEqual(leaksIn('Partial restoration：UTF-8 misread as Windows-1252', data), ['：']);
  assert.deepEqual(leaksIn('Restored, see below，then done', data), ['，']);
  assert.deepEqual(leaksIn('The 编码 of this relic', data), ['编码']);
  assert.deepEqual(leaksIn('Status（partial）', data), ['（', '）']);
  assert.deepEqual(leaksIn('The label "Partial：restoration" is wrong', data), ['：'], 'a quoted English phrase is not a glyph quote');
});

test('i18n-leak: a Chinese colon slipped into every English partial label is caught', () => {
  const real = Engine.analyze;
  Engine.analyze = function (input, opts) {
    const r = real.call(this, input, opts);
    const fix = (h) => { if (h && /^Partial restoration: /.test(h.label)) h.label = h.label.replace(': ', '：'); };
    if (r && r.locale === EN) [r.best].concat(r.alternatives || []).forEach(fix);
    return r;
  };
  let flagged = 0;
  let partials = 0;
  try {
    inLocale(EN, () => {
      for (const input of allInputs()) {
        const { r, texts, data } = textsFor(EN, input);
        if (r.status !== 'partial') continue;
        partials++;
        const log = new LeakLog();
        for (const { where, value } of texts) log.check(where, value, data);
        if (log.items.some((l) => l.runs.includes('：'))) flagged++;
      }
    });
  } finally {
    Engine.analyze = real;
  }
  assert.ok(partials >= 3, `partial inputs in the corpus (${partials})`);
  assert.equal(flagged, partials, 'every partial input reports the leaked "："');
});

// ---------------------------------------------------------------------------
// zh-CN: the same calls still speak Chinese
// ---------------------------------------------------------------------------

test('i18n-leak: the same calls still produce Chinese in zh-CN (explicit and by default)', () => {
  assert.equal(I18n.getLocale(), ZH, 'the suite runs in zh-CN by default');
  const inputs = ['å¤§å®¶å¥½', escaped('数据库', 'percent'), '锟斤拷锟斤拷', forged('Привет', [['utf-8', 'windows-1252']])];
  for (const locale of [ZH, undefined]) {
    for (const input of inputs) {
      const { r } = analysisIn(locale, input);
      assert.equal(r.locale, ZH, `analysis locale for ${input}`);
      assert.ok(HAN.test(r.best.label), `zh label for ${input}: ${r.best.label}`);
      const n = Narrator.narrate(r, { style: 'academic', seed: 0, locale });
      assert.ok(n.sections.every((s) => HAN.test(s.heading)), `zh headings for ${input}`);
      assert.ok(HAN.test(n.title) && HAN.test(n.era.label), `zh title/era for ${input}`);
      const p = LLM.buildPrompt(r, n, Narrator.factsFor(r, { locale }), 'academic', locale);
      assert.ok(HAN.test(p.system), 'zh system prompt');
      const view = U.deriveView(U.normalizeResult(r, input), null);
      const md = U.buildMarkdownReport({ view, engineBest: r.best, exhibitId: n.exhibitId, locale });
      assert.ok(md.startsWith(`# 乱码考古鉴定报告 · ${n.exhibitId}`), 'zh report');
      assert.ok(HAN.test(U.statusCopy(view, r.best, locale).headline), 'zh status copy');
    }
  }
  assert.ok(Narrator.styles(ZH).every((s) => HAN.test(s.name)), 'zh style names');
  assert.ok(Forge.gallery().every((g) => HAN.test(g.title)), 'zh gallery titles');
  assert.ok(Forge.presets(ZH).every((p) => HAN.test(p.story)), 'zh preset stories');
  assert.ok(HAN.test(Codecs.describe('windows-1252')), 'zh encoding description');
  assert.equal(Scorer.langName('ja'), '日语');
  assert.ok(HAN.test(LLM.listProviders()[0].name), 'zh provider name');
  assert.ok(HAN.test(U.tr('dig.start')), 'zh UI dictionary');
});

test('i18n-leak: en-US and zh-CN agree on everything but the words', () => {
  for (const input of allInputs()) {
    const zh = Engine.analyze(input, { locale: ZH });
    const en = Engine.analyze(input, { locale: EN });
    assert.equal(en.status, zh.status, `status for ${input}`);
    const pick = (h) => h && { output: h.output, confidence: h.confidence, steps: h.steps.map((s) => [s.kind, s.trueEncoding, s.wrongDecoder, s.scheme]) };
    assert.deepEqual(pick(en.best), pick(zh.best), `best for ${input}`);
    assert.deepEqual(en.alternatives.map(pick), zh.alternatives.map(pick), `alternatives for ${input}`);
    assert.deepEqual(en.signatures.map((s) => [s.id, s.match, s.index]), zh.signatures.map((s) => [s.id, s.match, s.index]), `signatures for ${input}`);
    const nz = Narrator.narrate(zh, { style: 'snark', seed: 3, locale: ZH });
    const ne = Narrator.narrate(en, { style: 'snark', seed: 3, locale: EN });
    assert.equal(ne.exhibitId, nz.exhibitId, `exhibit id for ${input}`);
    assert.deepEqual(ne.sections.map((s) => s.id), nz.sections.map((s) => s.id), `sections for ${input}`);
  }
});
