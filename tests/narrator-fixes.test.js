'use strict';
// Regression tests for the narrator accuracy fixes (narrator-facts #68–#89, api-audit #3/#12/#13,
// ui-browser #51). Most fixtures are built from Forge layers + Codecs segments so they do not
// depend on how the engine happens to rank chains today; a few checks run the real engine and
// only assert what must hold whatever it returns.

const fs = require('fs');
const path = require('path');
const { test, assert, loadAll } = require('./harness');

const MBX = loadAll();
const N = MBX.Narrator;
const STYLES = ['humor', 'academic', 'snark'];
const SEEDS = [0, 1, 2, 3];
const sec = (n, id) => (n.sections.find((s) => s.id === id) || { text: '' }).text;
const recipeLine = (n) => sec(n, 'conservation').split('\n').find((l) => l.includes('还原咒语')) || '';
const ready = () => MBX.Codecs && MBX.Forge && typeof MBX.Forge.corrupt === 'function' && typeof MBX.Codecs.decode === 'function';
const engineReady = () => MBX.Engine && typeof MBX.Engine.analyze === 'function';

const LANGS = {
  zh: { lang: 'zh-Hans', name: '简体中文', confidence: 0.9 },
  ja: { lang: 'ja', name: '日文', confidence: 0.9 },
  ru: { lang: 'ru', name: '俄文', confidence: 0.9 },
  en: { lang: 'en', name: '英文', confidence: 0.9 },
  fr: { lang: 'fr', name: '法语', confidence: 0.9 },
};

function result(input, status, best, extra) {
  return Object.assign({
    input, status, best, alternatives: [], signatures: [], signals: [],
    inputScore: { value: -7, total: -50, length: Array.from(input).length, lang: 'mixed', script: 'latin', badness: 3, flags: [] },
    stats: { explored: 10, ms: 1, truncated: false },
  }, extra || {});
}

function best(output, steps, extra) {
  return Object.assign({
    output, confidence: 0.93, steps, repairs: [], label: '测试链路', lang: LANGS.zh,
    score: { value: -2, total: -20, length: Array.from(output).length, lang: 'zh-Hans', script: 'han', badness: 0, flags: [] },
  }, extra || {});
}

// Steps (surface first) exactly as the engine would report them for a Forge chain.
function forgedSteps(text, chain, opts) {
  const f = MBX.Forge.corrupt(text, chain, opts || {});
  assert.ok(f.ok, `forge ${text}: ${f.error || ''}`);
  const C = MBX.Codecs;
  const steps = f.layers.map((L) => {
    const b = C.decode(L.misreadAs, L.bytes);
    const a = C.decode(L.encoding, L.bytes);
    return {
      kind: 'transcode', wrongDecoder: L.misreadAs, trueEncoding: L.encoding, scheme: null,
      before: b.text, after: L.input, bytes: L.bytes, segmentsBefore: b.segments, segmentsAfter: a.segments,
      repairs: [], lossy: b.errors > 0, scoreBefore: -7, scoreAfter: -2, prior: 0.5,
    };
  }).reverse();
  return { input: f.output, steps };
}

function forged(text, chain, bestExtra, resExtra) {
  const { input, steps } = forgedSteps(text, chain);
  return result(input, 'restored', best(text, steps, bestExtra), resExtra);
}

function eachNarration(res, fn, opts) {
  for (const style of STYLES) for (const seed of SEEDS) fn(N.narrate(res, Object.assign({ style, seed }, opts || {})), `${style}/${seed}`);
}

/* ------------------------------------------------------------------------- */

test('narrator-fixes #68: debug-memory relics (烫/屯/葺) never use lost-data wording', () => {
  const bad = /替换字符|字符集|备份|原始数据|有损|默哀|竹简|信息已丢失/;
  const fixtures = [
    result('烫烫烫烫烫烫', 'irrecoverable', null, { signatures: [{ id: 'tangtangtang', title: '烫烫烫', match: '烫烫烫烫烫烫', index: 0 }] }),
    result('屯屯屯屯', 'irrecoverable', null, { signatures: [{ id: 'tuntuntun', title: '屯屯屯', match: '屯屯屯屯', index: 0 }] }),
    result('葺葺葺葺', 'irrecoverable', null, { signatures: [{ id: 'qiqiqi', title: '葺葺葺', match: '葺葺葺葺', index: 0 }] }),
  ];
  if (engineReady()) for (const s of ['烫烫烫烫烫烫', '屯屯屯屯']) fixtures.push(MBX.Engine.analyze(s));
  for (const res of fixtures) {
    eachNarration(res, (n, where) => {
      const hit = n.plainText.split(/\n|。/).find((l) => bad.test(l));
      assert.ok(!hit, `${res.input}/${where}: lost-data wording "${hit}"`);
      assert.ok(/内存/.test(sec(n, 'identify')), `${res.input}/${where}: identify says it is memory`);
      assert.ok(!n.tags.includes('不可逆'), `${res.input}/${where}: tags ${n.tags}`);
    }, { strict: true });
  }
  const t = N.narrate(fixtures[0], { style: 'snark', seed: 0, strict: true });
  assert.ok(t.title.includes('调试内存'), t.title);
});

