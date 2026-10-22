'use strict';
// Accuracy benchmark for MBX.Engine: real mojibake made with MBX.Forge.corrupt() from a
// multilingual corpus, pushed through every applicable docs §8 accident (plus lossy and
// multi-layer variants), then handed to Engine.analyze().
//
//   node tests/run.js corpus                 summary per chain + every failure
//   MBX_VERBOSE=1 node tests/run.js corpus   also lists the successful cases
//
// Targets: >= 97 % exact restoration on information-preserving cases, >= 85 % on lossy cases,
// every GALLERY piece right, and no clean text "repaired".

const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const { Engine, Forge } = MBX;
const VERBOSE = !!process.env.MBX_VERBOSE;

// ---------------------------------------------------------------------------
// Originals (genuine texts). Every one is also part of the clean-text check below.
// ---------------------------------------------------------------------------

const ORIGINALS = [
  // Simplified Chinese, short to long
  { id: 'zh-nihao', text: '你好' },
  { id: 'zh-dajiahao', text: '大家好' },
  { id: 'zh-welcome', text: '欢迎光临本店' },
  { id: 'zh-weather', text: '今天天气很好，我们一起去公园散步吧！' },
  { id: 'zh-server', text: '这个问题已经解决了，请重新启动服务器。' },
  { id: 'zh-db', text: '数据库连接失败，请检查配置文件中的用户名和密码。' },
  { id: 'zh-capital', text: '北京是中华人民共和国的首都。' },
  { id: 'zh-novel', text: '《红楼梦》是中国古典小说的巅峰之作，作者曹雪芹。' },
  {
    id: 'zh-paragraph',
    text: '字符编码是计算机存储和传输文字的基础。当一段文字用一种编码写入，却用另一种编码读取时，就会出现乱码。' +
      '程序员们经常在调试数据库、网页和文件名时遇到这种问题，有时需要花费几个小时才能找到原因。',
  },
  // Traditional Chinese
  { id: 'zh-hant-test', text: '這是一個測試，我們說的話會被記錄下來。' },
  { id: 'zh-hant-db', text: '繁體中文的資料庫編碼問題讓工程師們頭痛了很多年。' },
  { id: 'zh-hant-taipei', text: '臺北市政府' },
  // Japanese
  { id: 'ja-konnichiwa', text: 'こんにちは' },
  { id: 'ja-thanks', text: 'これはテストです。ありがとうございます。' },
  { id: 'ja-mojibake', text: '日本語の文字化けは本当に厄介な問題です。' },
  { id: 'ja-address', text: '東京都千代田区丸の内一丁目' },
  { id: 'ja-katakana', text: 'カタカナのメッセージを表示します' },
  // Korean
  { id: 'ko-hello', text: '안녕하세요' },
  { id: 'ko-sentence', text: '한국어 문자 인코딩 문제를 해결했습니다.' },
  { id: 'ko-thanks', text: '감사합니다' },
  // Cyrillic and Greek
  { id: 'ru-hello', text: 'Привет, мир!' },
  { id: 'ru-pangram', text: 'Съешь же ещё этих мягких французских булок, да выпей чаю.' },
  { id: 'ru-moscow', text: 'Москва — столица России.' },
  { id: 'uk-hello', text: 'Привіт, як справи? Їжак і ґудзик.' },
  { id: 'el-hello', text: 'Καλημέρα κόσμε' },
  { id: 'el-sentence', text: 'Η γλώσσα μας είναι πολύ όμορφη.' },
  // Latin-script languages
  { id: 'fr-cafe', text: 'Le café est très chaud, à bientôt !' },
  { id: 'fr-gare', text: "Où est la gare ? Ça coûte combien d'euros ?" },
  { id: 'de-groesse', text: 'Größe und Übergröße für Mädchen' },
  { id: 'de-fox', text: 'Der schnelle braune Fuchs springt über den faulen Hund.' },
  { id: 'es-library', text: '¿Dónde está la biblioteca? Mañana es el cumpleaños de mi niño.' },
  { id: 'pt-info', text: 'A informação não está disponível nesta região.' },
  { id: 'pt-saopaulo', text: 'São Paulo é a maior cidade do Brasil.' },
  { id: 'pl-pangram', text: 'Zażółć gęślą jaźń' },
  { id: 'pl-lodz', text: 'Łódź to piękne miasto.' },
  { id: 'tr-chars', text: 'Türkçe karakterler: ş, ğ, ı, ö, ü, ç' },
  { id: 'tr-istanbul', text: 'İstanbul’da güzel bir gün.' },
  { id: 'cs-pangram', text: 'Příliš žluťoučký kůň úpěl ďábelské ódy.' },
  // English with typography, emoji, mixed technical text
  { id: 'en-quotes', text: '“Don’t panic!” she said — it’s only a test…' },
  { id: 'en-price', text: 'The price is €25 — that’s a bargain.' },
  { id: 'emoji-party', text: 'Party time 🎉😀' },
  { id: 'emoji-zh', text: '今天很开心😄🎉' },
  { id: 'mixed-react', text: '我们使用 React 18 和 TypeScript 构建前端，API 返回 JSON 格式。' },
  { id: 'mixed-python', text: '用Python写一个函数' },
  { id: 'mixed-launch', text: 'iPhone 15 Pro 发布会将于明天举行' },
  // Product names and file names
  { id: 'product-cafe', text: 'Café Müller® Crème Brûlée' },
  { id: 'product-pokemon', text: 'Pokémon Café Mix' },
  { id: 'file-report', text: '报告.docx' },
  { id: 'file-minutes', text: '会议纪要_2024年.pdf' },
  { id: 'file-nihao', text: '你好.txt' },
  { id: 'file-ja', text: 'プレゼン資料.pptx' },
  { id: 'file-resume', text: 'résumé_final.pdf' },
  // Plain ASCII (only the UTF-16 accident applies to these)
  { id: 'ascii-bush', text: 'Bush hid the facts' },
  { id: 'ascii-app', text: 'this app can break' },
  { id: 'ascii-notepad', text: 'Notepad saved this file as plain text' },
];

