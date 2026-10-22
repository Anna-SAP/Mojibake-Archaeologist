'use strict';
// Tests for MBX.Forge (src/forge.js): corrupt(), escape(), PRESETS and the GALLERY relics.

const { test, assert, loadAll } = require('./harness');
const MBX = loadAll();
const F = MBX.Forge;
const C = MBX.Codecs;

const hasHan = (s) => /[一-鿿]/.test(s);
const parseHex = (s) => s.trim().split(/\s+/).map((h) => parseInt(h, 16));

// ---------------------------------------------------------------------------
// corrupt()
// ---------------------------------------------------------------------------

test('forge: corrupt() replays one layer and records it', () => {
  const r = F.corrupt('大家好', [{ encoding: 'utf-8', misreadAs: 'windows-1252' }]);
  assert.equal(r.ok, true);
  assert.equal(r.output, 'å¤§å®¶å¥½');
  assert.equal(r.layers.length, 1);
  const layer = r.layers[0];
  assert.equal(layer.encoding, 'utf-8');
  assert.equal(layer.misreadAs, 'windows-1252');
  assert.equal(layer.input, '大家好');
  assert.equal(C.hex(layer.bytes), 'E5 A4 A7 E5 AE B6 E5 A5 BD');
  assert.equal(layer.output, r.output);
});

test('forge: corrupt() stacks layers from the earliest one', () => {
  const chain = [{ encoding: 'utf-8', misreadAs: 'windows-1252' }, { encoding: 'utf-8', misreadAs: 'windows-1252' }];
  const r = F.corrupt('é', chain);
  assert.equal(r.ok, true);
  assert.deepEqual(r.layers.map((l) => l.output), ['Ã©', 'ÃƒÂ©']);
  assert.equal(r.layers[1].input, 'Ã©');
  const mixed = F.corrupt('你好', [{ encoding: 'gbk', misreadAs: 'windows-1252' }, { encoding: 'utf-8', misreadAs: 'gbk' }]);
  assert.equal(mixed.ok, true);
  assert.equal(mixed.layers[0].output, 'ÄãºÃ');
  assert.equal(mixed.output, C.decode('gbk', C.encode('utf-8', 'ÄãºÃ').bytes).text);
});

test('forge: corrupt() explains failures in Chinese with the failing layer', () => {
  const r = F.corrupt('你好', [{ encoding: 'windows-1252', misreadAs: 'utf-8' }]);
  assert.equal(r.ok, false);
  assert.equal(r.layerIndex, 0);
  assert.ok(hasHan(r.error) && r.error.includes('你') && r.error.includes('U+4F60'), r.error);
  const second = F.corrupt('é', [{ encoding: 'utf-8', misreadAs: 'gbk' }, { encoding: 'koi8-r', misreadAs: 'windows-1251' }]);
  assert.equal(second.ok, false);
  assert.equal(second.layerIndex, 1);
  assert.equal(F.corrupt('a', [{ encoding: 'ebcdic', misreadAs: 'utf-8' }]).ok, false);
  assert.equal(F.corrupt('a', [{ encoding: 'utf-8', misreadAs: 'nope' }]).layerIndex, 0);
  const same = F.corrupt('a', [{ encoding: 'gbk', misreadAs: 'gbk' }]);
  assert.equal(same.ok, false);
  assert.ok(hasHan(same.error));
  assert.equal(F.corrupt('a', []).ok, false);
  assert.equal(F.corrupt(null, [{ encoding: 'utf-8', misreadAs: 'gbk' }]).ok, false);
});

test('forge: dropInvisible removes characters decoded from invisible bytes', () => {
  const chain = [{ encoding: 'utf-8', misreadAs: 'windows-1252' }];
  assert.equal(F.corrupt('”', chain).output, 'â€\u009d');
  assert.equal(F.corrupt('”', chain, { dropInvisible: true }).output, 'â€');
  // iso-8859-1 treats the whole 0x80–0x9F block as invisible: only the visible "â" survives.
  const latin = F.corrupt('“x”', [{ encoding: 'utf-8', misreadAs: 'iso-8859-1' }], { dropInvisible: true });
  assert.equal(latin.output, 'âxâ');
  assert.equal(latin.layers[0].output, latin.output);
  // Visible characters are never touched.
  assert.equal(F.corrupt('大家好', chain, { dropInvisible: true }).output, 'å¤§å®¶å¥½');
});

