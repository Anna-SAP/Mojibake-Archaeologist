'use strict';
// Regression tests for the en-US docent's copy review (src/narrator-en.js, plus the quote() hook in
// src/narrator.js): wording that contradicted the verdict, broken code chips, mismatched relic
// names, run-on Python caveats, mid-sentence capitals, digits in prose, tone leaks and straight
// quotes. Every relic goes through the real engine in en-US.

const fs = require('fs');
const path = require('path');
const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const N = MBX.Narrator;
const EN = { locale: 'en-US' };
const PACK = MBX._narratorPacks['en-US'];
// The pack's source with JS escapes undone (don\'t → don't), for phrase checks.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'narrator-en.js'), 'utf8').replace(/\\'/g, '\'');

const STYLES = ['humor', 'academic', 'snark'];
const SEEDS = [0, 1, 2, 3, 7, 12345];
const sec = (n, id) => (n.sections.find((s) => s.id === id) || { text: '' }).text;
const all = (n) => [n.title, n.subtitle, n.site].concat(n.tags, n.sections.map((s) => s.text)).join('\n');

const gallery = (id) => MBX.Forge.GALLERY.find((g) => g.id === id).relic;
const cache = new Map();
function analyzeEn(text) {
  if (!cache.has(text)) cache.set(text, MBX.Engine.analyze(text, EN));
  return cache.get(text);
}
const narr = (text, style, seed) => N.narrate(analyzeEn(text), { style, seed, locale: 'en-US' });

const EXTRA = [
  'Donâ€™t worry, itâ€™s fine',
  'ÐÐÐÐÐ',
  '†‡†‡†‡',
  '屯屯屯屯屯屯',
  '葺葺葺葺',
  '烫烫烫烫烫烫',
  '¶¶¶¶ ÷÷÷',
  '%C3%A5%C2%A4%C2%A7%C3%A5%C2%AE%C2%B6',
  'Hello å¤§å®¶å¥½ world, this sentence is otherwise perfectly fine English.',
];
const RELICS = MBX.Forge.GALLERY.map((g) => g.relic).concat(EXTRA);

// Every narration once: relic × style × seed.
const ALL = [];
for (const relic of RELICS) for (const style of STYLES) for (const seed of SEEDS) ALL.push({ relic, style, seed, n: narr(relic, style, seed) });

test('narrator-en review: the academic opening never calls the relic its "original form"', () => {
  for (const x of ALL.filter((a) => a.style === 'academic')) {
    assert.ok(!/original form/i.test(sec(x.n, 'opening')), `${x.relic}/${x.seed}: ${sec(x.n, 'opening')}`);
  }
  const intro = [0, 1, 2, 3, 4, 5, 6, 7].map((seed) => sec(narr(gallery('dajiahao'), 'academic', seed), 'opening')).join('\n');
  assert.ok(/[Aa]s excavated, it reads “å¤§å®¶å¥½”/.test(intro), 'the relic is introduced as excavated');
});

test('narrator-en review: E2 80 shows as one code chip, never `â``€`', () => {
  for (const x of ALL) assert.ok(!/``/.test(all(x.n)), `${x.relic}/${x.style}/${x.seed}: doubled backticks`);
  const mech = SEEDS.map((seed) => sec(narr(gallery('curly-quotes'), 'humor', seed), 'mechanism')).join('\n');
  assert.ok(mech.includes('Windows-1252 shows as `â€`'), 'the E2 80 lead pair is one chip');
  assert.equal(PACK.t.lead.quotes('`â``€`', 'Windows-1252', true).indexOf('``'), -1, 'lead.quotes merges the two chips');
});

test('narrator-en review: famous-relic names match the engine\'s English titles', () => {
  const eng = MBX.Engine.signatures('en-US');
  for (const id of ['utf16-nul', 'replacement', 'question-marks']) {
    const e = eng.find((s) => s.id === id);
    assert.equal(PACK.SIGNATURE_FACTS[id].title, e.title, id);
  }
  const lost = gallery('resume-lost');
  for (const style of STYLES) {
    const n = narr(lost, style, 0);
    assert.ok(n.title.indexOf('A sea of �') === 0, `${style}: title uses the panel's name: ${n.title}`);
    assert.ok(n.tags.indexOf('Famous relic: A sea of �') >= 0, `${style}: tag uses the panel's name`);
    assert.ok(!/Swarms of|Screen Full of|NUL Between/.test(all(n)), `${style}: no retired names`);
  }
});