test('narrator-fixes #69: U+FFFD gaps are blamed on the right decoder and repairs are promised only when made', () => {
  if (!ready()) return;
  // 你好，世界 as UTF-8 read by GBK: the orphan 8C became U+FFFD in this very GBK decode.
  const { input, steps } = forgedSteps('你好，世界', [{ encoding: 'utf-8', misreadAs: 'gbk' }]);
  const st = steps[0];
  const segsBefore = st.segmentsBefore.filter((s) => !s.error).concat([{ ch: '�', start: 14, end: 14 }]);
  const segsAfter = st.segmentsAfter.slice(0, 4).concat([{ ch: '界', start: 12, end: 14, repaired: true, candidates: ['界', '畍'] }]);
  const repair = { index: 4, from: '�', to: '界', candidates: ['界', '畍'], reason: 'gap', step: 0 };
  const lossyStep = Object.assign({}, st, { bytes: st.bytes.slice(0, 14), segmentsBefore: segsBefore, segmentsAfter: segsAfter, repairs: [repair], lossy: true });
  const nihao = result(input, 'restored', best('你好，世界', [lossyStep], { repairs: [repair] }));
  // 中a文: the trailing 87 is lost and nothing was repaired.
  const zhSteps = forgedSteps('中a文', [{ encoding: 'utf-8', misreadAs: 'gbk' }]).steps[0];
  const zhStep = Object.assign({}, zhSteps, {
    bytes: zhSteps.bytes.slice(0, 6),
    segmentsBefore: zhSteps.segmentsBefore.filter((s) => !s.error).concat([{ ch: '�', start: 6, end: 6 }]),
    segmentsAfter: [zhSteps.segmentsAfter[0], zhSteps.segmentsAfter[1], { ch: '�', start: 4, end: 6, error: true, lost: true }],
    lossy: true,
  });
  const zh = result(zhSteps.before, 'restored', best('中a�', [zhStep], { confidence: 0.6 }));
  eachNarration(nihao, (n, where) => {
    assert.ok(!n.plainText.includes('更早的转换') && !n.plainText.includes('先前的转换'), `nihao/${where}: no earlier-conversion claim`);
    assert.ok(n.plainText.includes('GBK 解码时落了单'), `nihao/${where}: GBK dropped the orphan byte`);
    assert.ok(n.plainText.includes('稍后的修复环节会处理'), `nihao/${where}: repair promised`);
    assert.ok(sec(n, 'repair').includes('`E7 95`') && sec(n, 'repair').includes('「鐣」'), `nihao/${where}: surviving bytes shown`);
  }, { strict: true });
  eachNarration(zh, (n, where) => {
    assert.ok(!n.plainText.includes('稍后的修复环节会处理'), `中a文/${where}: no repair promised`);
    assert.ok(!n.sections.some((s) => s.id === 'repair'), `中a文/${where}: no repair section`);
    assert.ok(!n.plainText.includes('更早的转换'), `中a文/${where}: no earlier-conversion claim`);
  }, { strict: true });
  if (engineReady()) {
    const g = MBX.Forge.GALLERY.find((x) => x.id === 'nihao-gbk-lossy');
    if (g) eachNarration(MBX.Engine.analyze(g.relic), (n, where) => assert.ok(!n.plainText.includes('更早的转换'), `gallery/${where}`));
    const r = MBX.Engine.analyze(MBX.Forge.corrupt('中a文', [{ encoding: 'utf-8', misreadAs: 'gbk' }]).output);
    if (r.best && !r.best.repairs.length) eachNarration(r, (n, where) => assert.ok(!n.plainText.includes('稍后的修复环节会处理'), `engine 中a文/${where}`));
  }
});

test('narrator-fixes #70: lead-byte fingerprints use the relic\'s own decoder glyphs', () => {
  if (!ready()) return;
  const L = N._internals.leadMeaning;
  assert.ok(L(0xd0, 0x9f, 'windows-1251').includes('`Р`、`С`'), L(0xd0, 0x9f, 'windows-1251'));
  assert.ok(L(0xd0, 0x9f, 'windows-1252').includes('`Ð`、`Ñ`'), 'Windows-1252 shows Ð Ñ');
  assert.ok(!L(0xc3, 0xa9, 'macintosh').includes('Ã'), L(0xc3, 0xa9, 'macintosh'));
  const privet = forged('Привет, мир!', [{ encoding: 'utf-8', misreadAs: 'windows-1251' }], { lang: LANGS.ru });
  const mac = forged('Café crème brûlée', [{ encoding: 'utf-8', misreadAs: 'macintosh' }], { lang: LANGS.fr });
  eachNarration(privet, (n, where) => assert.ok(!/[ÐÑ]/.test(n.plainText), `privet/${where}: no Windows-1252 glyphs`), { strict: true });
  eachNarration(mac, (n, where) => assert.ok(!/Ã、Â/.test(n.plainText), `mac/${where}: no Windows-1252 glyphs`), { strict: true });
  if (engineReady()) eachNarration(MBX.Engine.analyze('РџСЂРёРІРµС‚, РјРёСЂ!'), (n, where) => assert.ok(!/[ÐÑ]/.test(n.plainText), `engine privet/${where}`));
});