test('forge: nbspToSpace and stripReplacement', () => {
  const chain = [{ encoding: 'utf-8', misreadAs: 'windows-1252' }];
  assert.equal(F.corrupt('你好', chain).output, 'ä½\u00A0å¥½');
  assert.equal(F.corrupt('你好', chain, { nbspToSpace: true }).output, 'ä½ å¥½');
  const lossy = [{ encoding: 'utf-8', misreadAs: 'gbk' }];
  assert.equal(F.corrupt('你好，世界', lossy).output, '浣犲ソ锛屼笘鐣\uFFFD');
  assert.equal(F.corrupt('你好，世界', lossy, { stripReplacement: true }).output, '浣犲ソ锛屼笘鐣');
});

// ---------------------------------------------------------------------------
// escape()
// ---------------------------------------------------------------------------

test('forge: escape() produces the escape layers the engine unwraps', () => {
  assert.equal(F.escape('你好', 'percent').output, '%E4%BD%A0%E5%A5%BD');
  assert.equal(F.escape('a b-你', 'percent').output, 'a%20b-%E4%BD%A0');
  assert.equal(F.escape('你好', 'percent', { encoding: 'gbk' }).output, '%C4%E3%BA%C3');
  assert.equal(F.escape('大x', 'hex-escape').output, '\\xe5\\xa4\\xa7x');
  assert.equal(F.escape('大=', 'quoted-printable').output, '=E5=A4=A7=3D');
  assert.equal(F.escape('大', 'hex-dump').output, 'E5 A4 A7');
  assert.equal(F.escape('你好a', 'unicode-escape').output, '\\u4f60\\u597da');
  assert.equal(F.escape('😀', 'unicode-escape').output, '\\ud83d\\ude00');
  assert.equal(F.escape('大😀&', 'html-entity').output, '&#22823;&#128512;&');
  assert.equal(F.escape('x', 'rot13').ok, false);
  assert.equal(F.escape('你', 'percent', { encoding: 'windows-1252' }).ok, false);
});

// ---------------------------------------------------------------------------
// PRESETS
// ---------------------------------------------------------------------------

test('forge: PRESETS cover every classic combination of docs §8', () => {
  const keys = new Set(F.PRESETS.filter((p) => p.chain.length === 1).map((p) => `${p.chain[0].encoding}>${p.chain[0].misreadAs}`));
  const required = [
    'utf-8>windows-1252', 'utf-8>gbk', 'gbk>windows-1252', 'gbk>iso-8859-1', 'utf-8>shift_jis',
    'shift_jis>windows-1252', 'utf-8>windows-1251', 'koi8-r>windows-1251', 'windows-1251>koi8-r',
    'koi8-r>iso-8859-1', 'big5>gbk', 'gbk>big5', 'big5>windows-1252', 'gbk>cp437', 'utf-8>cp437',
    'shift_jis>gbk', 'gbk>shift_jis', 'euc-kr>windows-1252', 'euc-jp>shift_jis', 'utf-8>macintosh',
    'windows-1252>utf-8',
  ];
  for (const k of required) assert.ok(keys.has(k), `missing preset ${k}`);
  // "ascii>utf-16le": plain ASCII text read as UTF-16LE.
  const notepad = F.PRESETS.find((p) => p.chain.length === 1 && p.chain[0].misreadAs === 'utf-16le');
  assert.ok(notepad && /^[\x20-\x7e]+$/.test(notepad.sample), 'Bush-hid-the-facts preset');
  const doubled = F.PRESETS.find((p) => p.chain.length === 2 &&
    p.chain.every((l) => l.encoding === 'utf-8' && l.misreadAs === 'windows-1252'));
  assert.ok(doubled, 'double utf-8>windows-1252 preset');
});

