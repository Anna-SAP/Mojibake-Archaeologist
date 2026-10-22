'use strict';
// MBX.I18n (src/i18n.js, docs/ARCHITECTURE.md §11.1): API behaviour, dictionary hygiene, and the
// contract between the dictionaries, index.html (data-i18n*) and src/app.js (tr('…') keys).

const fs = require('fs');
const path = require('path');
const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const ROOT = path.join(__dirname, '..');
const I18n = require(path.join(ROOT, 'src', 'i18n.js'));
const App = require(path.join(ROOT, 'src', 'app.js'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ZH = 'zh-CN';
const EN = 'en-US';
// Keys registered by the tests themselves (fallback checks) are not part of the shipped dictionaries.
const shipped = (locale) => I18n.keys(locale).filter((k) => !k.startsWith('zz.test.'));
const raw = (key, locale) => I18n.t(key, null, locale);
const params = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const baseKey = (k) => k.replace(/\.one$/, '');
// CJK ideographs, kana, hangul, and the full-width punctuation that only appears in CJK text.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。、；：？！（）「」『』《》【】～]/u;
const TAGS = (s) => [...String(s).matchAll(/<\/?([a-z][a-z0-9]*)\b/gi)].map((m) => m[0].toLowerCase()).sort();

/** Runs fn with globalThis[name] temporarily replaced (undefined deletes it). */
function withGlobals(values, fn) {
  const saved = {};
  for (const name of Object.keys(values)) {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value: values[name], configurable: true, writable: true, enumerable: false });
    if (values[name] === undefined) delete globalThis[name];
  }
  try {
    return fn();
  } finally {
    for (const name of Object.keys(values)) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
      else delete globalThis[name];
    }
  }
}

function fakeStorage(prefs) {
  return { getItem: (k) => (k === 'mbx.prefs' && prefs !== undefined ? (typeof prefs === 'string' ? prefs : JSON.stringify(prefs)) : null) };
}

/** Runs fn with the current locale set to `locale`, restoring the previous one (silently). */
function inLocale(locale, fn) {
  const before = I18n.getLocale();
  I18n.setLocale(locale);
  try {
    return fn();
  } finally {
    I18n.setLocale(before);
  }
}

// ---------------------------------------------------------------------------
// API (§11.1)
// ---------------------------------------------------------------------------

test('i18n: module shape and locale table', () => {
  assert.equal(MBX.I18n, I18n, 'MBX.I18n and module.exports agree');
  for (const fn of ['normalize', 'detect', 'getLocale', 'setLocale', 'onChange', 't', 'has', 'register', 'pick', 'resolve']) {
    assert.equal(typeof I18n[fn], 'function', `I18n.${fn}`);
  }
  assert.equal(I18n.DEFAULT_LOCALE, ZH);
  assert.deepEqual(I18n.LOCALES.map((l) => [l.id, l.short, l.htmlLang, l.speech]), [[ZH, 'ZH', ZH, ZH], [EN, 'EN', EN, EN]]);
  assert.deepEqual(I18n.LOCALES.map((l) => l.name), ['简体中文', 'English (US)']);
  assert.ok(Object.isFrozen(I18n.LOCALES), 'LOCALES is read-only');
  assert.equal(I18n.getLocale(), ZH, 'Node (no page: no location/storage/document) starts in zh-CN');
});

test('i18n: Node 21.2+ has a global navigator, but outside a page it never picks the language', () => {
  // Node 21.2+ (Node 22 LTS) defines navigator.language from the host ICU locale ('en-US' on
  // most CI machines). Load i18n.js into a fresh context that looks like that Node.
  const vm = require('vm');
  const code = read('src/i18n.js');
  const run = (globals) => {
    const sandbox = Object.assign({ console }, globals);
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'i18n.js' });
    return sandbox.MBX.I18n;
  };
  const nodeLike = run({ navigator: { language: 'en-US', languages: ['en-US'] } });
  assert.equal(nodeLike.getLocale(), ZH, 'no document: the default stays zh-CN');
  assert.equal(nodeLike.detect(), ZH);
  const page = run({ navigator: { language: 'en-US', languages: ['en-US'] }, document: {} });
  assert.equal(page.getLocale(), EN, 'a real page follows the browser');
});

