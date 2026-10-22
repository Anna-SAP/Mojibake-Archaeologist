'use strict';
// Tests for MBX.Codecs (src/codecs.js): registry, byte-exact decoders vs TextDecoder,
// segmentation, reverse tables, strict encoding, gaps and the UTF-8 repair decoder.

const { test, assert, loadAll } = require('./harness');
const MBX = loadAll();
const C = MBX.Codecs;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Deterministic PRNG so a failure is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bytesOf = (...b) => Uint8Array.from(b.flat());
const cps = (s) => Array.from(s);

function checkPartition(res, len, label) {
  const segs = res.segments;
  assert.equal(segs.length, cps(res.text).length, `${label}: one Seg per code point`);
  assert.equal(segs.map((s) => s.ch).join(''), res.text, `${label}: Seg.ch joins to text`);
  if (!segs.length) {
    // Only an empty input or a stripped BOM may produce no characters at all.
    assert.ok(len <= 3, `${label}: no segments for ${len} bytes`);
    return;
  }
  let pos = 0;
  for (const s of segs) {
    if (s.start !== pos || s.end < s.start) {
      throw new Error(`${label}: segments not contiguous at ${pos}: ${JSON.stringify(segs)}`);
    }
    pos = s.end;
  }
  assert.equal(pos, len, `${label}: segments cover all bytes`);
  const errs = segs.filter((s) => s.error).length;
  assert.equal(res.errors, errs, `${label}: errors counts error segments`);
}

// Random byte strings biased toward high bytes, plus real encoded characters so that valid
// multi-byte sequences (and their truncations) are well represented.
function makeGenerator(id, rnd) {
  const info = C.get(id);
  const entries = C.tableEntries(id);
  const multi = entries ? entries.filter(([, b]) => b.length > 1) : [];
  function randomUtf8Char() {
    const r = rnd();
    let cp;
    if (r < 0.3) cp = 0x80 + Math.floor(rnd() * 0x780);
    else if (r < 0.75) cp = 0x800 + Math.floor(rnd() * 0xf800);
    else cp = 0x10000 + Math.floor(rnd() * 0x100000);
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0x4e2d;
    return Array.from(Buffer.from(String.fromCodePoint(cp), 'utf8'));
  }
  function randomUtf16Unit(le) {
    const r = rnd();
    let u;
    if (r < 0.2) u = 0xd800 + Math.floor(rnd() * 0x400);
    else if (r < 0.4) u = 0xdc00 + Math.floor(rnd() * 0x400);
    else u = Math.floor(rnd() * 0x10000);
    return le ? [u & 0xff, u >> 8] : [u >> 8, u & 0xff];
  }
  return function next() {
    const target = Math.floor(rnd() * 13); // length 0–12
    const out = [];
    while (out.length < target) {
      const r = rnd();
      if (r < 0.15) out.push(Math.floor(rnd() * 0x80));
      else if (r < 0.2) out.push(0x30 + Math.floor(rnd() * 10)); // GB18030 4-byte digits
      else if (r < 0.55) out.push(0x80 + Math.floor(rnd() * 0x80));
      else if (info.type === 'utf8') out.push(...randomUtf8Char());
      else if (info.type === 'utf16') out.push(...randomUtf16Unit(id === 'utf-16le'));
      else if (multi.length) out.push(...multi[Math.floor(rnd() * multi.length)][1]);
      else out.push(0x80 + Math.floor(rnd() * 0x80));
    }
    out.length = Math.min(out.length, 12); // truncation creates incomplete sequences on purpose
    return Uint8Array.from(out);
  };
}