test('forge: every preset is well-formed and actually corrupts its sample', () => {
  const ids = new Set();
  for (const p of F.PRESETS) {
    assert.ok(p.id && !ids.has(p.id), `unique id ${p.id}`);
    ids.add(p.id);
    assert.ok(hasHan(p.name) && hasHan(p.story), `${p.id}: Chinese name and story`);
    assert.ok(typeof p.sample === 'string' && p.sample.length > 0, `${p.id}: sample`);
    assert.ok(p.opts && typeof p.opts === 'object', `${p.id}: opts`);
    for (const l of p.chain) assert.ok(C.get(l.encoding) && C.get(l.misreadAs), `${p.id}: known encodings`);
    const r = F.corrupt(p.sample, p.chain, p.opts);
    assert.ok(r.ok, `${p.id}: ${r.error}`);
    assert.notEqual(r.output, p.sample, `${p.id}: output differs from sample`);
  }
});

test('forge: every preset is restored exactly to its sample by the engine', () => {
  // Presets demonstrate a restoration: their relics must round-trip (1252-as-utf8 is the one
  // accident that destroys its bytes by design).
  const E = globalThis.MBX.Engine;
  const DECLARED_LOSSY = new Set(['1252-as-utf8']);
  for (const p of F.PRESETS) {
    if (DECLARED_LOSSY.has(p.id)) continue;
    const relic = F.corrupt(p.sample, p.chain, p.opts).output;
    const r = E.analyze(relic);
    assert.equal(r.status, 'restored', `${p.id}: ${JSON.stringify(relic)} -> ${r.status}`);
    assert.equal(r.best.output, p.sample, p.id);
  }
});

// ---------------------------------------------------------------------------
// GALLERY
// ---------------------------------------------------------------------------

function reproduce(item) {
  const recipes = ['chain', 'escape', 'bytes'].filter((k) => item[k] !== undefined);
  assert.equal(recipes.length, 1, `${item.id}: exactly one recipe`);
  if (item.chain) {
    const r = F.corrupt(item.source !== undefined ? item.source : item.expect, item.chain, item.opts);
    assert.ok(r.ok, `${item.id}: ${r.error}`);
    return r.output;
  }
  if (item.escape) return F.escape(item.expect, item.escape.scheme, item.escape).output;
  return C.decode(item.misreadAs, parseHex(item.bytes)).text;
}

test('forge: every GALLERY relic is reproduced by the real codecs', () => {
  assert.ok(F.GALLERY.length >= 15 && F.GALLERY.length <= 20, `gallery size ${F.GALLERY.length}`);
  const ids = new Set();
  for (const item of F.GALLERY) {
    assert.ok(item.id && !ids.has(item.id), `unique id ${item.id}`);
    ids.add(item.id);
    assert.ok(hasHan(item.title) && hasHan(item.blurb), `${item.id}: Chinese title and blurb`);
    assert.ok(item.expect === null || typeof item.expect === 'string', `${item.id}: expect`);
    if (item.expect === null) assert.ok(item.source !== undefined || item.bytes, `${item.id}: lost original needs a source`);
    assert.equal(reproduce(item), item.relic, `${item.id}: relic`);
    assert.ok(!/[\u0000-\u001f\u0080-\u009f]/.test(item.relic), `${item.id}: relic has no control characters`);
  }
});