// ---------------------------------------------------------------------------
// Accidents. Single layers cover docs §8 plus realistic neighbours.
// ---------------------------------------------------------------------------

const L = (encoding, misreadAs) => ({ encoding, misreadAs });
const one = (e, w, opts, tag) => ({ id: `${e}>${w}${tag ? ' ' + tag : ''}`, chain: [L(e, w)], opts: opts || {} });

const CHAINS = [
  one('utf-8', 'windows-1252'),
  one('utf-8', 'iso-8859-1'),
  one('utf-8', 'gbk'),
  one('utf-8', 'big5'),
  one('utf-8', 'shift_jis'),
  one('utf-8', 'euc-kr'),
  one('utf-8', 'windows-1251'),
  one('utf-8', 'koi8-r'),
  one('utf-8', 'macintosh'),
  one('utf-8', 'cp437'),
  one('utf-8', 'windows-1250'),
  one('utf-8', 'windows-1253'),
  one('utf-8', 'windows-1254'),
  one('gbk', 'windows-1252'),
  one('gbk', 'iso-8859-1'),
  one('gbk', 'big5'),
  one('gbk', 'shift_jis'),
  one('gbk', 'cp437'),
  one('big5', 'gbk'),
  one('big5', 'windows-1252'),
  one('shift_jis', 'windows-1252'),
  one('shift_jis', 'gbk'),
  one('euc-jp', 'shift_jis'),
  one('euc-kr', 'windows-1252'),
  one('koi8-r', 'windows-1251'),
  one('windows-1251', 'koi8-r'),
  one('koi8-r', 'iso-8859-1'),
  one('windows-1251', 'windows-1252'),
  one('windows-1252', 'utf-16le'),
  one('utf-16le', 'windows-1252'),
  // lossy variants
  one('utf-8', 'windows-1252', { dropInvisible: true }, '+dropInvisible'),
  one('utf-8', 'windows-1252', { nbspToSpace: true }, '+nbspToSpace'),
  one('utf-8', 'windows-1252', { dropInvisible: true, nbspToSpace: true }, '+drop+nbsp'),
  one('utf-8', 'gbk', { stripReplacement: true }, '+stripReplacement'),
  one('utf-8', 'shift_jis', { stripReplacement: true }, '+stripReplacement'),
  // multiple layers
  { id: 'utf-8>windows-1252 ×2', chain: [L('utf-8', 'windows-1252'), L('utf-8', 'windows-1252')], opts: {} },
  { id: 'utf-8>windows-1252 ×3', chain: [L('utf-8', 'windows-1252'), L('utf-8', 'windows-1252'), L('utf-8', 'windows-1252')], opts: {} },
  { id: 'utf-8>gbk, utf-8>windows-1252', chain: [L('utf-8', 'gbk'), L('utf-8', 'windows-1252')], opts: {} },
  { id: 'utf-8>windows-1252, utf-8>gbk', chain: [L('utf-8', 'windows-1252'), L('utf-8', 'gbk')], opts: {} },
  { id: 'gbk>windows-1252, utf-8>windows-1252', chain: [L('gbk', 'windows-1252'), L('utf-8', 'windows-1252')], opts: {} },
];

