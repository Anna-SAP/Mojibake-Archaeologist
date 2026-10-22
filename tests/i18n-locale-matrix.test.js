'use strict';
// One locale rule for every module (docs/ARCHITECTURE.md §11.1–11.2): the same matrix of tags must
// resolve identically in I18n, App, Engine, Scorer, Codecs, Forge, Narrator and LLM, with the UI
// in either language, and the same way again when src/i18n.js is absent (standalone fallbacks).

const path = require('path');
const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const App = require(path.join(__dirname, '..', 'src', 'app.js'));
const I18n = MBX.I18n;
const HAN = /[一-鿿]/;

// Supported tags in every spelling (case, '-' or '_', padding, scripts and regions), then
// unsupported tags and non-strings, which are no language choice at all.
const MATRIX = [
  'en', 'EN', 'en-US', 'en-us', 'EN-GB', 'en_GB', 'en_us', ' en ', '\ten-GB\n', 'en-Latn-US', 'en-001',
  'zh', 'ZH', 'zh-CN', 'zh-cn', 'zh-TW', 'zh_HK', 'zh-Hans', 'zh-Hant-HK', ' zh-Hans ', 'ZH_tw',
  'fr', 'fr-FR', 'ja', 'ja-JP', 'ko-KR', 'english', 'eng', 'enx', 'zhongwen', 'e n', '-en', '',
  '   ', null, undefined, 123, {}, [],
];
const show = (tag) => (tag === undefined ? 'undefined' : JSON.stringify(tag));

// Each module's choice for one explicit tag, as 'en-US' / 'zh-CN' (behaviour, not internals,
// for the modules whose helper is private).
function choices(tag) {
  const o = { locale: tag };
  const of = (en) => (en ? 'en-US' : 'zh-CN');
  return {
    'App.util.currentLocale': App.util.currentLocale(tag),
    'Engine.analyze': MBX.Engine.analyze('cafÃ©', o).locale,
    'Engine.schemeName': of(MBX.Engine.schemeName('percent', tag) === 'URL percent-encoding'),
    'Scorer.langName': of(MBX.Scorer.langName('ja', tag) === 'Japanese'),
    'Codecs.describe': of(MBX.Codecs.describe('euc-jp', tag) === 'Japanese Unix (EUC-JP)'),
    'Forge.gallery': of(MBX.Forge.gallery(tag)[0].title === MBX.Forge.GALLERY[0].en.title),
    'Narrator.resolveLocale': MBX.Narrator._internals.resolveLocale(o),
    'Narrator.styles': of(!HAN.test(MBX.Narrator.styles(tag)[0].name)),
    'LLM.resolveLocale': MBX.LLM._internals.resolveLocale(o),
    'LLM.efforts': of(!HAN.test(MBX.LLM.efforts(tag)[0].name)),
  };
}

function withoutI18n(fn) {
  const saved = MBX.I18n;
  delete MBX.I18n;
  try {
    return fn();
  } finally {
    MBX.I18n = saved;
  }
}

test('i18n-locale-matrix: Narrator and LLM normalize tags exactly like I18n.normalize, with or without i18n.js', () => {
  if (!I18n || typeof I18n.normalize !== 'function') return; // src/i18n.js not present
  const N = MBX.Narrator._internals;
  const L = MBX.LLM._internals;
  const expected = MATRIX.map((tag) => I18n.normalize(tag));
  // Spot-check the reference itself, so a regression in I18n.normalize cannot hide here.
  assert.equal(I18n.normalize(' en '), 'en-US');
  assert.equal(I18n.normalize('en_GB'), 'en-US');
  assert.equal(I18n.normalize('zh-TW'), 'zh-CN');
  assert.equal(I18n.normalize('english'), null);
  assert.equal(I18n.normalize('enx'), null);
  const check = (why) => {
    MATRIX.forEach((tag, i) => {
      assert.equal(N.tagLocale(tag), expected[i], `Narrator.tagLocale ${show(tag)} (${why})`);
      assert.equal(L.tagLocale(tag), expected[i], `LLM.tagLocale ${show(tag)} (${why})`);
      assert.equal(N.normLocale(tag), expected[i] || 'zh-CN', `Narrator.normLocale ${show(tag)} (${why})`);
      assert.equal(L.normalizeLocale(tag), expected[i] || 'zh-CN', `LLM.normalizeLocale ${show(tag)} (${why})`);
    });
  };
  check('with I18n');
  withoutI18n(() => check('standalone fallback'));
});

test('i18n-locale-matrix: every module resolves every tag like I18n.resolve, in both UI languages', () => {
  if (!I18n || typeof I18n.resolve !== 'function' || typeof I18n.setLocale !== 'function') return;
  const before = I18n.getLocale();
  try {
    for (const current of ['zh-CN', 'en-US']) {
      I18n.setLocale(current);
      for (const tag of MATRIX) {
        const want = I18n.resolve({ locale: tag });
        const got = choices(tag);
        for (const where of Object.keys(got)) assert.equal(got[where], want, `${where} ${show(tag)} (UI in ${current})`);
      }
    }
  } finally {
    I18n.setLocale(before);
  }
});

test('i18n-locale-matrix: without i18n.js every module applies the same tag rule, then zh-CN', () => {
  if (!I18n || typeof I18n.normalize !== 'function') return;
  const expected = MATRIX.map((tag) => I18n.normalize(tag) || 'zh-CN');
  withoutI18n(() => {
    MATRIX.forEach((tag, i) => {
      const got = choices(tag);
      for (const where of Object.keys(got)) assert.equal(got[where], expected[i], `${where} ${show(tag)} (no I18n)`);
    });
  });
});

test('i18n-locale-matrix: LLM.efforts() uses the same English labels as the settings dictionary', () => {
  if (!I18n || typeof I18n.t !== 'function') return;
  const ui = ['settings.effortLow', 'settings.effortMedium', 'settings.effortHigh'].map((k) => I18n.t(k, undefined, 'en-US'));
  assert.deepEqual(MBX.LLM.efforts('en-US').map((e) => e.name), ui);
  assert.deepEqual(MBX.LLM.efforts('en-US').map((e) => e.id), ['low', 'medium', 'high']);
  // zh-CN keeps its legacy table (EFFORTS) byte-for-byte.
  assert.deepEqual(MBX.LLM.efforts('zh-CN'), MBX.LLM.EFFORTS);
});
