'use strict';
// zh-CN golden master (docs/ARCHITECTURE.md §11.2, "默认行为不变"): with no locale passed and zh-CN
// current, every Chinese output must stay byte-for-byte what it was before the i18n work.
//
// The GOLDEN table holds a short SHA-1 of each output, per input and field, computed from the
// pre-i18n tree (git HEAD of feat/i18n-en-us's base, Chinese only) and checked equal to the
// i18n tree when it was recorded. Covered: Engine labels, language names, signature titles/notes
// and signal hints; Narrator.narrate (3 styles x seeds 0 and 7) of the engine's verdict and of an
// adopted candidate (deriveView(result, 1)); factsFor; LLM.buildPrompt (system + user, 3 styles);
// the Markdown report of both views; App.util status copy, language fact, step titles, chain
// sentence, repair lines and dig log; Forge gallery/presets, styles, providers, encodings and
// relative times.
//
// A failing field means Chinese text changed. If that change is intended (a deliberate zh copy
// edit), regenerate:  node tests/i18n-zh-golden.test.js --write   (and say so in the commit).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { test, assert, loadAll } = require('./harness');

const B = String.fromCharCode(92);
const STYLES = ['humor', 'academic', 'snark'];
const SEEDS = [0, 7];
const DATE = new Date(2026, 0, 2, 3, 4); // local time: the report prints it without a zone
const FIELDS = ['engine', 'narr0', 'narr1', 'facts', 'prompt', 'report0', 'report1', 'util0', 'util1'];

const hash = (value) => crypto.createHash('sha1')
  .update(typeof value === 'string' ? value : JSON.stringify(value === undefined ? null : value)).digest('hex').slice(0, 12);

/** Every input of the guard: the gallery, a spread of statuses/scripts/escapes, famous relics. */
function inputsOf(M) {
  const forged = (text, chain, opts) => {
    const r = M.Forge.corrupt(text, chain.map(([encoding, misreadAs]) => ({ encoding, misreadAs })), opts || {});
    if (!r.ok) throw new Error(`forge failed for ${text}: ${r.error}`);
    return r.output;
  };
  const escaped = (text, scheme) => {
    const r = M.Forge.escape(text, scheme, {});
    if (!r.ok) throw new Error(`escape failed for ${text}: ${r.error}`);
    return r.output;
  };
  const list = M.Forge.GALLERY.map((g) => g.relic).concat([
    '', '   ', 'Hello world', '今天天气很好，我们去公园散步吧。', 'ÉCOLE NATIONALE', 'Donâ€™t worry, itâ€™s fine.',
    'Ã¥Â¤Â§Ã¥Â®Â¶Ã¥Â¥Â½', '%E4%BD%A0%E5%A5%BD', `${B}u4f60${B}u597d`, '&#20320;&#22909;', 'E4 BD A0 E5 A5 BD',
    '锟斤拷锟斤拷', '烫烫烫烫', '屯屯屯', 'ï»¿Hello', '????????', 'xq7#@!kz', `Thanks for the update. ${'a'.repeat(30)} cafÃ© here`,
    '³×', 'Ã…', 'ÄãºÃ', 'SÃ£o Paulo', 'ðŸ˜€ å¼€å¿ƒ', '桴獩愠灰挠湡戠敲歡', 'Ã¦â€“â€¡Ã§â€°Â©',
    'Hello, world! Nothing to see here.',
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
    `订单状态 ${forged('已发货', [['utf-8', 'windows-1252']])} 请查收`,
    `Статус заказа: ${forged('отправлен', [['utf-8', 'windows-1252']])} - спасибо`,
    escaped('数据库连接失败', 'percent'),
    escaped('文件名', 'hex-escape'),
    escaped('编码测试', 'quoted-printable'),
    escaped('你好世界', 'hex-dump'),
    escaped('考古学', 'html-entity'),
    escaped(forged('大家好', [['utf-8', 'windows-1252']]), 'percent'),
    '锟斤拷锟斤拷锟斤拷', '屯屯屯屯屯屯', 'ï»¿Hello BOM', '????? ???? ?? ???', '�����', 'Ã¦ zq Ã xx Â',
    ' ­﻿\t\n\r\u0081x',
  ]);
  return [...new Set(list)];
}