// Accidents where the bytes are destroyed on the way: the engine must not claim a restoration.
const IRREVERSIBLE = [one('windows-1252', 'utf-8'), one('gbk', 'utf-8'), one('shift_jis', 'utf-8')];

// The triple layer is expensive to apply to everything; a few originals are enough.
const TRIPLE_ONLY = new Set(['zh-dajiahao', 'fr-cafe', 'ja-konnichiwa', 'ru-hello']);

const REPLACEMENT = String.fromCharCode(0xfffd);
const countOf = (s, ch) => s.split(ch).length - 1;

/** Builds the benchmark cases: [{ id, chain, original, relic, lossy }]. */
function buildCases(chains) {
  const cases = [];
  for (const c of chains) {
    for (const o of ORIGINALS) {
      if (c.chain.length === 3 && !TRIPLE_ONLY.has(o.id)) continue;
      const r = Forge.corrupt(o.text, c.chain, c.opts);
      if (!r.ok || r.output === o.text) continue;
      // Pure ASCII relics are "clean" by contract (docs §6 step 1), except NUL-laced UTF-16 ones.
      if (!/[^\x00-\x7f]/.test(r.output) && !/\x00/.test(r.output)) continue;
      const lossy = Object.keys(c.opts).length > 0 || r.layers.some((l) => countOf(l.output, '\uFFFD') > countOf(l.input, '\uFFFD'));
      cases.push({ chainId: c.id, id: `${c.id} | ${o.id}`, original: o.text, relic: r.output, lossy });
    }
  }
  return cases;
}

/**
 * Lossy success: exact, or "no wrong characters": the output is the original except for
 * U+FFFD runs that admit a loss (each run may stand for any lost stretch of the original).
 */
function faithful(output, original) {
  if (output === original) return true;
  if (typeof output !== 'string' || output.indexOf(REPLACEMENT) < 0) return false;
  const parts = output.split(REPLACEMENT).filter((p, i, all) => p || i === 0 || i === all.length - 1);
  // Greedy left-to-right match of the surviving pieces; the first and last are anchored.
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i === 0) {
      if (!original.startsWith(p)) return false;
      pos = p.length;
    } else if (i === parts.length - 1) {
      return original.length - p.length >= pos && original.endsWith(p);
    } else {
      const at = original.indexOf(p, pos);
      if (at < 0) return false;
      pos = at + p.length;
    }
  }
  return true;
}

function short(s, n) {
  const t = JSON.stringify(s);
  return t.length > n ? t.slice(0, n - 1) + '…"' : t;
}

// ---------------------------------------------------------------------------
// Running the benchmark once; the tests below assert on the collected numbers.
// ---------------------------------------------------------------------------

let RUN = null;