test('i18n: normalize maps every Chinese and English tag, rejects the rest', () => {
  for (const tag of ['zh', 'zh-Hans', 'zh-CN', 'zh-SG', 'zh-TW', 'zh-HK', 'ZH-cn', 'zh_CN', ' zh-Hant-TW ']) assert.equal(I18n.normalize(tag), ZH, tag);
  for (const tag of ['en', 'en-US', 'en-GB', 'EN', 'en_AU', 'en-Latn-US']) assert.equal(I18n.normalize(tag), EN, tag);
  for (const tag of ['', 'fr', 'ja-JP', 'zhx', 'eng', 'english', null, undefined, 42, {}]) assert.equal(I18n.normalize(tag), null, String(tag));
});

test('i18n: detect follows ?lang= > mbx.prefs.lang > navigator.languages > zh-CN', () => {
  const nav = (languages, language) => ({ languages, language });
  // navigator only counts on a page (a document exists); see the Node 21.2+ test above.
  const page = { document: {} };
  const cases = [
    [{ location: { search: '?lang=en-US' }, localStorage: fakeStorage({ lang: 'zh-CN' }), navigator: nav(['zh-CN']) }, EN, 'query wins'],
    [{ location: { search: '?a=1&lang=zh' }, localStorage: fakeStorage({ lang: 'en-US' }), navigator: nav(['en-US']) }, ZH, 'query among others'],
    [{ location: { search: '?lang=fr' }, localStorage: fakeStorage({ lang: 'en-US' }), navigator: nav(['zh-CN']) }, EN, 'unknown query falls through to prefs'],
    [{ location: { search: '' }, localStorage: fakeStorage({ lang: 'en' }), navigator: nav(['zh-CN']), ...page }, EN, 'prefs beat the browser'],
    [{ location: { search: '' }, localStorage: fakeStorage({ theme: 'dark' }), navigator: nav(['fr-FR', 'en-GB', 'zh-CN']), ...page }, EN, 'first recognizable browser language'],
    [{ location: { search: '' }, localStorage: fakeStorage('not json'), navigator: nav(['ja-JP', 'zh-TW']), ...page }, ZH, 'broken prefs are ignored'],
    [{ location: { search: '' }, localStorage: fakeStorage({}), navigator: nav([], 'en-US'), ...page }, EN, 'navigator.language fallback'],
    [{ location: { search: '' }, localStorage: fakeStorage({}), navigator: nav(['fr', 'de']), ...page }, EN, 'neither Chinese nor English: English'],
    [{ location: { search: '' }, localStorage: fakeStorage({}), navigator: nav(['ja-JP', 'en-US']), ...page }, EN, 'English further down the list'],
    [{ location: { search: '' }, localStorage: fakeStorage({}), navigator: nav([], ''), ...page }, ZH, 'no browser language at all: zh-CN'],
    [{ location: { search: '' }, localStorage: fakeStorage({}), navigator: nav(['en-US']) }, ZH, 'a navigator without a page (Node 21.2+) is ignored'],
    [{ location: undefined, localStorage: undefined, navigator: undefined }, ZH, 'no browser objects: zh-CN'],
  ];
  for (const [globals, want, why] of cases) assert.equal(withGlobals(globals, () => I18n.detect()), want, why);
  // Storage that throws on access (blocked cookies, sandboxed file://) never breaks detection.
  const throwing = { getItem() { throw new Error('SecurityError'); } };
  assert.equal(withGlobals({ location: { search: '' }, localStorage: throwing, navigator: nav(['en-US']), ...page }, () => I18n.detect()), EN);
});