test('narrator-fixes #71: byte traces never claim bytes the encoding cannot produce', () => {
  const C = N._internals.canonicalBytes;
  assert.deepEqual(C('utf-8', 0x7528), [0xe7, 0x94, 0xa8]);
  assert.deepEqual(C('utf-16le', 0x48), [0x48, 0x00]);
  assert.deepEqual(C('utf-16be', 0x1f600), [0xd8, 0x3d, 0xde, 0x00]);
  // the engine folds the BOM into the first character: H = EF BB BF 48
  const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, 0x48, 0x69);
  const step = {
    kind: 'transcode', wrongDecoder: 'windows-1252', trueEncoding: 'utf-8', scheme: null,
    before: 'ï»¿Hi', after: 'Hi', bytes,
    segmentsBefore: Array.from('ï»¿Hi').map((ch, i) => ({ ch, start: i, end: i + 1 })),
    segmentsAfter: [{ ch: 'H', start: 0, end: 4 }, { ch: 'i', start: 4, end: 5 }],
    repairs: [], lossy: false,
  };
  const bom = result('ï»¿Hi', 'restored', best('Hi', [step], { lang: LANGS.en }));
  eachNarration(bom, (n, where) => {
    assert.ok(!n.plainText.includes('EF BB BF 48'), `bom/${where}: BOM not merged into H`);
    assert.ok(/EF BB BF.{0,4}是 UTF-8 的 BOM/.test(n.plainText), `bom/${where}: BOM named as BOM`);
    assert.ok(recipeLine(n).includes("decode('utf-8-sig')"), `bom/${where}: recipe drops the BOM`);
  }, { strict: true });
  if (!engineReady()) return;
  const cases = [['ï»¿Hello world', /EF BB BF 48/], ['ÿþH\u0000e\u0000l\u0000l\u0000o\u0000', /FF FE 48 00/], ['用户名：锟斤拷锟斤拷，密码正确', /UTF-8[^。\n]*D3 C3|UTF-8[^。\n]*A3 BA/]];
  for (const [input, re] of cases) {
    eachNarration(MBX.Engine.analyze(input), (n, where) => assert.ok(!re.test(n.plainText), `${JSON.stringify(input)}/${where}: impossible byte claim`));
  }
});

test('narrator-fixes #72: Python recipes either run on the stdlib or say why they cannot', () => {
  if (!ready()) return;
  const sjis = forged('こんにちは、世界。今日はいい天気ですね。', [{ encoding: 'shift_jis', misreadAs: 'windows-1252' }], { lang: LANGS.ja });
  const cyr = forged('Привет, Иван Иванович!', [{ encoding: 'utf-8', misreadAs: 'windows-1251' }], { lang: LANGS.ru });
  const gb2b5 = forged('我们的人生一定会更好', [{ encoding: 'gbk', misreadAs: 'big5' }]);
  const b52gb = forged('我們的人生一定會更好', [{ encoding: 'big5', misreadAs: 'gbk' }]);
  eachNarration(sjis, (n, where) => {
    assert.ok(!n.plainText.includes('fix_text'), `sjis/${where}: ftfy.fix_text cannot decode cp932`);
    assert.ok(recipeLine(n).includes("s.encode('sloppy-windows-1252').decode('cp932')"), `sjis/${where}: ${recipeLine(n)}`);
  }, { strict: true });
  eachNarration(cyr, (n, where) => {
    const line = recipeLine(n);
    assert.ok(line.includes('U+0098') && line.includes("sloppy-windows-1251"), `cyr/${where}: ${line}`);
  }, { strict: true });
  for (const [name, res] of [['gbk>big5', gb2b5], ['big5>gbk', b52gb]]) {
    if (!/[-]/.test(res.input)) continue; // depends on the codec tables
    eachNarration(res, (n, where) => {
      const line = recipeLine(n);
      assert.ok(line.includes('私用区') && !line.startsWith('本件文物的 Python 还原咒语'), `${name}/${where}: ${line}`);
    }, { strict: true });
  }
  // the static tips that reach the LLM are conditional too
  assert.ok(N.PAIR_FACTS['utf-8>windows-1251'].tips.some((t) => t.includes('U+0098')));
  assert.ok(!N.PAIR_FACTS['shift_jis>windows-1252'].tips.some((t) => t.includes('fix_text')));
});

test('narrator-fixes #73: lossy recipes say the line raises and give the tolerant variant', () => {
  if (!engineReady()) return;
  for (const id of ['nihao-gbk-lossy', 'curly-quotes']) {
    const g = MBX.Forge.GALLERY.find((x) => x.id === id);
    if (!g) continue;
    const r = MBX.Engine.analyze(g.relic);
    if (!r.best || r.status === 'irrecoverable') continue;
    eachNarration(r, (n, where) => {
      const line = recipeLine(n);
      assert.ok(line.includes("errors='replace'") && line.includes('抛出异常'), `${id}/${where}: ${line}`);
      assert.ok(!line.includes('一行代码修不全'), `${id}/${where}: old wording`);
    });
  }
  assert.ok(!N.PAIR_FACTS['utf-8>gbk'].tips.some((t) => t.includes('若末尾有')), 'utf-8>gbk tip: U+FFFD is not always at the end');
});