function runBenchmark() {
  if (RUN) return RUN;
  const t0 = Date.now();
  const cases = buildCases(CHAINS);
  const perChain = new Map();
  const failures = [];
  let exactOk = 0;
  let exactN = 0;
  let lossyExact = 0;
  let lossyFaithful = 0;
  let lossyN = 0;
  for (const c of cases) {
    const r = Engine.analyze(c.relic);
    const out = r.best ? r.best.output : null;
    const restored = r.status === 'restored' || r.status === 'partial';
    const exact = restored && out === c.original;
    const ok = c.lossy ? restored && faithful(out, c.original) : exact;
    const row = perChain.get(c.chainId) || { n: 0, ok: 0, lossy: 0 };
    row.n++;
    if (c.lossy) row.lossy++;
    if (ok) row.ok++;
    perChain.set(c.chainId, row);
    if (c.lossy) {
      lossyN++;
      if (exact) lossyExact++;
      if (ok) lossyFaithful++;
    } else {
      exactN++;
      if (exact) exactOk++;
    }
    if (!ok) failures.push({ c, r, out });
    else if (VERBOSE) console.log(`  ok  ${c.id}: ${short(c.relic, 40)} -> ${short(out, 40)}`);
  }

  // Irreversible accidents: a restoration claim must be faithful to the original.
  const irr = buildCases(IRREVERSIBLE);
  const falseClaims = [];
  for (const c of irr) {
    const r = Engine.analyze(c.relic);
    if ((r.status === 'restored' || r.status === 'partial') && !faithful(r.best.output, c.original)) {
      falseClaims.push({ c, r, out: r.best.output });
    }
  }

  RUN = {
    cases, perChain, failures, exactOk, exactN, lossyExact, lossyFaithful, lossyN, irr, falseClaims,
    ms: Date.now() - t0,
  };

  console.log(`\n  [corpus] ${cases.length} cases from ${ORIGINALS.length} originals × ${CHAINS.length} accidents (${RUN.ms} ms)`);
  for (const [id, row] of perChain) {
    const pct = ((100 * row.ok) / row.n).toFixed(1).padStart(5);
    const tag = row.lossy ? `(${row.lossy === row.n ? 'all' : row.lossy} lossy) ` : '';
    console.log(`  [corpus] ${pct}%  ${String(row.ok).padStart(3)}/${String(row.n).padEnd(3)} ${tag}${id}`);
  }
  console.log(`  [corpus] non-lossy exact: ${exactOk}/${exactN} = ${((100 * exactOk) / exactN).toFixed(1)}%`);
  console.log(`  [corpus] lossy: exact ${lossyExact}/${lossyN} = ${((100 * lossyExact) / lossyN).toFixed(1)}%, ` +
    `exact-or-faithful ${lossyFaithful}/${lossyN} = ${((100 * lossyFaithful) / lossyN).toFixed(1)}%`);
  console.log(`  [corpus] irreversible accidents: ${irr.length} cases, ${falseClaims.length} false restoration claims`);
  for (const f of failures.concat(falseClaims)) {
    const best = f.r.best;
    console.log(`  [corpus] FAIL ${f.c.id}: ${short(f.c.relic, 36)} -> ${f.r.status} ${short(f.out, 36)}` +
      `${best ? ' via ' + best.label : ''} (want ${short(f.c.original, 30)})`);
  }
  return RUN;
}

test('corpus: the benchmark is large and diverse enough', () => {
  const run = runBenchmark();
  assert.ok(ORIGINALS.length >= 40, `${ORIGINALS.length} originals`);
  assert.ok(run.cases.length >= 250, `${run.cases.length} cases`);
  assert.ok(run.lossyN >= 40, `${run.lossyN} lossy cases`);
  assert.ok(run.cases.some((c) => c.chainId.includes('×2')), 'double layers present');
});

test('corpus: >= 97% exact restoration on information-preserving accidents', () => {
  const run = runBenchmark();
  const rate = run.exactOk / run.exactN;
  assert.ok(rate >= 0.97, `exact rate ${(100 * rate).toFixed(1)}% (${run.exactOk}/${run.exactN})`);
});

test('corpus: >= 85% restoration on lossy accidents', () => {
  const run = runBenchmark();
  const rate = run.lossyFaithful / run.lossyN;
  assert.ok(rate >= 0.85, `lossy rate ${(100 * rate).toFixed(1)}% (${run.lossyFaithful}/${run.lossyN})`);
});