test('i18n: index.html pre-detects the language with the same rules as I18n.detect', () => {
  // Run the <head> script against fake browser objects and compare with detect().
  const vm = require('vm');
  const html = read('index.html');
  const script = html.slice(0, html.indexOf('</head>')).match(/<script>([\s\S]*?)<\/script>/)[1];
  const nav = (languages, language) => ({ languages, language });
  const cases = [
    ['', {}, nav(['fr-FR', 'de'])], ['', {}, nav(['ja-JP', 'en-US'])], ['', {}, nav(['zh-TW'])], ['', {}, nav([], '')],
    ['', { lang: 'en' }, nav(['zh-CN'])], ['?lang=zh-CN', { lang: 'en' }, nav(['en-US'])], ['?lang=fr', {}, nav(['de'])],
  ];
  for (const [search, prefs, navigator] of cases) {
    const attrs = {};
    const root = { classList: { add() {} }, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute() {}, lang: '' };
    const storage = fakeStorage(prefs);
    vm.runInNewContext(script, {
      document: { documentElement: root }, localStorage: storage, location: { search }, navigator, setTimeout() {},
    });
    const want = withGlobals({ location: { search }, localStorage: storage, navigator, document: {} }, () => I18n.detect());
    assert.equal(root.lang, want, `${search} ${JSON.stringify(prefs)} ${JSON.stringify(navigator)}`);
  }
});

test('i18n: setLocale notifies listeners and the mbx:localechange event only on a real change', () => {
  const seen = [];
  const events = [];
  const off = I18n.onChange((loc) => seen.push(loc));
  const noisy = I18n.onChange(() => { throw new Error('a broken listener must not stop the others'); });
  const errors = console.error;
  console.error = () => {};
  try {
    withGlobals({
      dispatchEvent: (ev) => { events.push([ev.type, ev.detail && ev.detail.locale]); return true; },
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    }, () => {
      assert.equal(I18n.setLocale('en'), EN, 'normalized');
      assert.equal(I18n.getLocale(), EN);
      assert.equal(I18n.setLocale('en-GB'), EN, 'same language: no change');
      assert.equal(I18n.setLocale('fr'), EN, 'unknown tag: ignored');
      assert.equal(I18n.setLocale('zh-TW'), ZH);
    });
  } finally {
    console.error = errors;
    off();
    noisy();
    I18n.setLocale(ZH);
  }
  assert.deepEqual(seen, [EN, ZH]);
  assert.deepEqual(events, [['mbx:localechange', EN], ['mbx:localechange', ZH]]);
  I18n.setLocale(EN);
  I18n.setLocale(ZH);
  assert.deepEqual(seen, [EN, ZH], 'unsubscribed listeners stay quiet');
  assert.equal(typeof I18n.onChange(null), 'function', 'a non-function still returns an unsubscribe');
});

test('i18n: resolve prefers opts.locale, then the current language', () => {
  assert.equal(I18n.resolve(), ZH);
  assert.equal(I18n.resolve(null), ZH);
  assert.equal(I18n.resolve({ locale: 'en' }), EN);
  assert.equal(I18n.resolve({ locale: 'xx' }), ZH, 'unknown explicit tag falls back to the current language');
  assert.equal(I18n.resolve('en-US'), EN, 'a bare tag is accepted too');
  inLocale(EN, () => {
    assert.equal(I18n.resolve(), EN);
    assert.equal(I18n.resolve({}), EN);
    assert.equal(I18n.resolve({ locale: 'zh-HK' }), ZH);
  });
});