test('narrator-fixes #74 (api-audit #3): repair notes name the layer that made the repair', () => {
  if (!ready()) return;
  const { input, steps } = forgedSteps('大家好，今天天气不错。', [{ encoding: 'utf-8', misreadAs: 'gbk' }, { encoding: 'utf-8', misreadAs: 'windows-1252' }]);
  const dropped = { index: 5, from: '', to: 'ぉ', candidates: ['ぉ', 'ぇ'], reason: 'dropped', step: 0 };
  const res = result(input, 'restored', best('大家好，今天天气不错。', steps, { repairs: [dropped] }));
  eachNarration(res, (n, where) => {
    const r = sec(n, 'repair');
    assert.ok(r.includes('Windows-1252 会把 `81` `8D` `8F` `90` `9D`'), `dropped/${where}: ${r}`);
    assert.ok(r.includes('第 1 层（地表层）的一个中间字符'), `dropped/${where}: intermediate character`);
    assert.ok(!r.includes('GBK 会把') && !r.includes('若干不可见字节'), `dropped/${where}: wrong decoder or placeholder`);
  }, { strict: true });
  const ru = forgedSteps('Россия и Рим', [{ encoding: 'utf-8', misreadAs: 'windows-1251' }]);
  const nbsp = { index: 0, from: ' ', to: 'Р', candidates: ['Р'], reason: 'nbsp', step: 0 };
  const ruRes = result(ru.input, 'restored', best('Россия и Рим', ru.steps, { repairs: [nbsp], lang: LANGS.ru }));
  eachNarration(ruRes, (n, where) => {
    const r = sec(n, 'repair');
    assert.ok(r.includes('Windows-1251 里是不换行空格') && !r.includes('Windows-1252'), `nbsp/${where}: ${r}`);
  }, { strict: true });
  const f = N.factsFor(res);
  assert.equal(f.repairs[0].layer, 1);
  assert.equal(f.repairs[0].intermediate, true);
});

test('narrator-fixes #51: layers are numbered like the strata panel (第 1 层 = 地表)', () => {
  if (!ready()) return;
  const res = forged('文物', [{ encoding: 'utf-8', misreadAs: 'windows-1252' }, { encoding: 'utf-8', misreadAs: 'windows-1252' }]);
  eachNarration(res, (n, where) => {
    const m = sec(n, 'mechanism');
    const deep = m.indexOf('**第 2 层（最深层）**');
    const top = m.indexOf('**第 1 层（地表层）**');
    assert.ok(deep >= 0 && top > deep, `${where}: deepest told first, numbered 2`);
    assert.ok(!m.includes('第 1 层（最深层）'), `${where}: old numbering`);
  }, { strict: true });
  const f = N.factsFor(res);
  assert.deepEqual(f.layers.map((l) => [l.order, l.formationOrder, l.layer]), [[1, 1, 2], [2, 2, 1]]);
});

test('narrator-fixes #74b: escape-only relics are wrapping, not mojibake, and get dated', () => {
  if (!engineReady()) return;
  const B = String.fromCharCode(92);
  const hx = ['e4', 'bd', 'a0', 'e5', 'a5', 'bd', 'e4', 'b8', '96', 'e7', '95', '8c'].map((h) => B + 'x' + h).join('');
  const u = B + 'u4f60' + B + 'u597d';
  const rh = MBX.Engine.analyze(hx);
  const ru = MBX.Engine.analyze(u);
  if (rh.best && rh.best.steps.every((s) => s.kind === 'unescape')) {
    eachNarration(rh, (n, where) => {
      assert.ok(!/没有找到可信|无从下手/.test(n.plainText), `hex/${where}: dating claims no chain`);
      assert.ok(n.era.reason.includes('\\x'), `hex/${where}: hex-escape evidence`);
    });
  }
  if (ru.best && ru.best.steps.every((s) => s.kind === 'unescape')) {
    eachNarration(ru, (n, where) => {
      assert.ok(!/解释层面|mojibake）遗存|这锅我分|没有找到可信/.test(n.plainText), `\\u/${where}: mojibake wording`);
      assert.ok(!/ {2}/.test(n.plainText.replace(/\n/g, '')), `\\u/${where}: doubled spaces`);
    });
  }
});