const pickHyp = (x) => x && { output: x.output, label: x.label, lang: x.lang && x.lang.name, confidence: x.confidence };
// The narration fields of the contract (§7); fields added later are not part of the zh guard.
const narrFields = (n) => n && {
  exhibitId: n.exhibitId, title: n.title, subtitle: n.subtitle, era: n.era, site: n.site, tags: n.tags,
  sections: n.sections, docent: n.docent, plainText: n.plainText,
};

/** Short hashes of every zh-CN output for one input: [FIELDS…] ('-' where a view does not exist). */
function hashInput(M, U, input) {
  const r = M.Engine.analyze(input);
  const nr = U.normalizeResult(r, input);
  const views = [U.deriveView(nr, null)];
  if (nr.alternatives && nr.alternatives.length) views.push(U.deriveView(nr, 1));
  const out = { narr1: '-', report1: '-', util1: '-' };
  out.engine = hash({
    status: r.status, best: pickHyp(r.best), alts: (r.alternatives || []).map(pickHyp),
    sigs: (r.signatures || []).map((s) => [s.id, s.title, s.match, s.note]), signals: (r.signals || []).map((s) => [s.type, s.hint]),
  });
  views.forEach((view, vi) => {
    const narr = [];
    for (const style of STYLES) for (const seed of SEEDS) narr.push(narrFields(M.Narrator.narrate(view, { style, seed })));
    out[`narr${vi}`] = hash(narr);
    const n0 = M.Narrator.narrate(view, { style: 'humor', seed: 0 });
    out[`report${vi}`] = hash(U.buildMarkdownReport({
      view, engineBest: nr.best, exhibitId: n0.exhibitId, date: DATE, narrationText: U.narrationPlainText(n0),
    }));
    const steps = (view.best && view.best.steps) || [];
    out[`util${vi}`] = hash({
      status: U.statusCopy(view, nr.best),
      lang: U.languageFact(view),
      titles: steps.map((s) => U.stepTitle(s)),
      chain: U.chainSentence(steps),
      repairs: steps.flatMap((s, i) => (s.repairs || []).map((rep) => U.repairLine(Number.isInteger(rep.step) ? rep : Object.assign({}, rep, { step: i }), steps))),
      dig: vi ? null : U.digLines(input),
      chars: vi ? null : Array.from(input).slice(0, 24).map((ch) => U.displayChar(ch)),
    });
  });
  const n = M.Narrator.narrate(r, { style: 'humor', seed: 0 });
  const facts = M.Narrator.factsFor(r);
  out.facts = hash(facts);
  out.prompt = hash(STYLES.map((style) => {
    const p = M.LLM.buildPrompt(r, n, facts, style);
    return [p.system, p.user];
  }));
  return FIELDS.map((f) => out[f]);
}

/** The whole golden record of one tree: M = its MBX namespace, U = its App.util. */
function compute(M, U) {
  const now = Date.UTC(2026, 5, 1);
  const shared = {
    gallery: hash(M.Forge.GALLERY.map((g) => [g.id, g.title, g.blurb])),
    presets: hash(M.Forge.PRESETS.map((p) => [p.id, p.name, p.story])),
    styles: hash(M.Narrator.STYLES.map((s) => [s.id, s.name, s.tagline])),
    providers: hash(M.LLM.listProviders().map((p) => [p.id, p.name])),
    encodings: hash(M.Codecs.ENCODINGS.map((e) => [e.id, e.zh])),
    times: hash([0, 30e3, 61e3, 5 * 60e3, 3600e3, 7200e3, 86400e3, 3 * 86400e3].map((d) => U.relativeTime(now - d, now))),
  };
  const inputs = {};
  for (const input of inputsOf(M)) inputs[hash(input).slice(0, 8)] = hashInput(M, U, input);
  return { shared, inputs };
}