test('i18n: t interpolates once, picks English singulars, falls back to zh-CN then the key', () => {
  assert.equal(I18n.t('dig.count', { n: 3 }, ZH), '3 字');
  assert.equal(I18n.t('dig.count', { n: 1 }, ZH), '1 字', 'no plural forms in Chinese');
  assert.equal(I18n.t('dig.count', { n: 1 }, EN), '1 character');
  assert.equal(I18n.t('dig.count', { n: 0 }, EN), '0 characters');
  assert.equal(I18n.t('dig.count', { n: 2 }, EN), '2 characters');
  assert.equal(I18n.t('stratum.total', { n: 1, more: '' }, EN), '1 byte in total');
  assert.equal(I18n.t('time.minutes', { n: 1 }, 'en'), '1 minute ago', 'locale argument is normalized');
  assert.equal(I18n.t('promoted.chief', { output: '{pct}' }, ZH), '首席结论仍是「{pct}」', 'values are never re-expanded');
  assert.equal(I18n.t('promoted.chief', {}, EN), 'the chief verdict is still "{output}"', 'missing params stay visible');
  assert.equal(I18n.t('promoted.chief', { output: 0 }, EN), 'the chief verdict is still "0"');
  assert.equal(I18n.t('no.such.key'), 'no.such.key');
  inLocale(EN, () => assert.equal(I18n.t('dig.start'), 'Start Digging', 'current locale by default'));
  assert.ok(I18n.register('zh', { 'zz.test.zhOnly': '只有中文 {x}' }), 'register merges into a locale');
  assert.equal(I18n.register('fr', { 'zz.test.fr': 'non' }), false, 'unsupported locale');
  assert.equal(I18n.t('zz.test.zhOnly', { x: 1 }, EN), '只有中文 1', 'English falls back to zh-CN');
  assert.equal(I18n.has('zz.test.zhOnly', ZH), true);
  assert.equal(I18n.has('zz.test.zhOnly', EN), false, 'has() does not fall back');
});

test('i18n: English groups thousands, Chinese keeps plain digits', () => {
  assert.equal(I18n.t('stats.explored', { n: 1030 }, EN), 'Compared 1,030 stratum hypotheses');
  assert.equal(I18n.t('dig.count', { n: 12000 }, EN), '12,000 characters');
  assert.equal(I18n.t('dig.count', { n: 999 }, EN), '999 characters');
  assert.equal(I18n.t('stats.ms', { ms: 1234.5 }, EN), 'took 1,234.5 ms');
  assert.equal(I18n.t('gallery.no', { no: '1030' }, EN), 'Exhibit No. 1030', 'strings are never reformatted');
  assert.equal(I18n.t('stats.explored', { n: 1030 }, ZH), '比对了 1030 种地层假设');
  assert.equal(I18n.t('dig.count', { n: 12000 }, ZH), '12000 字');
});

test('i18n: plural lookups stay cheap (one Intl.PluralRules per locale)', () => {
  const Real = Intl.PluralRules;
  let made = 0;
  Intl.PluralRules = function PluralRules(...args) { made++; return new Real(...args); };
  try {
    for (let i = 0; i < 200; i++) {
      I18n.t('time.minutes', { n: i }, EN);
      I18n.t('dig.count', { n: i }, ZH);
    }
  } finally {
    Intl.PluralRules = Real;
  }
  assert.ok(made <= 2, `constructed ${made} times`);
  assert.equal(I18n.t('time.minutes', { n: 1 }, EN), '1 minute ago');
});