test('narrator-fixes #75: EUC-JP read as Shift_JIS is not "perfectly aligned"', () => {
  if (!ready()) return;
  const res = forged('日本語のテキスト', [{ encoding: 'euc-jp', misreadAs: 'shift_jis' }], { lang: LANGS.ja });
  let kanaNote = false;
  eachNarration(res, (n, where) => {
    assert.ok(!n.plainText.includes('整整齐齐') && !n.plainText.includes('字节分组并未错位'), `${where}: same-width claim`);
    assert.ok(!n.plainText.includes('UTF-8 的续字节'), `${where}: blames UTF-8`);
    if (n.plainText.includes('EUC-JP 的每个字节都在 0xA1–0xFE')) kanaNote = true;
  }, { strict: true });
  assert.ok(kanaNote, 'the half-width kana note names EUC-JP');
  const sj = forged('こんにちは', [{ encoding: 'utf-8', misreadAs: 'shift_jis' }], { lang: LANGS.ja });
  assert.ok(N.narrate(sj, { style: 'academic', seed: 0 }).plainText.includes('UTF-8 的续字节'), 'UTF-8 → Shift_JIS keeps its UTF-8 wording');
  // genuinely aligned same-width pairs keep the table-swap wording
  const b5 = forged('大家好', [{ encoding: 'big5', misreadAs: 'gbk' }]);
  assert.ok(N._internals.VOICES.humor.wrong.same.some((t) => sec(N.narrate(b5, { style: 'humor', seed: 0 }), 'mechanism').includes(t.replace('{E}', 'Big5').replace('{W}', 'GBK').replace('{E}', 'Big5').replace('{W}', 'GBK'))));
});

test('narrator-fixes #82: inferred characters are hedged; nothing inferred is never claimed', () => {
  if (!ready()) return;
  const zh = forgedSteps('中a文', [{ encoding: 'utf-8', misreadAs: 'gbk' }]).steps[0];
  const zhStep = Object.assign({}, zh, {
    bytes: zh.bytes.slice(0, 6),
    segmentsBefore: zh.segmentsBefore.filter((s) => !s.error).concat([{ ch: '�', start: 6, end: 6 }]),
    segmentsAfter: [zh.segmentsAfter[0], zh.segmentsAfter[1], { ch: '�', start: 4, end: 6, error: true, lost: true }],
    lossy: true,
  });
  const unrepaired = result(zh.before, 'restored', best('中a�', [zhStep], { confidence: 0.85 }));
  eachNarration(unrepaired, (n, where) => {
    assert.ok(!/推出来|推断|修复推断/.test(sec(n, 'mechanism')), `unrepaired/${where}: no inference claimed`);
    assert.ok(!sec(n, 'identify').includes('推断补全'), `unrepaired/${where}: no hedge needed`);
  }, { strict: true });
  const { input, steps } = forgedSteps('数据库迁移', [{ encoding: 'utf-8', misreadAs: 'gbk' }, { encoding: 'utf-8', misreadAs: 'windows-1252' }]);
  const rep = { index: 4, from: '�', to: '移', candidates: ['移', '种'], reason: 'gap', step: 1 };
  const repaired = result(input, 'restored', best('数据库迁移', steps, { repairs: [rep], confidence: 0.85 }));
  eachNarration(repaired, (n, where) => {
    const id = sec(n, 'identify');
    assert.ok(id.includes('第 5 个字是根据残存字节推断补全的'), `repaired/${where}: ${id}`);
    assert.ok(!id.includes('原本就是这么一句朴素'), `repaired/${where}: overconfident wording`);
  }, { strict: true });
});

test('narrator-fixes #77: unknown relics list each clue once, show invisible matches, and quote matching characters', () => {
  if (!ready()) return;
  const f = MBX.Forge.corrupt('丂丄丅丆，测试', [{ encoding: 'gbk', misreadAs: 'windows-1252' }]);
  const L = f.layers[0];
  const C = MBX.Codecs;
  const dB = C.decode('windows-1252', L.bytes);
  const dA = C.decode('gbk', L.bytes);
  const hint = 'C1 控制字符（U+0080–U+009F）：多为 ISO-8859-1 把 UTF-8 续字节或 Windows-1252 符号原样解出';
  const signals = [0, 2, 4, 6].map((i) => ({ type: 'c1', match: f.output.charAt(i), index: i, hint }));
  const altStep = {
    kind: 'transcode', wrongDecoder: 'windows-1252', trueEncoding: 'gbk', scheme: null, before: dB.text, after: dA.text,
    bytes: L.bytes, segmentsBefore: dB.segments, segmentsAfter: dA.segments, repairs: [], lossy: false,
  };
  const res = result(f.output, 'unknown', null, { signals, alternatives: [{ output: dA.text, confidence: 0.1, label: 'GBK 被误读为 Windows-1252', steps: [altStep] }] });
  eachNarration(res, (n, where) => {
    const m = sec(n, 'mechanism');
    const clueLines = m.split('\n').filter((l) => l.includes('C1 控制字符'));
    assert.equal(clueLines.length, 1, `${where}: one clue line`);
    assert.equal(clueLines[0].split('C1 控制字符（U+0080').length - 1, 1, `${where}: clue not repeated (${clueLines[0]})`);
    assert.ok(clueLines[0].includes('`U+0081`') && !clueLines[0].includes('▫'), `${where}: invisible match as a code point`);
    assert.ok(m.includes('`81 40 81 41 81 42` 解释成「丂丄丅」'), `${where}: bytes and characters agree (${m})`);
  }, { strict: true });
});

