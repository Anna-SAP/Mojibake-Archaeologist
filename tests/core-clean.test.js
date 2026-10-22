'use strict';
// Consolidated clean-input regressions: genuine texts that earlier versions "restored" into
// garbage or called mojibake. Every entry must come back 'clean' with best === null. Cases that
// cannot be fixed without hurting the accuracy benchmark go into KNOWN_GAPS (printed, not
// asserted).

const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const { Engine } = MBX;

const B = String.fromCharCode(92); // backslash
const SHY = String.fromCharCode(0xad); // soft hyphen

const CLEAN = [
  // All-caps accented Latin, foreign marks glued inside Latin words.
  'ESPAÑA', 'MÉXICO', 'AÑO NUEVO', 'FELIZ AÑO NUEVO', 'CRÈME BRÛLÉE', 'SALE: CRÈME BRÛLÉE 50% OFF',
  'ÉCOLE NATIONALE SUPÉRIEURE', 'ATENÇÃO: NÃO ENTRE', 'GRÖSSE', 'MÄRZ', 'NOMBRE,DIRECCIÓN,TELÉFONO,CORREO',
  'INFORMACIÓN', 'HÉLÈNE', 'ÁREA', 'SEÑOR', 'AÑO 2024', 'ÄRGER', 'AÇÚCAR', 'Calle Mayor 5, MADRID, ESPAÑA',
  'CORAÇÃO', 'PROMOÇÃO', 'LIQUIDAÇÃO', 'KÖLN', 'ÆBLE',
  // Single symbols and words whose only non-ASCII evidence would be an invented byte.
  '→', '〒100-0001', '￥100', '◆', '※', '□', '◎', 'GÖTEBORG', 'GRÖSSENTABELLE', 'FARBE: SCHWARZ, GRÖSSE: M', '垚',
  '※ 注意', '→ 次へ', '価格 ￥100',
  // Hex words, magic numbers, ids, register dumps and Windows paths.
  'DECADE', 'FACADE', 'ABCDEF', 'DEADBEEF', 'CAFEBABE', 'FF D8 FF E0', 'A4-5E-60-C2-91-DF', 'f6d0b4767a6c', 'EF BB BF',
  'REG0=FF REG1=A0 REG2=C3', ['D:', 'build', 'x86', 'Release', 'app.exe'].join(B), ['E:', 'projects', 'xe9cms', 'index.php'].join(B),
  'CAFE BABE', 'DEAD BEEF', 'C:' + B + 'new' + B + 'x41', 'Copy the DLL to ' + ['C:', 'tools', 'x86', 'bin'].join(B) + ' and restart.',
  // Half-width katakana (bank and mainframe text).
  'ﾃｽﾄ', 'ｶﾌﾞｼｷｶﾞｲｼｬ ﾃｽﾄ ﾃﾞｰﾀ 12345', '振込先：ﾐｽﾞﾎｷﾞﾝｺｳ ｼﾌﾞﾔｼﾃﾝ ﾌﾂｳ 1234567 ﾔﾏﾀﾞ ﾀﾛｳ', 'ｱｲｳｴｵ', 'ｶﾀｶﾅ', 'ﾌﾘｶﾞﾅ',
  // Korean jamo, Roman numerals, full-width ASCII, enclosed ideographs.
  'ㅋㅋㅋ', 'ㅋㅋㅋㅋ ㅎㅎ ㅠㅠ', 'ㄱㄱ', 'Ⅰ Ⅱ Ⅲ Ⅳ ⅰⅱⅲ', 'ＡＢＣ１２３！？', 'ＴＥＬ：０３－１２３４－５６７８', '１２３', 'Ｈｅｌｌｏ',
  '￥１，０００', '㈱', '・', '진짜? ㅋㅋㅋㅋ 대박', '我的ＩＤ是１２３', 'ＡＢＣ株式会社',
  // Box drawing: trees, tables, progress bars, kaomoji.
  'project\n├── src\n│   ├── app.js\n│   └── engine.js\n├── tests\n└── README.md', '┌────────┐\n│ Hello  │\n└────────┘',
  'Downloading ████████░░░░ 67%', '(╯°□°）╯︵ ┻━┻', '.\n├── index.html\n└── src',
  // Typographic and format characters.
  'Die Donau' + SHY + 'dampf' + SHY + 'schiff' + SHY + 'fahrt ist schön.', 'This is impor' + SHY + 'tant infor' + SHY + 'mation.',
  'Er sagte ‚ja‘.', '‹a›', '25 m³', 'ÇÖĞÜŞ', '©', '€', '™', 'x²', '£', '°', '№', '℃', '10 m²', 'ÄÖÜ',
  // Single bytes that must not become Thai / Arabic; Nordic and Spanish words.
  '¹', 'Þórður', 'Reykjavík', 'Ærøskøbing', 'Smørrebrød', 'mañana',
  // Rare Han of names, Cantonese particles.
  '冇', '嘅', '咗', '王喆', '周堃', '嘅咗冇', '喆', '堃', '囧', '槑', '淼', '珺',
  // Emphatic question marks after Chinese.
  '真的吗???', '什么???', '这是什么??? 不知道??',
  // URL fragments without an inner escape.
  'a%20b', '100%25 sure',
  // Decomposed (macOS NFD) accents.
  'Tiếng Việt'.normalize('NFD'), 'café'.normalize('NFD'), 'Größe'.normalize('NFD'), 'São Paulo'.normalize('NFD'),
];

// Known remaining gaps: { text, why }. Printed so they stay visible.
const KNOWN_GAPS = [];

test('core-clean: genuine texts come back clean (consolidated regression list)', () => {
  const bad = [];
  for (const t of CLEAN) {
    const r = Engine.analyze(t);
    if (r.status !== 'clean' || r.best !== null) {
      bad.push(`${JSON.stringify(t)} -> ${r.status} ${JSON.stringify(r.best && r.best.output)} ${r.best ? r.best.label : ''}`);
    }
  }
  for (const g of KNOWN_GAPS) {
    const r = Engine.analyze(g.text);
    console.log(`  [core-clean] known gap ${JSON.stringify(g.text)} -> ${r.status} (${g.why})`);
  }
  assert.equal(bad.length, 0, `${bad.length} not clean:\n    ${bad.join('\n    ')}`);
});

test('core-clean: question-mark runs that stand for lost words are still irrecoverable', () => {
  for (const t of ['Hello ????, welcome to ??.', 'Name: ??', '??: ??, ??: 13800138000', 'Name: ???  City: ??', '??????', '???? ?????']) {
    const r = Engine.analyze(t);
    assert.equal(r.status, 'irrecoverable', t);
    assert.ok(r.signatures.some((s) => s.id === 'question-marks'), t);
  }
  // The nullish-coalescing operator and French spacing are not losses.
  for (const t of ['const x = a ?? b;', 'x ??= 5', 'Où est la gare ? Ça coûte combien ?']) {
    assert.equal(Engine.analyze(t).status, 'clean', t);
  }
});