test('i18n: English copy fixes (spacing, idioms, serial comma)', () => {
  const t = (k, p) => I18n.t(k, p, EN);
  assert.equal(t('gallery.no', { no: '01' }), 'Exhibit No. 01');
  assert.equal(t('status.partialClean.label'), 'Spot-Repaired');
  assert.ok(t('meta.description').includes('Shift_JIS, and other encoding mix-ups') && !/restore UTF-8/.test(t('meta.description')));
  assert.equal(t('report.status', { label: 'Unsolved Mystery', status: 'unknown', promoted: t('report.promoted') }),
    '| Appraisal status | Unsolved Mystery (`unknown`; candidate adopted by the visitor) |');
  assert.ok(t('report.chainMisread', { from: 'UTF-8', to: 'GBK', lossy: '' }).includes('were misread as **GBK**'));
  assert.deepEqual(['settings.effortLow', 'settings.effortMedium', 'settings.effortHigh'].map((k) => t(k)),
    ['Low · faster, cheaper', 'Medium · balanced', 'High · most thorough']);
  assert.ok(!t('footer.note').includes('Mojibake Archaeologist'), 'the colophon already names the museum');
  assert.ok(/[^\x00-\x7f]/.test(t('forge.sample').replace(/[—“”]/g, '')), 'the fallback forge sample has letters a misreading can change');
  assert.equal(t('facts.repairsN', { n: 1 }), '1 character');
  assert.equal(t('docent.skipType'), 'Show all now');
  assert.equal(t('narr.site'), 'Excavation site');
});

test('i18n: pick reads localized content records', () => {
  const rec = { 'zh-CN': '你好', 'en-US': 'Hello' };
  assert.equal(I18n.pick(rec, EN), 'Hello');
  assert.equal(I18n.pick(rec, 'zh'), '你好');
  assert.equal(I18n.pick({ 'zh-CN': '只有中文' }, EN), '只有中文', 'falls back to zh-CN');
  const plain = { title: 'x' };
  assert.equal(I18n.pick(plain, EN), plain, 'a record without locales is returned as is');
  assert.equal(I18n.pick('text', EN), 'text');
  assert.equal(I18n.pick(null, EN), null);
  inLocale(EN, () => assert.equal(I18n.pick(rec), 'Hello', 'current locale by default'));
});

// ---------------------------------------------------------------------------
// Dictionary hygiene
// ---------------------------------------------------------------------------

test('i18n: both dictionaries have the same keys (English singulars aside)', () => {
  const zh = shipped(ZH);
  const en = shipped(EN);
  assert.ok(zh.length > 400, `zh-CN has the whole shell (${zh.length} keys)`);
  const enBase = en.filter((k) => !k.endsWith('.one'));
  assert.deepEqual(zh.filter((k) => !enBase.includes(k)), [], 'keys missing from en-US');
  assert.deepEqual(enBase.filter((k) => !zh.includes(k)), [], 'keys missing from zh-CN');
  assert.deepEqual(zh.filter((k) => k.endsWith('.one')), [], 'Chinese has no singular forms');
  for (const k of en.filter((x) => x.endsWith('.one'))) {
    assert.ok(zh.includes(baseKey(k)), `${k} has a base key`);
    assert.ok(params(raw(baseKey(k), EN)).some((p) => p === 'n' || p === 'count'), `${baseKey(k)} carries the count`);
  }
});

test('i18n: no empty values, and every {param} appears in both languages', () => {
  for (const locale of [ZH, EN]) {
    for (const k of shipped(locale)) {
      const v = raw(k, locale);
      assert.ok(typeof v === 'string' && v.trim() !== '', `${locale} ${k} is empty`);
    }
  }
  for (const k of shipped(EN)) {
    assert.deepEqual(params(raw(k, EN)), params(raw(baseKey(k), ZH)), `{params} of ${k}`);
  }
});

test('i18n: en-US values contain no Chinese, Japanese or Korean characters', () => {
  const bad = shipped(EN).filter((k) => CJK.test(raw(k, EN)));
  assert.deepEqual(bad, [], 'CJK text in en-US');
});

test('i18n: zh-CN values are Chinese, not untranslated placeholders', () => {
  // A zh value with Latin words but no CJK character is an untranslated English string or a stray
  // key; pure punctuation around a placeholder (' —— {note}') is fine.
  const english = shipped(ZH).filter((k) => !CJK.test(raw(k, ZH)) && /[A-Za-z]/.test(raw(k, ZH).replace(/\{\w+\}/g, '')));
  assert.deepEqual(english, [], 'zh-CN values without any Chinese');
  assert.deepEqual(shipped(ZH).filter((k) => raw(k, ZH) === k), [], 'a value equal to its key');
});