test('narrator-fixes #78–#80: ASan fact, UTF-8 bit grouping, signature counts', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'narrator.js'), 'utf8');
  assert.ok(!src.includes('AddressSanitizer 揪出越界与未初始化'), 'ASan does not catch uninitialised reads');
  assert.ok(N.SIGNATURE_FACTS.tangtangtang.tips.some((t) => t.includes('MemorySanitizer')));
  const U = N._internals.utf8Layout;
  assert.equal(U(0xe3).binary, '000 1110 0011');
  assert.equal(U(0x1f389).binary, '0 0001 1111 0011 1000 1001');
  assert.equal(U(0x5927).binary, '0101 1001 0010 0111');
  const kjk = (input, match) => result(input, 'irrecoverable', null, { signatures: [{ id: 'kunjinkao', title: '锟斤拷', match, index: input.indexOf(match) }] });
  for (const [input, match, count] of [['锟斤拷锟斤拷锟斤拷', '锟斤拷锟斤拷锟斤拷', 3], ['用户名：锟斤拷锟斤拷，密码正确', '锟斤拷锟斤拷', 2], ['锟斤拷', '锟斤拷', 1]]) {
    const n = N.narrate(kjk(input, match), { style: 'academic', seed: 0, strict: true });
    assert.ok(sec(n, 'identify').includes('名器「锟斤拷」' + count + ' 处'), `${input}: ${sec(n, 'identify')}`);
    assert.equal(N.factsFor(kjk(input, match)).signatures[0].count, count);
  }
  if (engineReady()) {
    const n = N.narrate(MBX.Engine.analyze('锟斤拷锟斤拷锟斤拷'), { style: 'academic', seed: 0 });
    assert.ok(!n.plainText.includes('「锟斤拷」1 处'), 'engine relic: not one occurrence');
  }
});

test('narrator-fixes #81: the U+FFFD tip suggests an encoding that fits the relic', () => {
  const rep = (input) => result(input, 'irrecoverable', null, { signatures: [{ id: 'replacement', title: '替换字符', match: '�', index: input.indexOf('�') }] });
  eachNarration(rep('R�sum� caf�'), (n, where) => {
    const c = sec(n, 'conservation');
    assert.ok(!c.includes("encoding='gbk'"), `latin/${where}: no GBK for a Western relic`);
    assert.ok(c.includes("encoding='cp1252'"), `latin/${where}: cp1252 suggested`);
  }, { strict: true });
  const cjk = N.narrate(rep('你好��世界，今天�'), { style: 'humor', seed: 0, strict: true });
  assert.ok(sec(cjk, 'conservation').includes("encoding='gbk'"), 'CJK relic: gbk');
});

test('narrator-fixes #76: no "文本文本" for Latin-script texts', () => {
  if (!ready()) return;
  const res = forged('“Don’t panic!”', [{ encoding: 'utf-8', misreadAs: 'windows-1252' }], { lang: { lang: 'latin', name: '拉丁字母文本', confidence: 0.5 } });
  for (let seed = 0; seed < 12; seed++) for (const style of STYLES) {
    assert.ok(!N.narrate(res, { style, seed, strict: true }).plainText.includes('文本文本'), `${style}/${seed}`);
  }
  if (engineReady()) {
    for (const g of MBX.Forge.GALLERY) {
      const r = MBX.Engine.analyze(g.relic);
      eachNarration(r, (n, where) => assert.ok(!n.plainText.includes('文本文本'), `${g.id}/${where}`));
    }
  }
});

test('narrator-fixes #23 (robustness): Windows-1252 read as true ISO-8859-1 has its own facts', () => {
  const p = N._internals.pairFactsFor('windows-1252', 'iso-8859-1', 'It’s a “test”');
  assert.equal(p.generic, false);
  assert.ok(/WHATWG/.test(p.facts.eraWhy) && p.facts.tips.some((t) => t.includes("decode('cp1252')")));
  if (!ready()) return;
  const text = 'It’s a “test” – done…';
  const f = MBX.Forge.corrupt(text, [{ encoding: 'windows-1252', misreadAs: 'iso-8859-1' }]);
  if (!f.ok) return;
  const res = forged(text, [{ encoding: 'windows-1252', misreadAs: 'iso-8859-1' }], { lang: LANGS.en });
  eachNarration(res, (n, where) => {
    assert.ok(/Word|Outlook|WHATWG/.test(n.plainText), `${where}: curated lore`);
    assert.ok(recipeLine(n).includes("s.encode('latin-1').decode('cp1252')"), `${where}: ${recipeLine(n)}`);
  }, { strict: true });
});