test('corpus: irreversible accidents are never "restored" into something else', () => {
  const run = runBenchmark();
  assert.ok(run.irr.length >= 20, `${run.irr.length} irreversible cases`);
  assert.equal(run.falseClaims.length, 0, run.falseClaims.map((f) => f.c.id).join('; '));
});

// ---------------------------------------------------------------------------
// GALLERY: every museum piece is restored exactly (or declared irrecoverable with its signature)
// ---------------------------------------------------------------------------

const GALLERY_SIGNATURE = { kunjinkao: 'kunjinkao', tangtangtang: 'tangtangtang', 'resume-lost': 'replacement' };

test('corpus: every GALLERY relic is identified', () => {
  const bad = [];
  for (const g of Forge.GALLERY) {
    const r = Engine.analyze(g.relic);
    if (g.expect === null) {
      const sig = GALLERY_SIGNATURE[g.id];
      const ok = r.status === 'irrecoverable' && (!sig || r.signatures.some((s) => s.id === sig));
      if (!ok) bad.push(`${g.id}: ${r.status} [${r.signatures.map((s) => s.id)}]`);
    } else if (r.status !== 'restored' || !r.best || r.best.output !== g.expect) {
      bad.push(`${g.id}: ${r.status} ${short(r.best && r.best.output, 40)}`);
    }
  }
  assert.equal(bad.length, 0, bad.join('; '));
});

// ---------------------------------------------------------------------------
// Clean texts: never "fixed"
// ---------------------------------------------------------------------------

const CLEAN_EXTRA = [
  '价格：¥1,299.00（含税），限时优惠！',
  '请注意：本系统将于 2024-10-21 22:00 进行维护。',
  '他说：“我们明天见。”',
  '温度：-5 °C ~ 12 °C，湿度 80%',
  '3.14159 × 2 = 6.28318',
  '## 安装说明\n\n- 运行 `npm install`\n- 打开 **index.html** 即可',
  'const 名字 = "张三"; // 用户名',
  'print("Hello, 世界")',
  'https://zh.wikipedia.org/wiki/北京',
  'She said, “It’s a beautiful day.”',
  'Ünïcödé façade naïve coöperate',
  'Ελληνικά και English μαζί',
  '日本語とEnglishが混ざった文章です。',
  '👨\u200D👩\u200D👧 family ❤️ love',
  'Ведомость № 42 от 01.02.2024',
  '서울특별시 강남구',
  'Mañana, señor.',
  '© 2024 Example Corp. All rights reserved.',
  'São João, Ação, Coração',
  'Ölçüm sonuçları: 25 °C',
  // All-caps accented Latin, half-width katakana, full-width ASCII, box drawing (core regressions;
  // the full list is tests/core-clean.test.js).
  'ESPAÑA',
  'CRÈME BRÛLÉE',
  'ATENÇÃO: NÃO ENTRE',
  'NOMBRE,DIRECCIÓN,TELÉFONO,CORREO',
  'MÄRZ',
  'ｶﾌﾞｼｷｶﾞｲｼｬ ﾃｽﾄ ﾃﾞｰﾀ 12345',
  'ＡＢＣ１２３！？',
  '┌────────┐\n│ Hello  │\n└────────┘',
];

test('corpus: clean texts come back clean and unchanged', () => {
  const texts = ORIGINALS.map((o) => o.text).filter((t) => /[^\x00-\x7f]/.test(t)).concat(CLEAN_EXTRA);
  assert.ok(texts.length >= 40, `${texts.length} clean texts`);
  const bad = [];
  for (const t of texts) {
    const r = Engine.analyze(t);
    if (r.status !== 'clean' || r.best !== null) {
      bad.push(`${short(t, 30)} -> ${r.status} ${short(r.best && r.best.output, 30)} ${r.best ? r.best.label : ''}`);
    }
  }
  if (bad.length) console.log('  [corpus] clean false positives:\n    ' + bad.join('\n    '));
  assert.equal(bad.length, 0, `${bad.length} false positives`);
});

module.exports = { ORIGINALS, CHAINS, CLEAN_EXTRA, buildCases, faithful };