test('i18n: markup only in *.html keys, with the same tags in both languages', () => {
  for (const locale of [ZH, EN]) {
    for (const k of shipped(locale)) {
      if (k.endsWith('.html')) continue;
      assert.ok(!/<[a-z/!]/i.test(raw(k, locale)), `${locale} ${k} holds markup`);
    }
  }
  for (const k of shipped(ZH).filter((x) => x.endsWith('.html'))) {
    assert.deepEqual(TAGS(raw(k, EN)), TAGS(raw(k, ZH)), `tags of ${k}`);
    assert.ok(!/\son\w+\s*=|javascript:|<script/i.test(raw(k, EN) + raw(k, ZH)), `${k} is inert markup`);
  }
});

// ---------------------------------------------------------------------------
// index.html and app.js use only existing keys; zh-CN text is unchanged
// ---------------------------------------------------------------------------

/*
 * A switch group is named in both languages (§11.3), each half marked with its own lang so a
 * screen reader can voice it: role="group" aria-labelledby → a hidden element holding
 * <span lang="en">…</span> · <span lang="zh-CN">…</span>.
 */
function assertBilingualGroupLabel(html, groupTag) {
  assert.ok(/role="group"/.test(groupTag), 'role="group"');
  const id = (groupTag.match(/aria-labelledby="([^"]+)"/) || [])[1];
  assert.ok(id, `aria-labelledby on ${groupTag.slice(0, 80)}`);
  assert.equal(html.split(`id="${id}"`).length - 1, 1, `exactly one #${id}`);
  const name = html.match(new RegExp(`<span id="${id}"[^>]*>([\\s\\S]*?)</span></span>`));
  assert.ok(name, `#${id} holds the name`);
  assert.ok(/<span lang="en">[A-Za-z ]+<\/span>/.test(name[0]), 'English half marked lang="en"');
  assert.ok(/<span lang="zh-CN">\p{Script=Han}+<\/span>/u.test(name[0] + '</span>'), 'Chinese half marked lang="zh-CN"');
  assert.ok(!/aria-label="/.test(groupTag.match(/^<div\b[^>]*>/)[0]), 'no unmarked bilingual aria-label on the group');
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function htmlBindings() {
  const html = read('index.html');
  const text = [...html.matchAll(/<(\w+)\b[^>]*?\sdata-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => ({ key: m[2], inner: m[3] }));
  const markup = [...html.matchAll(/<(\w+)\b[^>]*?\sdata-i18n-html="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => ({ key: m[2], inner: m[3] }));
  const attrs = [];
  for (const m of html.matchAll(/<\w+\b[^>]*\sdata-i18n-attr="([^"]+)"[^>]*>/g)) {
    for (const pair of m[1].split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      const value = (m[0].match(new RegExp(`\\s${attr}="([^"]*)"`)) || [])[1];
      attrs.push({ attr, key, value });
    }
  }
  return { html, text, markup, attrs };
}

test('i18n: every data-i18n key in index.html exists, and its zh-CN text is what the page shows', () => {
  const { html, text, markup, attrs } = htmlBindings();
  const count = (html.match(/\sdata-i18n(?:-html|-attr)?="/g) || []).length;
  assert.equal(text.length + markup.length + (html.match(/\sdata-i18n-attr="/g) || []).length, count, 'every binding parsed');
  assert.ok(text.length > 60, `text bindings (${text.length})`);
  for (const { key, inner } of text) {
    assert.ok(I18n.has(key, ZH) && I18n.has(key, EN), `data-i18n="${key}" exists in both dictionaries`);
    assert.ok(!/</.test(inner), `data-i18n="${key}" holds plain text only`);
    assert.equal(decode(inner.trim()), raw(key, ZH), `zh-CN text of ${key}`);
  }
  for (const { key, inner } of markup) {
    assert.ok(key.endsWith('.html') && I18n.has(key, ZH) && I18n.has(key, EN), `data-i18n-html="${key}"`);
    assert.equal(inner.trim(), raw(key, ZH), `zh-CN markup of ${key}`);
  }
  assert.ok(attrs.length >= 4, 'attribute bindings');
  for (const { attr, key, value } of attrs) {
    assert.ok(I18n.has(key, ZH) && I18n.has(key, EN), `${attr}:${key}`);
    assert.equal(decode(value || ''), raw(key, ZH), `zh-CN ${attr} of ${key}`);
  }
});

test('i18n: index.html has the language switch, loads i18n.js first and pre-detects the language', () => {
  const html = read('index.html');
  const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(srcs[0], 'src/i18n.js', 'i18n.js is the first script');
  assert.equal(srcs[srcs.indexOf('src/narrator.js') + 1], 'src/narrator-en.js', 'English docent pack right after the narrator');
  const sw = html.match(/<div class="lang-switch"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(sw, 'switch present');
  assertBilingualGroupLabel(html, sw[0]);
  const btns = [...sw[1].matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map((m) => [m[2], (m[1].match(/data-locale="([^"]+)"/) || [])[1], (m[1].match(/\slang="([^"]+)"/) || [])[1], /aria-pressed=/.test(m[1])]);
  assert.deepEqual(btns, [['EN', EN, EN, true], ['ZH', ZH, ZH, true]]);
  assert.ok(/\/<\/span>/.test(sw[1]), 'EN / ZH separator');
  // The switch sits before the brand (top-left of the masthead).
  assert.ok(html.indexOf('class="lang-switch"') < html.indexOf('class="brand"'), 'switch before the brand');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(/[?&]lang=/.test(head) && /mbx\.prefs/.test(head) && /navigator\.languages/.test(head), 'head script mirrors I18n.detect');
  assert.ok(/data-i18n-pending/.test(head) && /setTimeout/.test(head), 'hidden until translated, with a failsafe');
  assert.ok(/data-i18n-pending\]\s*body\s*\{\s*visibility:\s*hidden/.test(read('assets/styles.css')), 'pending state hides the page');
  assert.ok(/lang="zh-CN">乱码考古学家</.test(html), 'the decorative Chinese brand carries lang="zh-CN"');
});

test('i18n: every tr() key used by app.js exists in both dictionaries', () => {
  const code = read('src/app.js');
  const literal = [...code.matchAll(/\btr\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(literal.length > 150, `tr('…') calls found (${literal.length})`);
  // Keys picked by a ternary (tr(x ? 'a' : 'b')) or passed through a variable: any quoted string
  // that starts with a dictionary namespace.
  const spaces = new Set(shipped(ZH).map((k) => k.split('.')[0]));
  const quoted = [...code.matchAll(/'([a-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)'/g)].map((m) => m[1])
    .filter((k) => spaces.has(k.split('.')[0]) && !/\.js$/.test(k));
  const missing = [...new Set(literal.concat(quoted))].filter((k) => !I18n.has(k, ZH) || !I18n.has(k, EN));
  assert.deepEqual(missing, [], 'keys used by app.js but missing from a dictionary');
  // Keys built from data at run time.
  const dynamic = [];
  for (const s of ['restored', 'clean', 'irrecoverable', 'partial', 'unknown', 'partialClean']) {
    for (const f of ['label', 'headline', 'desc']) dynamic.push(`status.${s}.${f}`);
  }
  for (const s of Object.keys(App.SCHEME_NAMES)) dynamic.push(`scheme.${s}`);
  for (const r of ['gap', 'nbsp', 'dropped', 'fallback']) dynamic.push(`repair.reason.${r}`);
  for (const c of ['config', 'auth', 'network', 'cors', 'rate_limit', 'overloaded', 'refusal', 'http', 'aborted', 'bad_response', 'default']) dynamic.push(`ai.err.${c}`);
  for (const p of ['connecting', 'thinking', 'writing']) dynamic.push(`ai.phase.${p}`);
  for (const s of ['humor', 'academic', 'snark']) dynamic.push(`style.${s}`);
  for (const g of ['fb1', 'fb2']) dynamic.push(`gallery.${g}.title`, `gallery.${g}.blurb`);
  assert.deepEqual(dynamic.filter((k) => !I18n.has(k, ZH) || !I18n.has(k, EN)), [], 'run-time keys');
});

test('i18n: the Chinese tables app.js still exports match the zh-CN dictionary', () => {
  for (const s of Object.keys(App.STATUS_COPY)) {
    for (const f of ['label', 'headline', 'desc']) assert.equal(App.STATUS_COPY[s][f], raw(`status.${s}.${f}`, ZH), `STATUS_COPY.${s}.${f}`);
  }
  for (const f of ['label', 'headline', 'desc']) assert.equal(App.PARTIAL_CLEAN_COPY[f], raw(`status.partialClean.${f}`, ZH), `PARTIAL_CLEAN_COPY.${f}`);
  for (const s of Object.keys(App.SCHEME_NAMES)) assert.equal(App.SCHEME_NAMES[s], raw(`scheme.${s}`, ZH), `SCHEME_NAMES.${s}`);
});

test('i18n: the glossary is used consistently in en-US', () => {
  const t = (k) => raw(k, EN);
  assert.equal(t('dig.title'), 'Excavation Site');
  assert.equal(t('gallery.title'), 'Highlights of the Collection');
  assert.equal(t('strata.title'), 'Stratigraphy of Bytes');
  assert.equal(t('alts.title'), 'Second Opinions');
  assert.equal(t('forge.title'), 'The Forgery Workshop');
  assert.equal(t('cabinet.title'), 'My Cabinet of Curiosities');
  assert.equal(t('dig.start'), 'Start Digging');
  assert.equal(t('settings.title'), 'Museum Settings');
  assert.equal(t('brand.title'), 'Mojibake Archaeologist');
  assert.deepEqual(['restored', 'clean', 'partial', 'irrecoverable', 'unknown'].map((s) => t(`status.${s}.label`)),
    ['Restored', 'Authentic', 'Partially Restored', 'Irrecoverable', 'Unsolved Mystery']);
  assert.deepEqual(['humor', 'academic', 'snark'].map((s) => t(`style.${s}`)), ['Humorous Docent', 'Academic Researcher', 'Snarky Appraiser']);
  assert.equal(t('chain.encodedAs'), 'encoded as');
  assert.equal(t('chain.misreadAs'), 'misread as');
  assert.equal(I18n.t('step.misread', { from: 'UTF-8', to: 'Windows-1252' }, EN), 'UTF-8 misread as Windows-1252');
});

test('i18n: the settings drawer repeats the EN / ZH switch (the modal drawer hides the masthead one)', () => {
  const html = read('index.html');
  const dialog = html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'));
  const sw = dialog.match(/<div class="lang-switch[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(sw, 'switch inside the settings dialog');
  assertBilingualGroupLabel(html, sw[0]);
  const btns = [...sw[1].matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map((m) => [m[2], (m[1].match(/data-locale="([^"]+)"/) || [])[1], (m[1].match(/\slang="([^"]+)"/) || [])[1]]);
  assert.deepEqual(btns, [['EN', EN, EN], ['ZH', ZH, ZH]]);
  assert.ok(/data-i18n="settings\.lang"/.test(dialog), 'labelled from the dictionary');
  assert.equal(I18n.t('settings.lang', null, EN), 'Interface language');
  assert.equal(I18n.t('settings.lang', null, ZH), '界面语言');
  // app.js binds and updates every .lang-switch group, not only the masthead one.
  assert.ok(/querySelectorAll\('\.lang-switch'\)/.test(read('src/app.js')), 'every switch group is wired');
});