test('narrator-fixes #88 (api-audit #13): tags, duplicate tips, BOM recipes, layer counts', () => {
  // no "未知" language tag on an irrecoverable relic whose output is only U+FFFD
  const kjkBest = result('锟斤拷', 'irrecoverable', best('��', [], { lang: { lang: 'unknown', name: '未知', confidence: 0 } }), {
    signatures: [{ id: 'kunjinkao', title: '锟斤拷', match: '锟斤拷', index: 0 }],
  });
  const k = N.narrate(kjkBest, { style: 'humor', seed: 0, strict: true });
  assert.ok(!k.tags.some((t) => /未知/.test(t)), `tags ${k.tags}`);
  assert.ok(!k.plainText.includes('目前能勉强读出的是「��」'), 'no output note for an all-U+FFFD output');
  if (!ready()) return;
  // one naming family for clean and restored English
  const clean = result('Hello world', 'clean', null, { inputScore: { value: -1, total: -10, length: 11, lang: 'en', script: 'latin', badness: 0, flags: [] } });
  const restored = forged('Hello wörld', [{ encoding: 'utf-8', misreadAs: 'windows-1252' }], { lang: LANGS.en });
  const lc = N.narrate(clean, { style: 'humor', seed: 0 }).tags;
  const lr = N.narrate(restored, { style: 'humor', seed: 0 }).tags;
  assert.ok(lc.includes('英语') && lr.includes('英语'), `${lc} / ${lr}`);
  // UTF-16 with a BOM: decode('utf-16'), never the BOM-keeping utf-16-le tip, no repeated era line
  const u16 = forged('﻿Hi', [{ encoding: 'utf-16le', misreadAs: 'windows-1252' }], { lang: LANGS.en }, {
    signatures: [{ id: 'utf16-bom', title: 'UTF-16 BOM', match: 'ÿþ', index: 0 }, { id: 'utf16-nul', title: 'NUL', match: 'H\u0000i\u0000', index: 2 }],
  });
  eachNarration(u16, (n, where) => {
    const c = sec(n, 'conservation');
    assert.ok(!c.includes("encoding='utf-16-le'"), `u16/${where}: utf-16-le would keep the BOM`);
    assert.ok(recipeLine(n).includes("decode('utf-16')"), `u16/${where}: ${recipeLine(n)}`);
    const sentences = n.era.reason.split('。').filter(Boolean).map((s) => s.replace(/^.*?而言，/, ''));
    assert.equal(new Set(sentences).size, sentences.length, `u16/${where}: repeated era evidence`);
  }, { strict: true });
  // the ZIP recipe is not repeated by a pair tip
  const zip = forged('中文.txt', [{ encoding: 'gbk', misreadAs: 'cp437' }]);
  eachNarration(zip, (n, where) => {
    const lines = sec(n, 'conservation').split('\n').filter((l) => l.includes(".encode('cp437').decode('gbk')"));
    assert.ok(lines.length <= 1, `zip/${where}: duplicated command`);
  }, { strict: true });
  // academic multiIntro counts mis-decodings only
  const inner = forgedSteps('大', [{ encoding: 'utf-8', misreadAs: 'windows-1252' }]);
  const pct = '%C3%A5%C2%A4%C2%A7';
  const unesc = {
    kind: 'unescape', wrongDecoder: null, trueEncoding: 'utf-8', scheme: 'percent', before: pct, after: inner.input,
    bytes: Uint8Array.of(0xc3, 0xa5, 0xc2, 0xa4, 0xc2, 0xa7), segmentsBefore: null,
    segmentsAfter: MBX.Codecs.decode('utf-8', Uint8Array.of(0xc3, 0xa5, 0xc2, 0xa4, 0xc2, 0xa7)).segments, repairs: [], lossy: false,
  };
  const pm = result(pct, 'restored', best('大', [unesc].concat(inner.steps)));
  for (const seed of SEEDS) {
    const t = N.narrate(pm, { style: 'academic', seed, strict: true }).plainText;
    assert.ok(!/2 次编解码错配|（2 层误读/.test(t), `academic/${seed}: escape layer counted as a misreading`);
  }
  if (engineReady()) {
    for (const g of MBX.Forge.GALLERY) {
      eachNarration(MBX.Engine.analyze(g.relic), (n, where) => {
        const seen = new Map();
        for (const line of sec(n, 'conservation').split('\n')) {
          for (const cmd of line.match(/\.encode\('[^']+'[^)]*\)\.decode\('[^']+'/g) || []) {
            const key = cmd.replace(/, errors='[a-z]+'/g, '');
            assert.ok(!seen.has(key) || seen.get(key) === line, `${g.id}/${where}: duplicated ${key}`);
            seen.set(key, line);
          }
        }
      });
    }
  }
});

test('narrator-fixes #86: corrected fact wording', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'narrator.js'), 'utf8');
  for (const old of ['只规定了 Latin-1 的 ID3v1', 'PEP 686 计划', '连 Windows-1252 未定义字节丢失的情况也能处理', 'Visual C++ 调试运行库用 0xCC', '四件名器，一句话凑齐', '锟斤拷家族的又一位成员', '这里面藏着大名鼎鼎的']) {
    assert.ok(!src.includes(old), `old phrase still present: ${old}`);
  }
  const bush = result('畂桳栠摩琠敨映捡獴', 'restored', best('Bush hid the facts', [], { lang: LANGS.en }), {
    signatures: [{ id: 'notepad-bush', title: 'Bush hid the facts', match: '畂桳栠摩琠敨映捡獴', index: 0 }],
  });
  for (let seed = 0; seed < 8; seed++) {
    const id = sec(N.narrate(bush, { style: 'humor', seed, strict: true }), 'identify');
    assert.ok(!id.includes('藏着大名鼎鼎的'), `bush/${seed}: claims the relic contains the words`);
  }
});