function propertyAgainstTextDecoder(id, decodeFn, label, runs) {
  const td = new TextDecoder(label);
  const rnd = mulberry32(0xc0ffee ^ label.length * 7919);
  const gen = makeGenerator(id, rnd);
  for (let k = 0; k < runs; k++) {
    const b = gen();
    const res = decodeFn(b);
    const want = td.decode(b);
    if (res.text !== want) {
      throw new Error(`${label}: bytes [${C.hex(b)}] want ${JSON.stringify(want)} got ${JSON.stringify(res.text)}`);
    }
    checkPartition(res, b.length, `${label} [${C.hex(b)}]`);
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('codecs: registry lists the 21 encodings in priority order', () => {
  const ids = C.ENCODINGS.map((e) => e.id);
  assert.deepEqual(ids, [
    'utf-8', 'gbk', 'big5', 'shift_jis', 'euc-jp', 'euc-kr', 'windows-1252', 'iso-8859-1',
    'windows-1251', 'koi8-r', 'macintosh', 'cp437', 'ibm866', 'windows-1250', 'windows-1253',
    'windows-1254', 'windows-1255', 'windows-1256', 'windows-874', 'utf-16le', 'utf-16be',
  ]);
  const types = new Set(['utf8', 'utf16', 'single', 'double']);
  const regions = new Set(['universal', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'west', 'cyrillic',
    'central-eu', 'greek', 'turkish', 'hebrew', 'arabic', 'thai', 'dos']);
  for (const e of C.ENCODINGS) {
    assert.ok(e.name && /[一-鿿]/.test(e.zh), `${e.id}: name and Chinese description`);
    assert.ok(types.has(e.type), `${e.id}: type`);
    assert.ok(regions.has(e.region), `${e.id}: region`);
    assert.ok(Number.isInteger(e.since) && e.since >= 1960 && e.since <= 2000, `${e.id}: since`);
    assert.ok(Array.isArray(e.invisible), `${e.id}: invisible`);
    assert.equal(e.available, true, `${e.id}: available in Node with full ICU`);
    if (e.whatwg) assert.equal(new TextDecoder(e.whatwg).encoding, e.whatwg, `${e.id}: whatwg label`);
  }
  assert.equal(C.get('iso-8859-1').whatwg, null);
  assert.equal(C.get('cp437').whatwg, null);
  assert.equal(C.get('GBK'), C.get('gbk'), 'lookup is case-insensitive');
  assert.equal(C.get('nope'), undefined);
  assert.equal(C.ids().length, 21);
});

test('codecs: invisible bytes are derived from the decoders', () => {
  assert.deepEqual(C.get('windows-1252').invisible, [0x81, 0x8d, 0x8f, 0x90, 0x9d]);
  assert.deepEqual(C.get('iso-8859-1').invisible, Array.from({ length: 32 }, (_, k) => 0x80 + k));
  assert.deepEqual(C.get('windows-1251').invisible, [0x98]);
  assert.deepEqual(C.get('cp437').invisible, []);
  assert.deepEqual(C.get('koi8-r').invisible, []);
  assert.deepEqual(C.get('utf-8').invisible, []);
  // Whatever the platform tables say, every listed byte must decode to C1 or U+FFFD.
  for (const e of C.ENCODINGS) {
    for (const b of e.invisible) {
      const ch = C.decode(e.id, [b]).text;
      const cp = ch.codePointAt(0);
      assert.ok(ch === '\uFFFD' || (cp >= 0x80 && cp <= 0x9f), `${e.id} byte ${b.toString(16)} -> ${ch}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Decoders vs TextDecoder (property tests)
// ---------------------------------------------------------------------------

for (const e of C.ENCODINGS.filter((x) => x.whatwg)) {
  test(`codecs: ${e.id} decode() equals TextDecoder on 3000 random byte strings`, () => {
    propertyAgainstTextDecoder(e.id, (b) => C.decode(e.id, b), e.whatwg, 3000);
  });
}

test('codecs: GB18030 four-byte path (browser "gbk") matches TextDecoder("gb18030")', () => {
  // Node's ICU "gbk" has no four-byte sequences, so the learned four-byte logic is exercised
  // through a gb18030 codec built by the same machinery.
  const gb = C._createMultiByteCodec('gb18030');
  assert.equal(gb.extLen, 4);
  propertyAgainstTextDecoder('gbk', (b) => gb.decode(b), 'gb18030', 4000);
  assert.equal(gb.decode([0x81, 0x30, 0x81, 0x30]).text, '\u0080');
  const segs = gb.decode([0x41, 0x81, 0x30, 0x81, 0x30, 0x42]).segments;
  assert.deepEqual(segs.map((s) => [s.start, s.end]), [[0, 1], [1, 5], [5, 6]]);
});

test('codecs: segments of valid characters decode to that character on their own', () => {
  const rnd = mulberry32(42);
  for (const e of C.ENCODINGS) {
    const gen = makeGenerator(e.id, rnd);
    for (let k = 0; k < 300; k++) {
      const b = gen();
      const res = C.decode(e.id, b);
      // A stripped BOM stays attached to the first segment, so that one is skipped.
      const bom = (e.type === 'utf8' || e.type === 'utf16') && b.length >= 2 && C.decode(e.id, b.slice(0, 3)).text === '';
      for (const s of res.segments) {
        if (s.error || s.end - s.start === 0 || (bom && s.start === 0)) continue;
        const piece = b.slice(s.start, s.end);
        assert.equal(C.decode(e.id, piece).text, s.ch, `${e.id}: [${C.hex(b)}] seg ${s.start}-${s.end}`);
      }
    }
  }
});

test('codecs: UTF-8 errors use maximal subparts and keep the offending byte', () => {
  const r = C.decode('utf-8', [0xe0, 0x80, 0x41]);
  assert.equal(r.text, '\uFFFD\uFFFDA');
  assert.deepEqual(r.segments.map((s) => [s.start, s.end, !!s.error]), [[0, 1, true], [1, 2, true], [2, 3, false]]);
  const t = C.decode('utf-8', [0xe4, 0xbd, 0x41]);
  assert.equal(t.text, '\uFFFDA');
  assert.deepEqual(t.segments[0], { ch: '\uFFFD', start: 0, end: 2, error: true });
  assert.equal(C.decode('utf-8', [0xf0, 0x9f, 0x98]).errors, 1, 'truncated at EOF -> one U+FFFD');
  // A genuine U+FFFD in the bytes is a character, not a decoding error.
  const real = C.decode('utf-8', [0xef, 0xbf, 0xbd]);
  assert.equal(real.text, '\uFFFD');
  assert.equal(real.errors, 0);
});

test('codecs: BOMs are stripped exactly like TextDecoder and stay attached to the first Seg', () => {
  const u8 = C.decode('utf-8', [0xef, 0xbb, 0xbf, 0x41, 0x42]);
  assert.equal(u8.text, 'AB');
  assert.deepEqual(u8.segments[0], { ch: 'A', start: 0, end: 4 });
  const le = C.decode('utf-16le', [0xff, 0xfe, 0x41, 0x00]);
  assert.equal(le.text, 'A');
  assert.deepEqual(le.segments[0], { ch: 'A', start: 0, end: 4 });
  assert.equal(C.decode('utf-16be', [0xfe, 0xff, 0x00, 0x41]).text, 'A');
  const only = C.decode('utf-8', [0xef, 0xbb, 0xbf]);
  assert.equal(only.text, '');
  assert.equal(only.segments.length, 0);
  // Legacy decoders do not strip anything: the BOM is visible mojibake there.
  assert.equal(C.decode('windows-1252', [0xef, 0xbb, 0xbf]).text, 'ï»¿');
});

test('codecs: UTF-16 odd tail and lone surrogates', () => {
  assert.equal(C.decode('utf-16le', [0x41, 0x00, 0x42]).text, 'A\uFFFD');
  const lone = C.decode('utf-16le', [0x00, 0xd8, 0x41, 0x00]);
  assert.equal(lone.text, '\uFFFDA');
  assert.deepEqual(lone.segments.map((s) => [s.start, s.end]), [[0, 2], [2, 4]]);
  assert.equal(C.decode('utf-16le', [0x00, 0xd8, 0x41]).text, '\uFFFD', 'pending lead + odd byte -> one error');
  assert.equal(C.decode('utf-16be', [0xd8, 0x3d, 0xde, 0x00]).text, '😀');
  assert.equal(C.decode('utf-16le', [0x00, 0xdc]).errors, 1);
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

test('codecs: every reverse-table character round-trips through encode/decode', () => {
  for (const e of C.ENCODINGS) {
    const entries = C.tableEntries(e.id);
    if (e.type === 'utf8' || e.type === 'utf16') {
      assert.equal(entries, null);
      continue;
    }
    assert.ok(entries.length > (e.type === 'double' ? 7000 : 120), `${e.id}: table size ${entries.length}`);
    for (const [ch, b] of entries) {
      const enc = C.encode(e.id, ch);
      if (!enc.ok) throw new Error(`${e.id}: cannot encode table char ${ch}`);
      assert.deepEqual(Array.from(enc.bytes), b, `${e.id}: ${ch} bytes`);
      const back = C.decode(e.id, enc.bytes).text;
      if (back !== ch) throw new Error(`${e.id}: ${ch} -> ${C.hex(b)} -> ${back}`);
      assert.ok(C.canEncodeChar(e.id, ch));
    }
  }
});

test('codecs: reverse-table preferences follow the WHATWG encoders', () => {
  assert.deepEqual(C.encodeChar('gbk', '€'), [0x80], 'GBK euro is the single byte 0x80');
  assert.deepEqual(C.encodeChar('gbk', '大'), [0xb4, 0xf3]);
  // NEC-selected IBM extensions (rows 0xED/0xEE) are never chosen when the IBM row has the char.
  const kanji = C.decode('shift_jis', [0xed, 0x40]).text;
  const enc = C.encodeChar('shift_jis', kanji);
  assert.ok(enc[0] !== 0xed && enc[0] !== 0xee, `Shift_JIS ${kanji} encoded as ${C.hex(enc)}`);
  assert.deepEqual(C.encodeChar('shift_jis', '∵'), [0x81, 0xe6], 'lowest pointer among duplicates');
  assert.deepEqual(C.encodeChar('shift_jis', 'ｱ'), [0xb1], 'half-width katakana single byte');
  assert.deepEqual(C.encodeChar('euc-jp', 'ｱ'), [0x8e, 0xb1], 'EUC-JP half-width katakana via 0x8E');
  assert.deepEqual(C.encodeChar('big5', '大'), [0xa4, 0x6a]);
  const k3 = C.encodeChar('euc-jp', C.decode('euc-jp', [0x8f, 0xb0, 0xa1]).text);
  assert.deepEqual(k3, [0x8f, 0xb0, 0xa1], 'JIS X 0212 three-byte form is encodable');
});

test('codecs: cp437 table spot checks (docs §2.1)', () => {
  const pick = (b) => C.decode('cp437', [b]).text;
  assert.equal(pick(0x41), 'A');
  assert.equal(pick(0x80), 'Ç');
  assert.equal(pick(0x9b), '¢');
  assert.equal(pick(0x9e), '₧');
  assert.equal(pick(0xa9), '⌐');
  assert.equal(pick(0xb0), '░');
  assert.equal(pick(0xc9), '╔');
  assert.equal(pick(0xdb), '█');
  assert.equal(pick(0xe1), 'ß');
  assert.equal(pick(0xe6), 'µ', '0xE6 is MICRO SIGN');
  assert.equal(pick(0xfa), '·');
  assert.equal(pick(0xfe), '■');
  assert.equal(pick(0xff), '\u00A0');
  const zip = C.encode('cp437', '─π║├.txt');
  assert.deepEqual(Array.from(zip.bytes), [0xc4, 0xe3, 0xba, 0xc3, 0x2e, 0x74, 0x78, 0x74]);
  assert.equal(C.decode('cp437', Uint8Array.from({ length: 256 }, (_, b) => b)).segments.length, 256);
});

test('codecs: iso-8859-1 is a true identity mapping (unlike the WHATWG label)', () => {
  const all = Uint8Array.from({ length: 256 }, (_, b) => b);
  const d = C.decode('iso-8859-1', all);
  assert.deepEqual(cps(d.text).map((c) => c.codePointAt(0)), Array.from(all));
  assert.equal(d.errors, 0);
  assert.deepEqual(Array.from(C.encode('iso-8859-1', d.text).bytes), Array.from(all));
  assert.equal(C.decode('iso-8859-1', [0x80]).text, '\u0080');
  assert.equal(C.decode('windows-1252', [0x80]).text, '€');
  assert.equal(C.encode('iso-8859-1', '€').ok, false);
});

// ---------------------------------------------------------------------------
// encode()
// ---------------------------------------------------------------------------

test('codecs: strict encode fails fast with a code-point index', () => {
  assert.deepEqual(C.encode('windows-1252', 'abc中def'), { ok: false, failIndex: 3, failChar: '中' });
  assert.deepEqual(C.encode('gbk', '😀a中😀'), { ok: false, failIndex: 0, failChar: '😀' });
  // Code points, not UTF-16 units: the emoji before the failure counts as one.
  assert.deepEqual(C.encode('utf-8', '😀a\ud800b'), { ok: false, failIndex: 2, failChar: '\ud800' });
  assert.deepEqual(C.encode('windows-1252', 'é€x😀'), { ok: false, failIndex: 3, failChar: '😀' });
  assert.equal(C.encode('utf-16le', 'x\udc00').ok, false);
  const r = C.encode('utf-8', '大😀');
  assert.equal(r.ok, true);
  assert.equal(C.hex(r.bytes), 'E5 A4 A7 F0 9F 98 80');
  assert.deepEqual(r.segments, [{ ch: '大', start: 0, end: 3 }, { ch: '😀', start: 3, end: 7 }]);
  assert.deepEqual(r.gaps, []);
  assert.equal(C.hex(C.encode('utf-16be', '😀').bytes), 'D8 3D DE 00');
  assert.equal(C.hex(C.encode('utf-16le', 'A').bytes), '41 00');
  assert.equal(C.encode('gbk', '').bytes.length, 0);
  // Failing at the start of a huge string is cheap.
  const huge = '中' + 'a'.repeat(2e6);
  const t0 = Date.now();
  for (let k = 0; k < 200; k++) C.encode('windows-1252', huge);
  assert.ok(Date.now() - t0 < 200, 'fail-fast encode should not scan the whole text');
});

test('codecs: gapChars become zero-width insertion points', () => {
  const r = C.encode('gbk', '你\uFFFD好', { gapChars: '\uFFFD' });
  assert.equal(r.ok, true);
  assert.equal(C.hex(r.bytes), 'C4 E3 BA C3');
  assert.deepEqual(r.gaps, [{ charIndex: 1, byteOffset: 2, ch: '\uFFFD' }]);
  assert.deepEqual(r.segments[1], { ch: '\uFFFD', start: 2, end: 2 });
  // Even an encodable character is treated as a gap when listed.
  const q = C.encode('windows-1252', 'a?b\uFFFD', { gapChars: '\uFFFD?' });
  assert.equal(C.hex(q.bytes), '61 62');
  assert.deepEqual(q.gaps.map((g) => [g.charIndex, g.byteOffset, g.ch]), [[1, 1, '?'], [3, 2, '\uFFFD']]);
  const u = C.encode('utf-8', '\uFFFD', { gapChars: '\uFFFD' });
  assert.equal(u.bytes.length, 0);
  assert.equal(u.gaps.length, 1);
  // Without gapChars an unencodable U+FFFD is an ordinary failure.
  assert.equal(C.encode('gbk', '你\uFFFD').failIndex, 1);
});

test('codecs: encodeChar / canEncodeChar / hex', () => {
  assert.deepEqual(C.encodeChar('utf-8', '大'), [0xe5, 0xa4, 0xa7]);
  assert.deepEqual(C.encodeChar('utf-8', '😀'), [0xf0, 0x9f, 0x98, 0x80]);
  assert.equal(C.encodeChar('windows-1252', '中'), null);
  assert.equal(C.encodeChar('utf-8', 'ab'), null, 'exactly one code point');
  assert.equal(C.canEncodeChar('koi8-r', 'П'), true);
  assert.equal(C.canEncodeChar('koi8-r', 'é'), false);
  assert.equal(C.hex([0xe5, 0xa4, 0xa7]), 'E5 A4 A7');
  assert.equal(C.hex(Uint8Array.of(1, 2, 0xab, 4), 1, 3), '02 AB');
  assert.equal(C.hex([]), '');
});

// ---------------------------------------------------------------------------
// Byte facts other modules (engine signatures, narrator) rely on
// ---------------------------------------------------------------------------

test('codecs: famous byte facts', () => {
  const td = (b, l) => C.decode(l, b).text;
  assert.equal(td([0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd], 'gbk'), '锟斤拷');
  assert.equal(td([0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd], 'big5'), '嚙踝蕭');
  assert.equal(td([0xcc, 0xcc, 0xcc, 0xcc], 'gbk'), '烫烫');
  assert.equal(td([0xcd, 0xcd, 0xcd, 0xcd], 'gbk'), '屯屯');
  assert.equal(td([0xdd, 0xdd, 0xdd, 0xdd], 'gbk'), '葺葺');
  assert.equal(td([0xef, 0xbb, 0xbf], 'windows-1252'), 'ï»¿');
  assert.equal(td([0xff, 0xfe], 'windows-1252'), 'ÿþ');
  assert.equal(td([0xfe, 0xff], 'windows-1252'), 'þÿ');
  assert.equal(td(Buffer.from('this app can break'), 'utf-16le'), '桴獩愠灰挠湡戠敲歡');
  assert.equal(td(Buffer.from('Bush hid the facts'), 'utf-16le'), '畂桳栠摩琠敨映捡獴');
  const fd = td([0xfd, 0xfd], 'gbk').codePointAt(0);
  assert.ok(fd >= 0xe000 && fd <= 0xf8ff, 'GBK 0xFDFD is in the user-defined (private use) area');
});

// ---------------------------------------------------------------------------
// decodeUtf8Repair()
// ---------------------------------------------------------------------------

const COMMON = '你好世界中文的一是不了人我在有他这为之大来以个国到说们';
const stubScore = (ch) => {
  if (COMMON.includes(ch)) return 0;
  if (ch === '，') return -1;
  if (/[一-鿿]/.test(ch)) return -5;
  if (ch === '\uFFFD') return -20;
  return -10;
};

test('repair: lossy GBK relic with a U+FFFD tail is restored (gap)', () => {
  const relic = '浣犲ソ锛屼笘鐣\uFFFD';
  assert.equal(C.decode('gbk', C.encode('utf-8', '你好，世界').bytes).text, relic, 'relic is real');
  const enc = C.encode('gbk', relic, { gapChars: '\uFFFD' });
  assert.equal(enc.ok, true);
  assert.equal(enc.gaps[0].byteOffset, 14);
  const r = C.decodeUtf8Repair(enc.bytes, enc.gaps, { charScore: stubScore });
  assert.equal(r.text, '你好，世界');
  assert.equal(r.errors, 0);
  assert.equal(r.repairs.length, 1);
  const rep = r.repairs[0];
  assert.equal(rep.index, 4);
  assert.equal(rep.from, '\uFFFD');
  assert.equal(rep.to, '界');
  assert.equal(rep.reason, 'gap');
  assert.equal(rep.candidates[0], '界');
  assert.ok(rep.candidates.length <= 6 && rep.candidates.length > 1);
  assert.deepEqual([r.segments[4].start, r.segments[4].end, r.segments[4].repaired], [12, 14, true]);
  assert.deepEqual(r.segments[4].candidates, rep.candidates);
  checkPartition(r, enc.bytes.length, 'repair gap');
});

test('repair: NBSP that became a space is restored (nbspFromSpace)', () => {
  const mojibake = C.decode('windows-1252', C.encode('utf-8', '你好').bytes).text;
  assert.equal(mojibake, 'ä½\u00A0å¥½');
  const flattened = mojibake.replace(/\u00A0/g, ' ');
  const bytes = C.encode('windows-1252', flattened).bytes;
  assert.equal(C.hex(bytes), 'E4 BD 20 E5 A5 BD');
  const plain = C.decodeUtf8Repair(bytes, [], { charScore: stubScore });
  assert.equal(plain.text, '\uFFFD 好', 'without the option the space stays a space');
  const r = C.decodeUtf8Repair(bytes, [], { nbspFromSpace: true, charScore: stubScore });
  assert.equal(r.text, '你好');
  assert.equal(r.errors, 0);
  assert.deepEqual(r.repairs, [{ index: 0, from: ' ', to: '你', candidates: ['你'], reason: 'nbsp' }]);
  // A space that cannot be a continuation byte is left alone.
  assert.equal(C.decodeUtf8Repair(Buffer.from('a b'), [], { nbspFromSpace: true }).text, 'a b');
  // A tentative NBSP that still leaves the sequence broken is given back as a space.
  assert.equal(C.decodeUtf8Repair(bytesOf(0xe4, 0x20, 0x41), [], { nbspFromSpace: true }).text, '\uFFFD A');
});

test('repair: swallowed invisible byte is re-inserted (droppedBytes)', () => {
  const seen = C.decode('windows-1252', [0xe2, 0x80, 0x9d]).text;
  assert.equal(seen, 'â€\u009d');
  const copied = seen.replace(/[\u0080-\u009f]/g, ''); // lost on copy/paste
  const bytes = C.encode('windows-1252', copied + ' ok').bytes;
  const quoteScore = (ch) => ('“”‘’'.includes(ch) ? -2 : /[a-z ]/.test(ch) ? -1 : -10);
  const r = C.decodeUtf8Repair(bytes, [], { droppedBytes: C.get('windows-1252').invisible, charScore: quoteScore });
  assert.equal(r.text, '” ok');
  assert.equal(r.errors, 0);
  assert.equal(r.repairs[0].reason, 'dropped');
  assert.equal(r.repairs[0].from, '');
  assert.equal(r.repairs[0].to, '”');
  assert.ok(r.repairs[0].candidates.includes('‐'), 'other dropped bytes are listed as alternatives');
  // Without droppedBytes it is an ordinary error.
  assert.equal(C.decodeUtf8Repair(bytes, [], {}).text, '\uFFFD ok');
});

test('repair: a two-byte gap spanning two characters (Big5-style loss)', () => {
  // 你好 = E4 BD A0 | E5 A5 BD; the bytes A0 E5 were lost as one U+FFFD.
  const bytes = bytesOf(0xe4, 0xbd, 0xa5, 0xbd);
  const r = C.decodeUtf8Repair(bytes, [{ charIndex: 1, byteOffset: 2, ch: '\uFFFD' }], { charScore: stubScore });
  assert.equal(r.text, '你好');
  assert.equal(r.errors, 0);
  assert.deepEqual(r.repairs.map((x) => [x.index, x.to, x.reason]), [[0, '你', 'gap'], [1, '好', 'gap']]);
  assert.deepEqual(r.segments.map((s) => [s.start, s.end]), [[0, 2], [2, 4]]);
});

test('repair: a gap that lost the lead byte is inferred from the surviving tail', () => {
  // 界 = E7 95 8C with the lead byte lost.
  const r = C.decodeUtf8Repair(bytesOf(0x95, 0x8c, 0x41), [{ byteOffset: 0, ch: '?' }], { charScore: stubScore });
  assert.equal(r.text, '界A');
  assert.equal(r.repairs[0].from, '?');
  assert.deepEqual([r.segments[0].start, r.segments[0].end], [0, 2]);
});

test('repair: unconstrainable gaps stay U+FFFD and are counted', () => {
  const r = C.decodeUtf8Repair(Buffer.from('ab'), [{ byteOffset: 1, ch: '\uFFFD' }], { charScore: stubScore });
  assert.equal(r.text, 'a\uFFFDb');
  assert.equal(r.errors, 1);
  assert.equal(r.repairs.length, 0);
  assert.deepEqual(r.segments[1], { ch: '\uFFFD', start: 1, end: 1, error: true });
  // Three missing continuation bytes cannot fit in a 1–2 byte gap.
  const f = C.decodeUtf8Repair(bytesOf(0xf0, 0x41), [{ byteOffset: 1, ch: '\uFFFD' }], {});
  assert.equal(f.text, '\uFFFD\uFFFDA');
  assert.equal(f.errors, 2);
});

test('repair: without gaps or options it equals decode("utf-8")', () => {
  const rnd = mulberry32(7);
  const gen = makeGenerator('utf-8', rnd);
  for (let k = 0; k < 2000; k++) {
    const b = gen();
    const a = C.decode('utf-8', b);
    const r = C.decodeUtf8Repair(b, [], {});
    assert.equal(r.text, a.text, C.hex(b));
    assert.deepEqual(r.segments, a.segments, C.hex(b));
    assert.equal(r.errors, a.errors);
  }
});

test('repair: segments always partition the bytes, with random gaps and options', () => {
  const rnd = mulberry32(99);
  const gen = makeGenerator('utf-8', rnd);
  const dropped = C.get('windows-1252').invisible;
  for (let k = 0; k < 1500; k++) {
    const b = gen();
    const gaps = [];
    const count = Math.floor(rnd() * 3);
    for (let q = 0; q < count; q++) gaps.push({ byteOffset: Math.floor(rnd() * (b.length + 1)), ch: '\uFFFD' });
    gaps.sort((x, y) => x.byteOffset - y.byteOffset);
    const r = C.decodeUtf8Repair(b, gaps, { nbspFromSpace: rnd() < 0.5, droppedBytes: rnd() < 0.5 ? dropped : [] });
    checkPartition(r, b.length, `repair [${C.hex(b)}] gaps ${JSON.stringify(gaps)}`);
    const chars = cps(r.text);
    for (const rep of r.repairs) {
      assert.equal(chars[rep.index], rep.to, 'repair index points at the repaired character');
      assert.ok(r.segments[rep.index].repaired);
      assert.ok(rep.candidates.length >= 1 && rep.candidates.length <= 6);
    }
  }
});

test('repair: falls back to a built-in character prior when no scorer is given', () => {
  const enc = C.encode('gbk', '浣犲ソ锛屼笘鐣\uFFFD', { gapChars: '\uFFFD' });
  const r = C.decodeUtf8Repair(enc.bytes, enc.gaps);
  assert.equal(cps(r.text).length, 5);
  assert.ok(/^你好，世[一-鿿]$/.test(r.text), r.text);
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

test('codecs: table build < 100ms and 1000-char encode+decode < 2ms', () => {
  for (const label of ['gbk', 'big5', 'shift_jis', 'euc-jp', 'euc-kr']) {
    const t0 = performance.now();
    C._createMultiByteCodec(label);
    const ms = performance.now() - t0;
    assert.ok(ms < 100, `${label} table build took ${ms.toFixed(1)}ms`);
  }
  const zh = '大家好，这是一段用来测试编码性能的中文文本。'.repeat(46).slice(0, 1000);
  const cases = [['utf-8', zh], ['gbk', zh], ['utf-16le', zh], ['windows-1252', 'Ça va très bien. '.repeat(59).slice(0, 1000)],
    ['shift_jis', 'これは日本語のテキストです。'.repeat(72).slice(0, 1000)]];
  for (const [id, text] of cases) {
    for (let k = 0; k < 20; k++) C.decode(id, C.encode(id, text).bytes); // warm up
    const times = [];
    for (let k = 0; k < 15; k++) {
      const t0 = performance.now();
      const e = C.encode(id, text);
      const d = C.decode(id, e.bytes);
      times.push(performance.now() - t0);
      assert.equal(d.text, text);
    }
    times.sort((a, b) => a - b);
    assert.ok(times[7] < 2, `${id}: median ${times[7].toFixed(3)}ms`);
  }
});