// BEGIN GOLDEN (generated; see the header)
const GOLDEN = {
  shared: {'gallery': '110ef78d7a95', 'presets': '4ff15e02091c', 'styles': 'd24eccbd0e23', 'providers': '25673aa7d6bc', 'encodings': '7ba1b149a845', 'times': '012dfd9d670e'},
  inputs: {
    '57707286': '2638eef682d6 e0f0c94164d3 - af8a52bacdfd 4d36cc2434fc 93c63530a450 - d474fc7f977f -',
    'cf01b2be': 'dc4497bb7307 ecadfefab75c e287c766ee1d 99e586dabe67 ebe5c4dfaf46 03f8fabd96c1 eee33ceee57f 99e7ba7874fe df81de3e34a7',
    '25af0c29': 'b5e5334c1074 dddc326f9989 - 56b92c9ca710 60cf10d5130c 8bf8d950089e - bb965abfca18 -',
    'e4810ac5': 'de1acbd6126d e4985e87bfc8 bae53a92f808 4327c4427cc2 cfb813937e30 b0f692504438 92dd367080d9 ce6cb94f86b9 a51bb18b4a2c',
    'ff216318': '8b1ec1a053ff 0a6216c6f646 - c8a72d2147f0 7a97bbce313a 1c96746557dc - 2326dabe6275 -',
    '893774bf': '7f8d4ba05ce0 453fcfe25dc0 - 90b6bad76590 4f948facfbee 88476b626b56 - ff8c9a66192d -',
    'c4da177b': '404da2ba37ad 4c7aa2f40b82 5173877cbdd6 1efcf15326ad 428017f4f9bf 9ccab920607c 3e56221bd84d 1a8178f0ca92 5a831a6f7a1e',
    'e3bd5593': '5f712f371b4d 42edab5c9593 8b823376f37c 9b562fa4e064 54cabec62fe7 b294e77851b3 5cd61fcea3f2 722f8fd3a4ca 9e7182eb625f',
    '9176f100': 'bae079fb8308 bddfe8de3da9 ead518212b42 9f5c46bba206 981748031a4c ec2a32db5080 f659d8b66332 ec01baa31166 4d2f9e8e1603',
    '1f376bcd': '413878125961 e671d433caf7 12e4f66a33bd fc24c9e833a0 2f638c31a1ff 798d7ce54d4d a1242cc37276 d8298e841737 aad1fbb634cc',
    'b0ac2674': 'c560045baa52 e875be8e78b7 b0bd25099f08 eea3466a927c 2455b8ba4747 83ff4c5f2a7d 2c3fc8576cb7 a83a4bf5dbf7 8e728e150fb2',
    'f277b6b1': '18b7c09f054f e5121f3f6cef b887d38570b3 9e846e5bde43 2cfbc650f33a d0855827b5a0 dc549e29cc05 4ac872252ea8 59e80f5e1759',
    '0361d7be': '788eaa2f099a 6bb4e0f5a511 0e855f9ab5d8 22808bf7a671 558693f25be3 505a0696e786 e3e175d5a3f6 0538c29c1d5b 90aae39786ba',
    '3ae98a27': '3b55f1325b9d b664a0ff69b5 ea07d5eacb51 8b5605847b45 cdecf065184e f7d61e3efdcd 75194896b9a5 5e862effa8f1 dee8d888a032',
    '804da311': '2086d3c7d192 eecde9bcabf4 0e6a050f8914 047993768af7 475475256f74 85d5d289c9d2 ccf76d9f39d7 5f7b1661cad2 58bac62ffcef',
    'bfc55a2f': 'd204d3376c64 db1990f00ec8 8705a1f1bb73 1c4cf4e1907b ca28651dd37f 4b916ba534b5 d28a1ad82c43 4b5156ab4cae 280bd288e6ca',
    '2d93685d': 'a265987b572d e8336cadcad2 3f8b7c342650 b2506835ac3b 85bcb587f714 2c169fece327 3f497b5848d8 bd6ec6caf070 44fce3611eb5',
    '94f4d9da': 'b3e05abb9307 f684532edae9 - 806a143a6bd2 722c2e379ad6 e46dbce99b5c - dbc2881c5420 -',
    'cdd7a40e': '21e905d27c20 95b7939d9d80 - 4e0786d48598 8653e735dceb 0209c2f3d2b0 - 975b28bb5085 -',
    '68c8097e': '780a258f7f56 10adba940bba aa763e3bf50f dee0ee332104 413cafcbbbb6 311a69e261b6 e3ae14e5f376 7bf71a07b8ba 60b91882dc95',
    '0ec0b512': 'ca56055d5e89 d38ae9dc4bf8 - a9a423376878 ee76c9aac8ce d8e5fb6cea70 - d0a161c43ca6 -',
    'da39a3ee': '546332d638ec 2e387e7df68b - aeb64d1e11e0 149b9b84af7c c8c9b90313d2 - 862199da6313 -',
    '088fb1a4': '546332d638ec 32e463e1a289 - 190062b8ab92 953067c0c042 3d687f6188c7 - d2624375b0bf -',
    '7b502c3a': '546332d638ec 68236754da04 - a50944391104 8240ee38b5cc d1d3464c6aae - 0eaa1f744a33 -',
    '101e74d3': '546332d638ec 76b091cbca6f - c7ca91ca5f88 9f290564b8f5 b38f2c117f55 - fc9e66f79e01 -',
    'b6823aeb': '546332d638ec 8e506b32272b - ca5ca2a4d824 cade34677f3c 3481e240aed2 - 479fd164a2dc -',
    '8de440a3': '543d2da4a90a 41f752d7644e 6adf7f8d26af fd763ec5eb61 b6ad5d460143 910b7e3e73c4 729d5aabd28e d41e293b2b8e d593c34cdd8d',
    '591e91cb': '4edcb235b96b 4b6cd9ca177b c36b77c0b97d d6628e0d049b 746fc04caaa1 9582a1e43f7d 56e750a1c8a6 b20894f5bd4a 6da8a7529f5d',
    'b7a0026b': 'ddaff53a3cc8 1bf875e19555 - ffa189fefebc 413a075e3e1a c4bc4dc3bfb1 - 2a808cc0c150 -',
    'fa76c7cb': '2d149a7e4508 9eafb750d70f - 586e57eccba2 ed7ef51abc67 98eff7c33e19 - 64b9e68a86ac -',
    '4c405474': 'aeef9701d1ae a7d0b66d8e73 - 21ed66db8f7b 534a7598d8ba ffea183d7e17 - 87a3e05e8fd8 -',
    '9f11c47b': '5f2ec76e3e91 0923bdf6e7da - 39d36a24d174 fd2743c904c0 49dc87f81eb1 - be649f40e5aa -',
    '89826e79': '52e25652f047 b35508d4789f - a46b3029be6c ef3b035f38df 8bc82da61937 - 55f5621ad48f -',
    '5dd79c85': 'c26c5a918d48 4c6ae02c6216 3688b02cc10c dafbe479e435 099dfa0fdda4 391f1893a949 7baf3b9266b1 4cafb3568166 08219cc3405f',
    '7f98c5d1': '9079dd27f64c dac76f44018e - 6ed7274a2e5d 1e4d67941340 11797993601f - 3d4164f6945c -',
    '387eb702': '546332d638ec 850ca7e785c8 - 56bc56f00742 0c9bf24ea073 d609be7efef9 - 82fac9c7c137 -',
    '01000640': '93e4bd7d1788 ba43ac914e74 deb899f69409 ab7522b1364c 7cb59185746a a2462025372c 85bfa468e3de 017327295beb 42053364bcca',
    '9056daf5': '9c7be41ee6e7 b1fc70d24504 bb156a01d114 03a177a86c7e 3f80546ca4c1 7b586ad82159 d88fea98fe02 8b159a14410a 9b301e32d2ca',
    '7c82e478': '6ba7c767afef de917ef4adbe c24c13fe9979 e0bc32127a2d b255f82f463b 68c2f8611096 2c7087374654 f241aa6c41f9 acb74015cde1',
    '6efdab24': '6ffac324d292 2238fe36f1ae f24d36167b06 ef1e0857bea5 07ed77c5e355 96b578534d17 6ef966f3d2f6 b8289bd2808b edda8a86681c',
    '99c23794': 'd3e4f772091a 00be9d8e51b1 5f452f1f02e2 d92c085249d8 5736be0aab26 fc937d6ba83d d651a2342cf6 9fdfdb7c0c7e 65c6d1b16aac',
    'd451a722': '51f547176cf2 05778b44a589 8b8db049525d 7849d823f5ca 1b35dadadbe2 ece35c7a611c 889377c7a3cb 0cf022d6dbd0 0fb7d1c45910',
    'ce2120f7': '546332d638ec da0064d7139a - 93a83fd67abc e0220d42ed44 a343e4c145ae - f0c1670a9495 -',
    '8a3b4691': '1cae1fec0035 62fccfd74194 9ff5b0a62d0f 3242275bdf33 f3f170602fee 5e6f93dba5ab cd1acb5a2c1a 706530ee12da 3ae2b0c90f54',
    '6ab88294': 'ee4f3cf9be3b eb094c230599 1ce3783b5d1b 2a052495909a 75628e80537c ca9b727629bc 132dfd6119ab f185df1d3b2a cb88714e36da',
    'cf50437b': '1c00484ad41e 5a3b5f51f907 5227e0ac411c 994751b71ad1 82c6121507db f9dd76588865 dfc0e1b8fb36 c09172642208 9c25e1b6cdad',
    '6518a77d': '7dd0410bbec1 f1d2691f6215 2621b0057c45 1a816f238f94 c8ddf1c1fcdf bf60e080bbd3 ecff4ab0495f a1d10435370d bc1b990edcd7',
    '68e1a025': 'ffd6a688f767 ea8796d9561b ba95ea50167e 5a5368565e8d 71bc3aa6d7f7 b1c75837270c 665dfe7c67c7 2123f074c63b 8423d4bf031d',
    '2450ff01': '6ba67a8f3ca9 4b6c57961f8f 8e3dcc821f08 25127fce6de1 c79b97b0cfea 5c52f6609435 25ce97d56b15 96bccfef042e 87dfcae62304',
    'da4f7cf9': 'a233dff0feb7 9bb15ab8d4ab 12fdaea057b0 0f762144ef30 0f56c3a872d1 4150d25ad943 221ad9ad6c86 09288828a2de 593621656002',
    'edeb26cf': '268b5c14789a c57a245cebc8 d645cb5e24fd 98313f6d0a85 5f8660ebdc8f 41f893afe906 6afe74626c43 96e947228763 cd9e2091762a',
    'ec3cf2f9': 'c093cda4ccfb 02d34d717b91 4df23f7a64ff 436f8551b99e 790f3f4d66e5 036b028f2d8f 1c203fb4682c e27c14182f1c 144450ba84bd',
    '17aaec23': 'd6ef9c56699d 7d02bd55f190 93c7f7b5c502 aa6a2d9962b0 70fdc5725bd5 14f20828ba1a 826210773a42 09663ba6b2d3 70e990f327bb',
    '8457a8c5': '3f22f9089534 df586caef46f 376c282b5bb1 084d97ec9aec 2041d70151cf 4fdbdb0f5a7c 679bb7032112 d391da6cdf7b e2eb2e0a5647',
    '93574efd': '337e13e8243c d176e703797d - de21a470c634 6549d0fee956 a9a459d86d3b - 8ee174ab7bde -',
    '54896a3f': 'fe4d1540aad9 e007ec18bf07 - bb2bf0111230 376ca1f64536 d87f790f392f - 8007d1d118ad -',
    '9fe96914': '278c73a4bbc1 2515613a5b81 - 2ea4ce4c2b24 b0d9c899ac8b beb16a795642 - f5156ff4269a -',
    'bfadc375': 'f2117e67b6c1 3626a60ad909 - c3c0f5da434c b6066ee53509 32a5c9b16c7b - e74556354417 -',
    'b85f2248': 'da791a257cc1 dd9aa1dbb3ec - aaff1046afd9 4bbca46ab4ab 7fc20664b6ec - 8639ba1f1d58 -',
    'f5e02964': '85590086d542 88729774cd89 - e930207214c2 64deec64c8f5 7e89cbaf5d6b - a1397e7de1e6 -',
    '43d87a71': 'f29208922812 bac8dee48649 - 99f8b851f7a1 3eec1ea097f9 032d4f725ed7 - 26f32a1d18ea -',
    '3b249ff9': '0d68f43b42c1 c9781bd958d5 - 27e82c440605 a5a67efe5f09 1e5d3669aba6 - fc807e6c0d29 -',
    '06a00643': 'cc28bc01be3c d40798969031 f248c016a371 b4f1e0355b1a b47dddbfec25 f0dc06fa424e d9abc250af13 b4945b572516 f8540095b368',
    '6a50312a': '7b896d6f3125 fe7cad05959a - 81d82dbb72ec 383d295f686b 0bdbf1903d1d - f90a66e95792 -',
    '856ff203': '014d22fcc435 31bf81e6d8d7 - b3f2798d2ce2 1101cd72f377 4bc8cb7f6709 - c57794aaf5a4 -',
    'd44c4f5d': '52c12452fadb 54b5cbfa0d69 7fe703886ab2 3ed5d92608da 186317460ed0 71c2753d6aa9 19226890e7a2 2a93aa9286ac 7f28f37e17e4',
    'f62f36f2': 'a841da1f4012 a32ffee1dd70 - 98c9658b03a2 caa1b6ce8d0b d797de8d95de - 741a98df8522 -',
    '7c29b1ff': '7fef4860eb7c 3b616f3d80a6 - 3c22ed86bceb 485bbf1d0554 563910f0e57c - 7f5a4bd7dbd9 -',
    'f14a9a0b': '6555edb9a8ec dcf2e2cd150c 90a316b1d885 94548fd31779 86620fd14f71 758d6f379d8d 6b666bb2f17b 118f56998b0c 4be1431fb751',
    'b7a6da40': 'a6e423d7b0ec 1593db0a186b bb60486d1779 4283f33673f3 faacb0ad0579 697b1394568b 915deb999a9a 925a76fbc1d4 3830e759f212',
  },
};
// END GOLDEN