test('narrator-fixes #85: copy and typography across the gallery', () => {
  if (!ready()) return;
  const mac = forged('Café', [{ encoding: 'utf-8', misreadAs: 'macintosh' }], { lang: LANGS.fr });
  assert.ok(N.narrate(mac, { style: 'humor', seed: 0 }).title.includes('老 Mac 误读型'), N.narrate(mac, { style: 'humor', seed: 0 }).title);
  const bom = forged('﻿Hello', [{ encoding: 'utf-8', misreadAs: 'windows-1252' }], { lang: LANGS.en }, {
    signatures: [{ id: 'utf8-bom-1252', title: 'UTF-8 BOM', match: 'ï»¿', index: 0 }],
  });
  eachNarration(bom, (n, where) => assert.ok(!/[一-鿿]ï»¿|ï»¿[一-鿿]/.test(n.plainText), `bom/${where}: inserted glyphs are spaced`), { strict: true });
  if (!engineReady()) return;
  for (const g of MBX.Forge.GALLERY) {
    eachNarration(MBX.Engine.analyze(g.relic), (n, where) => {
      const t = n.plainText;
      assert.ok(!t.includes('這') && !t.includes('）。）') && !/[A-Za-z0-9]误读型/.test(t), `${g.id}/${where}: typography`);
      assert.ok(!/年代下限|年代嘛……年代不详|当代（无需测年）的|上世纪90/.test(t), `${g.id}/${where}: era phrasing`);
      for (const sentence of t.split(/[。\n]/)) {
        const flat = sentence.replace(/（[^（）]*）/g, '').replace(/「[^「」]*」/g, '「」');
        assert.ok(!/：[^：]*：/.test(flat), `${g.id}/${where}: stacked colons in "${sentence}"`);
      }
    });
  }
});

test('narrator-fixes #87: jokes stay consistent with the data', () => {
  if (!ready()) return;
  const low = forged('Café crème', [{ encoding: 'utf-8', misreadAs: 'windows-1252' }], { lang: LANGS.fr, confidence: 0.44 }, {
    alternatives: [{ output: 'Caf茅 cr猫me', confidence: 0.04, label: '另一条链路', steps: [] }],
  });
  eachNarration(low, (n, where) => {
    assert.ok(!/玄学|单元测试覆盖率|天气预报/.test(n.plainText), `low/${where}: confidence joke at 44%`);
    assert.ok(!n.plainText.includes('Caf茅 cr猫me'), `low/${where}: a 4% alternative is not "academic debate"`);
  }, { strict: true });
  const cjk = forged('こんにちは世界', [{ encoding: 'shift_jis', misreadAs: 'gbk' }], { lang: LANGS.ja });
  eachNarration(cjk, (n, where) => assert.ok(!n.plainText.includes('互联网上一大半乱码'), `sjis>gbk/${where}`), { strict: true });
  const ru = forged('Привет', [{ encoding: 'koi8-r', misreadAs: 'windows-1251' }], { lang: LANGS.ru });
  eachNarration(ru, (n, where) => assert.ok(!n.plainText.includes('中文菜谱'), `koi8/${where}: analogy names the wrong language`), { strict: true });
  const rep = result('Gr��e aus K�ln', 'restored', best('Grüße aus Köln', [], { lang: LANGS.en }), {
    signatures: [{ id: 'replacement', title: '替换字符', match: '��', index: 2 }],
  });
  for (let seed = 0; seed < 8; seed++) assert.ok(!N.narrate(rep, { style: 'humor', seed, strict: true }).plainText.includes('镇馆级别'), `replacement/${seed}`);
});

test('narrator-fixes #89: encoding descriptions fit the relic', () => {
  if (!ready()) return;
  const privet = forged('Привет, мир!', [{ encoding: 'utf-8', misreadAs: 'windows-1251' }], { lang: LANGS.ru });
  for (const style of STYLES) assert.ok(/西里尔字母占 2 个字节/.test(sec(N.narrate(privet, { style, seed: 0, strict: true }), 'mechanism')), style);
  const sj = forged('テスト', [{ encoding: 'shift_jis', misreadAs: 'windows-1252' }], { lang: LANGS.ja });
  assert.ok(sec(N.narrate(sj, { style: 'humor', seed: 0, strict: true }), 'mechanism').includes('半角片假名只占 1 个字节'));
});

test('narrator-fixes (api-audit #12): exhibit numbers do not depend on the calendar year', () => {
  const proto = Date.prototype;
  const orig = proto.getFullYear;
  proto.getFullYear = function () { return 2031; };
  try {
    assert.equal(N.narrate({ input: '锟斤拷', status: 'irrecoverable', best: null, signatures: [], signals: [], alternatives: [] }).exhibitId, 'MBX-2026-6B6B');
    assert.equal(N.factsFor({ input: '锟斤拷', status: 'irrecoverable', best: null }).exhibitId, 'MBX-2026-6B6B');
  } finally {
    proto.getFullYear = orig;
  }
});