test('narrator-en review: Python caveats are separate sentences about the relic, not the spell', () => {
  let seen = 0;
  for (const x of ALL) {
    const cons = sec(x.n, 'conservation');
    assert.ok(!/(^|[.;] )[Ii]t has gaps/.test(cons), `${x.relic}/${x.style}: ambiguous "it has gaps": ${cons}`);
    if (/This relic has gaps, so that line will raise an exception as is, because /.test(cons)) seen++;
  }
  assert.ok(seen > 0, 'the tolerant caveat shows up');
  const gbk = sec(narr(gallery('nihao-gbk-lossy'), 'humor', 0), 'conservation');
  assert.ok(/`s\.encode\('gbk'\)\.decode\('utf-8'\)`\. This relic has gaps, .*\(UnicodeDecodeError\)\. Use `s\.encode\('gbk', errors='ignore'\)\.decode\('utf-8', errors='replace'\)` instead \(it gives /.test(gbk), gbk);
  const recipe = PACK.t.py.recipe('', '`x`', ['run it on the garbled fragments only: fine', 'this relic has gaps, so x']);
  assert.equal(recipe, 'The Python spell for this relic: `x`. Run it on the garbled fragments only: fine. This relic has gaps, so x.');
});

test('narrator-en review: an irrecoverable relic is "irrecoverable", never "irreversible"', () => {
  for (const seed of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    const n = narr(gallery('resume-lost'), 'humor', seed);
    assert.ok(!/irreversible relic/.test(all(n)), `seed ${seed}`);
  }
  assert.ok(SRC.includes('officially an “irrecoverable relic.”'), 'the humor verdict uses the glossary word');
});

test('narrator-en review: excavation sites say the text, not the site, was misread or wrapped', () => {
  for (const x of ALL) {
    assert.ok(!/, then misread all over again|, and finally wrapped up in|, and later drifted into/.test(x.n.site), `${x.relic}: ${x.n.site}`);
  }
  const double = narr(gallery('double-layer'), 'humor', 0).site;
  assert.ok(/; the text was then misread all over again during a later data migration or import\/export$/.test(double), double);
  const S = PACK.t.site;
  assert.equal(S.wrapped('a blog', 'a URL'), 'a blog; the text was finally wrapped up in a URL');
  assert.equal(S.wrapped('a blog' + S.again, 'a URL'), 'a blog; the text was then misread all over again during a later data migration or import/export, and was finally wrapped up in a URL');
  assert.equal(S.wrapped(null, 'a URL'), 'a URL');
});

test('narrator-en review: single-byte traces say "turned, one byte apiece, into", and a lone byte just "turned into"', () => {
  for (const x of ALL) assert.ok(!/byte by byte as `/.test(all(x.n)), `${x.relic}/${x.style}`);
  const humor = SEEDS.map((seed) => sec(narr(gallery('dajiahao'), 'humor', seed), 'mechanism')).join('\n');
  assert.ok(/turned, one byte apiece, into `å` `[¤®¥]` `[§¶½]`/.test(humor), 'three bytes, one apiece');
  assert.equal(PACK.t.act.single('`Ã`'), 'turned into `Ã`');
  assert.equal(PACK.t.act.single('`Ã` `¦`'), 'turned, one byte apiece, into `Ã` `¦`');
});

test('narrator-en review: quoted text with its own curly quotes nests US style; zh-CN is untouched', () => {
  const relic = gallery('curly-quotes');
  for (const x of ALL.filter((a) => a.relic === relic)) {
    const text = all(x.n);
    assert.ok(!/““|””/.test(text), `${x.style}/${x.seed}: doubled curly quotes`);
  }
  const verdicts = STYLES.map((style) => sec(narr(relic, style, 0), 'identify')).join('\n');
  assert.ok(verdicts.includes('‘“Don’t panic!”’'), verdicts);
  assert.deepEqual(PACK.qFor('plain'), ['“', '”']);
  assert.deepEqual(PACK.qFor('say “hi”'), ['‘', '’']);
  const zh = N.narrate(MBX.Engine.analyze(relic, { locale: 'zh-CN' }), { style: 'humor', seed: 0, locale: 'zh-CN' });
  assert.ok(!/‘“/.test(JSON.stringify(zh)), 'zh-CN never borrows the English nesting');
});

test('narrator-en review: signal hints continue the sentence in lowercase, names keep their capitals', () => {
  for (const style of STYLES) {
    const n = narr('ÐÐÐÐÐ', style, 0);
    const id = sec(n, 'identify');
    assert.ok(!/Suspicious features detected: [A-Z][a-z]/.test(id), `${style}: ${id}`);
  }
  const item = PACK.t.signalItem;
  assert.equal(item('A run of letters.', ['`Ð`']), 'a run of letters (e.g., `Ð`)');
  assert.equal(item('Half-width katakana: x', []), 'half-width katakana: x');
  for (const keep of ['Shift_JIS Japanese read as Windows-1252', 'Turkish Windows-1254 read as Windows-1252', 'UTF-8 read as Mac OS Roman',
    'Central European Windows-1250 read as Windows-1252', 'Private Use Area characters', 'C1 control characters', '"锟斤拷": pairs']) {
    assert.equal(item(keep, []), keep, keep);
  }
});

test('narrator-en review: small counts in prose are words, not digits', () => {
  for (const x of ALL) {
    const text = all(x.n).replace(/`[^`]*`/g, 'X');
    assert.ok(!/\b(?:[1-9]|10) times\b/.test(text), `${x.relic}/${x.style}: ${(text.match(/.{0,40}\b\d+ times\b.{0,10}/) || [])[0]}`);
    assert.ok(!/It's \d+\.|^\d+ layers\.|\n\d+ layers\.|has \d+ strata|go: \d+ layers|^\d+ half-width|\. \d+ half-width/m.test(text), `${x.relic}/${x.style}: digit in prose`);
  }
  const snark = SEEDS.map((seed) => sec(narr(gallery('double-layer'), 'snark', seed), 'mechanism')).join('\n');
  assert.ok(/It broke twice\.|Two layers\. Yes|It's two\./.test(snark), snark);
  const dating = sec(narr(gallery('double-layer'), 'humor', 0), 'dating');
  assert.ok(dating.includes('It was misread twice, which means at least two migrations'), dating);
  const T = PACK.t;
  assert.ok(T.note.kana(3, '`ｫ`', 'why').indexOf('The three half-width katakana characters') === 0);
  assert.ok(T.note.errs(3, 'FF').indexOf('Three spots') === 0);
});

test('narrator-en review: the lead-byte note has its article and joins glyph pairs with "and"', () => {
  let leads = 0;
  for (const x of ALL) {
    const mech = sec(x.n, 'mechanism');
    assert.ok(!/By the way, combinations|That's UTF-8 lead byte|lead byte `[0-9A-F]{2}` as [^:]+ shows it: it's the UTF-8 lead byte/.test(mech), `${x.relic}/${x.style}`);
    assert.ok(!/a screen full of `[^`]+`, `/.test(mech), `${x.relic}/${x.style}: comma-joined pair`);
    if (/Combinations starting with `[^`]+` turn up (?:once|twice|\w+ times) in this relic\. That's the UTF-8 lead byte `[0-9A-F]{2}` as /.test(mech)) leads++;
  }
  assert.ok(leads > 0, 'the lead-byte note shows up');
  assert.ok(PACK.t.lead.latin1('`Ã`, `Â`').includes('a screen full of `Ã` and `Â`'));
  assert.ok(PACK.t.lead.cyrillic('`Р`, `С`').includes('a screen full of `Р` and `С`'));
});

test('narrator-en review: retired lines that read like translated Chinese are gone', () => {
  for (const phrase of ['Bad bite, so it just bites crooked', 'crashing at each other', 'The rest, don\'t come to me', 'Just like people',
    'recipe aloud in', 'No wonder its character means', 'tombstone is already engraved', 'the ankle biter', 'memory is literally steaming',
    'Not mojibake, just uninitialized memory', 'Plenty of suspects', 'Conclusion: the locally', 'sounds a lot like mojibake itself',
    'since 2019 16.9', 'mojibake\'s ID card', 'in the programmers\' couplet']) {
    assert.ok(!SRC.includes(phrase), `still in narrator-en.js: ${phrase}`);
  }
  for (const style of STYLES) {
    for (const relic of ['屯屯屯屯屯屯', '葺葺葺葺']) {
      for (const seed of SEEDS) assert.ok(!/steaming/.test(narr(relic, style, seed).subtitle), `${relic}/${style}/${seed}`);
    }
  }
  for (const x of ALL.filter((a) => a.style === 'academic')) {
    assert.ok(!/Conclusion:/.test(sec(x.n, 'closing')), `${x.relic}: the Conclusion section repeats "Conclusion:"`);
  }
});

test('narrator-en review: byte dating stands on its own and the Notepad fix is told once', () => {
  for (const x of ALL) {
    const dating = sec(x.n, 'dating');
    assert.ok(!/As for the telltale/.test(dating), `${x.relic}/${x.style}`);
    assert.ok(!/(?:Age|Dating)\? \*\*[a-z]/.test(dating), `${x.relic}/${x.style}: lowercase era after a question: ${dating}`);
  }
  const tang = sec(narr(gallery('tangtangtang'), 'humor', 0), 'dating');
  assert.ok(/Consider the telltale “烫烫烫”\. Visual C\+\+ Debug builds/.test(tang), tang);
  for (const style of STYLES) {
    for (const seed of SEEDS) {
      const text = all(narr(gallery('notepad-bug'), style, seed));
      const vista = (text.match(/Vista \(2007\)|back in 2007/g) || []).length;
      assert.ok(vista <= 1, `${style}/${seed}: the Vista fix is told ${vista} times`);
    }
  }
});

test('narrator-en review: the academic and snark voices stay in register', () => {
  for (const x of ALL) {
    const text = all(x.n);
    if (x.style === 'academic') assert.ok(!/By the way|Heads-up|you can bet/.test(text), `${x.relic}/${x.seed}: casual aside in the academic voice`);
    assert.ok(!/[Oo]ur conservator (?:inferred|tried)/.test(text), `${x.relic}/${x.style}: "our conservator" in a repair line`);
  }
  assert.ok(!SRC.includes('design Easter egg'), 'KOI8-R note is a design quirk');
  assert.ok(PACK.t.id.inferred('character #5').indexOf('Note: ') === 0);
});

test('narrator-en review: famous-relic lore and loss counts read naturally', () => {
  const kjk = narr(gallery('kunjinkao'), 'humor', 0);
  const easter = sec(kjk, 'easter');
  assert.ok(/\*\*锟斤拷\*\*: Pronounced roughly “kūn jīn kǎo,” this trio/.test(easter) || /Pronounced roughly “kūn jīn kǎo,” this trio/.test(easter), easter);
  assert.ok(!/\*\*锟斤拷\*\*: 锟斤拷/.test(easter), 'the relic name is not repeated');
  assert.ok(/We found (?:one|two|three|\w+) instances? of 锟斤拷\./.test(sec(narr('锟斤拷锟斤拷', 'humor', 0), 'identify')), 'loss count');
  assert.equal(PACK.t.loss.sig('锟斤拷', 1), 'one instance of 锟斤拷');
  assert.equal(PACK.t.loss.sig('锟斤拷', 3), 'three instances of 锟斤拷');
  assert.ok(/Pronounced “tàng tàng tàng”/.test(PACK.SIGNATURE_FACTS.tangtangtang.lore));
});

test('narrator-en review: prose uses curly double quotes only (code spans keep theirs)', () => {
  for (const x of ALL) {
    const prose = all(x.n).replace(/`[^`]*`/g, 'X');
    const at = prose.indexOf('"');
    assert.equal(at, -1, `${x.relic}/${x.style}/${x.seed}: straight quote near ${prose.slice(Math.max(0, at - 30), at + 30)}`);
  }
  // Code keeps its ASCII quotes: `<meta charset="utf-8">` is still a working snippet.
  assert.ok(SRC.includes('`<meta charset="utf-8">`'));
});