module.exports = { compute, inputsOf, hashInput, FIELDS };

if (require.main === module) {
  // node tests/i18n-zh-golden.test.js --write : record the current tree's zh output as the golden.
  const MBX = loadAll();
  if (MBX.I18n) MBX.I18n.setLocale('zh-CN');
  const App = require(path.join(__dirname, '..', 'src', 'app.js'));
  const rec = compute(MBX, App.util);
  if (process.argv.includes('--write')) {
    const file = __filename;
    const src = fs.readFileSync(file, 'utf8');
    const lines = Object.keys(rec.inputs).map((k) => `    '${k}': '${rec.inputs[k].join(' ')}',`);
    const table = `const GOLDEN = {\n  shared: ${JSON.stringify(rec.shared).replace(/"/g, "'").replace(/,/g, ', ').replace(/:/g, ': ')},\n  inputs: {\n${lines.join('\n')}\n  },\n};`;
    fs.writeFileSync(file, src.replace(/(\/\/ BEGIN GOLDEN[^\n]*\n)[\s\S]*?(\n\/\/ END GOLDEN)/, (m, a, b) => `${a}${table}${b}`));
    console.log(`recorded ${Object.keys(rec.inputs).length} inputs`);
  } else {
    console.log(JSON.stringify(rec, null, 1));
  }
} else {
  const MBX = loadAll();
  const App = require(path.join(__dirname, '..', 'src', 'app.js'));

  test('i18n-zh-golden: every zh-CN output is byte-for-byte the pre-i18n Chinese', () => {
    assert.ok(GOLDEN && GOLDEN.inputs, 'golden table recorded');
    const I18n = MBX.I18n;
    const before = I18n ? I18n.getLocale() : null;
    if (I18n) I18n.setLocale('zh-CN');
    let rec;
    try {
      rec = compute(MBX, App.util);
    } finally {
      if (I18n) I18n.setLocale(before);
    }
    const diffs = [];
    for (const k of Object.keys(GOLDEN.shared)) if (rec.shared[k] !== GOLDEN.shared[k]) diffs.push(`shared.${k}`);
    const inputs = inputsOf(MBX);
    const byKey = new Map(inputs.map((s) => [hash(s).slice(0, 8), s]));
    for (const k of Object.keys(GOLDEN.inputs)) {
      const want = GOLDEN.inputs[k].split(' ');
      const got = rec.inputs[k];
      if (!got) {
        diffs.push(`input ${k} is no longer in the corpus (Forge output changed?)`);
        continue;
      }
      const fields = FIELDS.filter((f, i) => got[i] !== want[i]);
      if (fields.length) diffs.push(`${JSON.stringify(String(byKey.get(k)).slice(0, 30))}: ${fields.join(', ')}`);
    }
    assert.equal(Object.keys(rec.inputs).length, Object.keys(GOLDEN.inputs).length, 'same corpus size');
    assert.deepEqual(diffs, [], 'zh-CN output changed');
  });
}