test('forge: GALLERY contains the required museum pieces', () => {
  const find = (relic) => F.GALLERY.find((g) => g.relic === relic);
  const piece = (relic, expect) => {
    const g = find(relic);
    assert.ok(g, `missing relic ${relic}`);
    assert.equal(g.expect, expect, `${relic}: expect`);
    return g;
  };
  const chainOf = (g) => g.chain.map((l) => `${l.encoding}>${l.misreadAs}`).join(' | ');
  assert.equal(chainOf(piece('å¤§å®¶å¥½', '大家好')), 'utf-8>windows-1252');
  assert.equal(chainOf(piece('浣犲ソ锛屼笘鐣\uFFFD', '你好，世界')), 'utf-8>gbk');
  assert.equal(chainOf(piece('ÄãºÃ£¬ÊÀ½ç', '你好，世界')), 'gbk>windows-1252');
  piece('锟斤拷', null);
  piece('烫烫烫', null);
  assert.equal(chainOf(piece('縺薙ｓ縺ｫ縺｡縺ｯ', 'こんにちは')), 'utf-8>shift_jis');
  assert.equal(chainOf(piece('‚±‚ñ‚É‚¿‚Í', 'こんにちは')), 'shift_jis>windows-1252');
  assert.equal(chainOf(piece('РџСЂРёРІРµС‚, РјРёСЂ!', 'Привет, мир!')), 'utf-8>windows-1251');
  assert.equal(chainOf(piece('桴獩愠灰挠湡戠敲歡', 'this app can break')), 'windows-1252>utf-16le');
  assert.equal(chainOf(piece('¤j®a¦n', '大家好')), 'big5>windows-1252');
  assert.equal(chainOf(piece('─π║├.txt', '你好.txt')), 'gbk>cp437');
  assert.equal(chainOf(piece('¾È³çÇÏ¼¼¿ä', '안녕하세요')), 'euc-kr>windows-1252');
  assert.equal(piece('%E4%BD%A0%E5%A5%BD', '你好').escape.scheme, 'percent');
  assert.equal(piece('\\u4f60\\u597d', '你好').escape.scheme, 'unicode-escape');
  const byChain = (key) => F.GALLERY.filter((g) => g.chain && chainOf(g) === key);
  assert.ok(byChain('utf-8>windows-1252 | utf-8>windows-1252').some((g) => hasHan(g.expect)), 'double layer of Chinese');
  assert.ok(byChain('koi8-r>windows-1251').length + byChain('koi8-r>iso-8859-1').length >= 1, 'KOI8-R piece');
  const w1252 = byChain('utf-8>windows-1252').map((g) => g.expect).join(' ');
  assert.ok(/[“”‘’]/.test(w1252), 'curly quotes piece');
  assert.ok(/\p{Extended_Pictographic}/u.test(w1252), 'emoji piece');
  assert.ok(/São Paulo|café/.test(w1252), 'accented Latin piece');
  const curly = byChain('utf-8>windows-1252').find((g) => /[“”]/.test(g.expect));
  assert.equal(curly.opts.dropInvisible, true, 'curly quotes lose an invisible byte');
});

test('forge: GALLERY relics with an original are restorable by reversing the chain', () => {
  // The engine reverses each layer: re-encode with the wrong decoder, decode with the true one.
  const quoteScore = (ch) => ('“”‘’'.includes(ch) ? -2 : /[A-Za-z !]/.test(ch) ? -1 : -10);
  const zhScore = (ch) => ('界你好世'.includes(ch) ? 0 : /[一-鿿]/.test(ch) ? -5 : -10);
  for (const item of F.GALLERY) {
    if (item.expect === null || !item.chain) continue;
    let text = item.relic;
    for (let k = item.chain.length - 1; k >= 0; k--) {
      const { encoding, misreadAs } = item.chain[k];
      const enc = C.encode(misreadAs, text, { gapChars: '\uFFFD' });
      assert.ok(enc.ok, `${item.id}: relic re-encodes with ${misreadAs}`);
      if (encoding === 'utf-8') {
        const opts = item.opts && item.opts.dropInvisible
          ? { droppedBytes: C.get(misreadAs).invisible, charScore: quoteScore }
          : { charScore: zhScore };
        text = C.decodeUtf8Repair(enc.bytes, enc.gaps, opts).text;
      } else {
        text = C.decode(encoding, enc.bytes).text;
      }
    }
    assert.equal(text, item.expect, `${item.id}: restored`);
  }
});
