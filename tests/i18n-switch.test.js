'use strict';
// The language switch in the page (docs/ARCHITECTURE.md §11.3), driven end to end: src/*.js run
// in a fresh vm context against index.html parsed into a small fake DOM, with fake timers, a
// counting Engine.analyze and a scripted AI docent. Covers what only the DOM controller does:
// no second search per switch, the adopted candidate / pinned byte / open disclosures survive,
// the AI docent restarts only when it was running, the dig log rewords mid-dig, the forge and
// the settings drawer relabel, and the I18n listener is registered once.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, assert } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const HAN = /\p{Script=Han}/u;

// ---------------------------------------------------------------------------
// A fake DOM: just what src/app.js touches
// ---------------------------------------------------------------------------

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
});
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function makeDom() {
  class FakeNode {
    get nextSibling() {
      const p = this.parentNode;
      return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null;
    }

    remove() {
      const p = this.parentNode;
      if (p) p.childNodes.splice(p.childNodes.indexOf(this), 1);
      this.parentNode = null;
    }
  }

  class FakeText extends FakeNode {
    constructor(s) {
      super();
      this.nodeType = 3;
      this.data = String(s);
      this.parentNode = null;
    }

    get textContent() { return this.data; }

    set textContent(v) { this.data = String(v); }
  }

  const doc = { activeElement: null };

  class FakeEl extends FakeNode {
    constructor(tag) {
      super();
      this.nodeType = 1;
      this.tagName = String(tag).toUpperCase();
      this.localName = String(tag).toLowerCase();
      this.childNodes = [];
      this.parentNode = null;
      this.attrs = new Map();
      this.listeners = {};
      this.value = '';
      this.checked = false;
      this.disabled = false;
      this.type = this.localName === 'input' ? 'text' : '';
      this.placeholder = '';
      this.tabIndex = -1;
      this.html = '';
      const props = new Map();
      this.style = new Proxy({}, {
        get: (t, k) => {
          if (k === 'setProperty') return (n, v) => props.set(n, String(v));
          if (k === 'removeProperty') return (n) => props.delete(n);
          if (k === 'getPropertyValue') return (n) => props.get(n) || '';
          return props.get(k) || '';
        },
        set: (t, k, v) => { props.set(k, String(v)); return true; },
      });
      const attrs = this.attrs;
      this.dataset = new Proxy({}, {
        get: (t, k) => (typeof k === 'string' && attrs.has(`data-${kebab(k)}`) ? attrs.get(`data-${kebab(k)}`) : undefined),
        set: (t, k, v) => { attrs.set(`data-${kebab(k)}`, String(v)); return true; },
        has: (t, k) => attrs.has(`data-${kebab(String(k))}`),
        ownKeys: () => [...attrs.keys()].filter((a) => a.startsWith('data-')).map((a) => a.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())),
        getOwnPropertyDescriptor: (t, k) => (attrs.has(`data-${kebab(String(k))}`)
          ? { value: attrs.get(`data-${kebab(String(k))}`), enumerable: true, configurable: true, writable: true } : undefined),
      });
      const self = this;
      this.classList = {
        add: (...c) => { const s = self.classSet(); c.forEach((x) => s.add(x)); self.className = [...s].join(' '); },
        remove: (...c) => { const s = self.classSet(); c.forEach((x) => s.delete(x)); self.className = [...s].join(' '); },
        toggle: (c, on) => {
          const s = self.classSet();
          const want = on === undefined ? !s.has(c) : !!on;
          if (want) s.add(c); else s.delete(c);
          self.className = [...s].join(' ');
          return want;
        },
        contains: (c) => self.classSet().has(c),
      };
    }

    classSet() { return new Set(this.className.split(/\s+/).filter(Boolean)); }

    get id() { return this.attrs.get('id') || ''; }

    set id(v) { this.attrs.set('id', String(v)); }

    get className() { return this.attrs.get('class') || ''; }

    set className(v) { this.attrs.set('class', String(v)); }

    get hidden() { return this.attrs.has('hidden'); }

    set hidden(v) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }

    get open() { return this.attrs.has('open'); }

    set open(v) { if (v) this.attrs.set('open', ''); else this.attrs.delete('open'); }

    get lang() { return this.attrs.get('lang') || ''; }

    set lang(v) { this.attrs.set('lang', String(v)); }

    get name() { return this.attrs.get('name') || ''; }

    get children() { return this.childNodes.filter((n) => n.nodeType === 1); }

    get firstElementChild() { return this.children[0] || null; }

    get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }

    get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }

    set textContent(v) {
      for (const n of this.childNodes) n.parentNode = null;
      this.childNodes = [];
      this.html = '';
      if (v !== '' && v != null) this.appendChild(new FakeText(v));
    }

    get innerHTML() { return this.html; }

    set innerHTML(v) {
      this.textContent = '';
      this.html = String(v);
      // Trusted dictionary markup: keep its text so tests can read it.
      const text = decode(String(v).replace(/<[^>]*>/g, ''));
      if (text) this.appendChild(new FakeText(text));
    }

    get offsetParent() { return null; }

    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }

    setAttribute(k, v) { this.attrs.set(k, String(v)); }

    removeAttribute(k) { this.attrs.delete(k); }

    hasAttribute(k) { return this.attrs.has(k); }

    toggleAttribute(k, on) { if (on === undefined ? !this.attrs.has(k) : on) this.attrs.set(k, ''); else this.attrs.delete(k); }

    appendChild(n) {
      if (n.parentNode) n.remove();
      n.parentNode = this;
      this.childNodes.push(n);
      return n;
    }

    append(...kids) { for (const k of kids) this.appendChild(k instanceof FakeNode ? k : new FakeText(k)); }

    prepend(...kids) {
      kids.slice().reverse().forEach((k) => {
        const n = k instanceof FakeNode ? k : new FakeText(k);
        if (n.parentNode) n.remove();
        n.parentNode = this;
        this.childNodes.unshift(n);
      });
    }

    insertAt(nodes, index) {
      const list = nodes.map((k) => (k instanceof FakeNode ? k : new FakeText(k)));
      for (const n of list) if (n.parentNode) n.remove();
      for (const n of list) n.parentNode = this;
      this.childNodes.splice(index, 0, ...list);
    }

    after(...kids) { const p = this.parentNode; if (p) p.insertAt(kids, p.childNodes.indexOf(this) + 1); }

    before(...kids) { const p = this.parentNode; if (p) p.insertAt(kids, p.childNodes.indexOf(this)); }

    replaceWith(...kids) { const p = this.parentNode; if (p) { this.before(...kids); this.remove(); } }

    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }

    descendants() {
      const out = [];
      const walk = (el) => { for (const c of el.children) { out.push(c); walk(c); } };
      walk(this);
      return out;
    }

    matches(sel) { return parseSelector(sel).some((compound) => matchCompound(this, compound)); }

    closest(sel) { for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (x.matches(sel)) return x; return null; }

    querySelectorAll(sel) { const list = parseSelector(sel); return this.descendants().filter((el) => list.some((c) => matchCompound(el, c))); }

    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }

    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }

    removeEventListener(type, fn) { const l = this.listeners[type] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }

    // Dispatches a bubbling event; returns it.
    fire(type, init) {
      const ev = Object.assign({ type, target: this, defaultPrevented: false, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() {} }, init || {});
      for (let x = this; x; x = x.parentNode) for (const fn of (x.listeners && x.listeners[type]) || []) fn.call(x, ev);
      return ev;
    }

    click() {
      if (this.localName === 'input' && (this.type === 'checkbox')) this.checked = !this.checked;
      this.fire('click');
      if (this.localName === 'input' && this.type === 'checkbox') this.fire('change');
    }

    focus() { doc.activeElement = this; }

    blur() {}

    select() {}

    scrollIntoView() {}

    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }

    get offsetTop() { return 0; }

    get offsetHeight() { return 0; }

    get offsetWidth() { return 0; }

    get clientWidth() { return 0; }

    get clientHeight() { return 0; }

    get scrollHeight() { return 0; }

    get scrollWidth() { return 0; }

    showModal() { this.open = true; }

    close() { this.open = false; this.fire('close'); }
  }

  // Compound selectors only (tag, #id, .class, [attr], [attr="v"], :checked), comma lists.
  function parseSelector(sel) {
    return String(sel).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const c = { tag: null, id: null, classes: [], attrs: [], checked: false };
      const re = /^([a-z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|:(checked)/gi;
      let m;
      let pos = 0;
      while ((m = re.exec(s)) && m.index === pos) {
        pos = re.lastIndex;
        if (m[1]) c.tag = m[1].toLowerCase();
        else if (m[2]) c.id = m[2];
        else if (m[3]) c.classes.push(m[3]);
        else if (m[4]) c.attrs.push([m[4], m[5]]);
        else if (m[6]) c.checked = true;
        if (pos >= s.length) break;
      }
      if (pos !== s.length) throw new Error(`fake DOM: unsupported selector "${s}"`);
      return c;
    });
  }

  function matchCompound(el, c) {
    if (c.tag && el.localName !== c.tag) return false;
    if (c.id && el.id !== c.id) return false;
    if (c.classes.length) { const s = el.classSet(); if (!c.classes.every((x) => s.has(x))) return false; }
    for (const [k, v] of c.attrs) {
      if (k === 'value' && v !== undefined ? String(el.value) !== v : (!el.attrs.has(k) || (v !== undefined && el.attrs.get(k) !== v))) return false;
    }
    if (c.checked && !el.checked) return false;
    return true;
  }

  // index.html -> tree. The page is hand-written and well-formed; scripts and styles are skipped.
  function parseHtml(html) {
    const root = new FakeEl('#document');
    const stack = [root];
    const top = () => stack[stack.length - 1];
    const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(script|style)\b[^>]*>[\s\S]*?<\/\1>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+/gi;
    let m;
    while ((m = re.exec(html))) {
      if (m[2]) {
        const tag = m[2].toLowerCase();
        for (let i = stack.length - 1; i > 0; i--) if (stack[i].localName === tag) { stack.length = i; break; }
      } else if (m[3]) {
        const el = new FakeEl(m[3]);
        for (const a of (m[4] || '').matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
          el.attrs.set(a[1].toLowerCase() === a[1] ? a[1] : a[1], decode(a[2] ?? a[3] ?? a[4] ?? ''));
        }
        if (el.attrs.has('type')) el.type = el.attrs.get('type');
        if (el.attrs.has('value')) el.value = el.attrs.get('value');
        if (el.attrs.has('checked')) el.checked = true;
        if (el.attrs.has('disabled')) el.disabled = true;
        top().appendChild(el);
        if (!VOID.has(el.localName) && !m[5]) stack.push(el);
      } else if (m[0][0] !== '<') {
        top().appendChild(new FakeText(decode(m[0])));
      }
    }
    return root;
  }

  const tree = parseHtml(read('index.html'));
  const html = tree.children.find((e) => e.localName === 'html');
  const head = html.children.find((e) => e.localName === 'head');
  const body = html.children.find((e) => e.localName === 'body');
  Object.assign(doc, {
    readyState: 'complete',
    documentElement: html,
    head,
    body,
    fonts: undefined,
    getElementById: (id) => html.descendants().find((e) => e.id === id) || null,
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    createElement: (t) => new FakeEl(t),
    createTextNode: (s) => new FakeText(s),
    addEventListener() {},
    execCommand: () => false,
  });
  return { doc, FakeNode, FakeEl, FakeText };
}

// ---------------------------------------------------------------------------
// The page in a vm context
// ---------------------------------------------------------------------------

function fakeStorage(init) {
  const map = new Map(Object.entries(init || {}));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}

/*
 * Boots the page. opts.prefs: mbx.prefs; returns handles: the DOM, MBX, fake timers (advance /
 * flush), the analyze log, the AI docent's calls (each with a resolve()), the I18n listener count.
 */
function bootPage(opts) {
  const o = opts || {};
  const { doc, FakeNode } = makeDom();
  let clock = 0;
  let seq = 0;
  const timers = [];
  const rafs = [];
  const sandbox = {
    console, TextDecoder, TextEncoder, URL, URLSearchParams, AbortController, queueMicrotask, structuredClone,
    Node: FakeNode,
    document: doc,
    navigator: { language: 'zh-CN', languages: ['zh-CN'], platform: 'Win32', userAgent: 'node', onLine: true, clipboard: { writeText: async () => {} } },
    localStorage: fakeStorage({ 'mbx.prefs': JSON.stringify(Object.assign({ animation: false, voice: false, ai: true }, o.prefs || {})) }),
    sessionStorage: fakeStorage(),
    location: { search: '', hash: '', href: 'http://localhost:8765/', pathname: '/' },
    history: { state: null, replaceState(s, t, url) { sandbox.location.href = String(url); } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    performance: { now: () => clock },
    setTimeout: (fn, ms) => { const id = ++seq; timers.push({ id, at: clock + Math.max(0, ms || 0), fn }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
    cancelAnimationFrame: () => {},
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
    innerHeight: 800,
    innerWidth: 1280,
    isSecureContext: true,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  const load = (name) => vm.runInContext(read(`src/${name}.js`), sandbox, { filename: `src/${name}.js` });
  for (const name of ['i18n', 'lexicon', 'codecs', 'scorer', 'forge', 'engine', 'narrator', 'narrator-en', 'llm']) load(name);
  const MBX = sandbox.MBX;

  // Count I18n listeners (app.js must subscribe once, not once per switch).
  let listeners = 0;
  const onChange = MBX.I18n.onChange;
  MBX.I18n.onChange = (fn) => {
    listeners++;
    const off = onChange(fn);
    return () => { listeners--; off(); };
  };

  // Every search, with the locale it was asked for.
  const analyses = [];
  const analyze = MBX.Engine.analyze;
  MBX.Engine.analyze = function (input, options) {
    analyses.push({ input, locale: options && options.locale });
    return analyze.call(this, input, options);
  };

  // A scripted AI docent: every call waits until the test resolves it (or it is aborted).
  const aiCalls = [];
  const LLM = MBX.LLM;
  LLM.isReady = () => true;
  LLM.loadConfig = () => ({ provider: 'anthropic', apiKey: 'test-key', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5' });
  LLM.narrate = (view, args) => new Promise((resolve, reject) => {
    const call = { locale: args.locale, signal: args.signal, resolve: (text) => resolve({ text, provider: 'anthropic', model: 'mock' }) };
    if (args.signal) args.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'aborted', name: 'AbortError' })));
    aiCalls.push(call);
  });
  const tests = [];
  LLM.testConnection = (cfg, locale) => new Promise((resolve) => { tests.push({ locale, resolve }); });

  load('app');

  const el = (id) => doc.getElementById(id);
  const page = {
    doc, MBX, el, analyses, aiCalls, tests, timers, storage: sandbox.localStorage,
    get listeners() { return listeners; },
    // Runs timers and animation frames (one batch per 16 ms) up to `ms` from now, in time order.
    advance(ms) {
      const until = clock + ms;
      for (let guard = 0; ; guard++) {
        if (guard > 200000) throw new Error('fake timers: runaway loop');
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = timers[0];
        const nextTimer = t ? t.at : Infinity;
        const nextFrame = rafs.length ? clock + 16 : Infinity;
        const next = Math.min(nextTimer, nextFrame);
        if (next > until) break;
        clock = Math.max(clock, next);
        if (nextTimer <= nextFrame) {
          timers.shift();
          t.fn();
        } else {
          for (const fn of rafs.splice(0)) fn(clock);
        }
      }
      clock = until;
    },
    flush() { page.advance(60000); },
    async settle() { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); page.flush(); },
    setLocale(id) { MBX.I18n.setLocale(id); },
    clickLang(id) { el('langSwitch').querySelector(`[data-locale="${id}"]`).click(); },
    dig(text) {
      el('relicInput').value = text;
      el('digForm').fire('submit');
    },
    text: (id) => el(id).textContent,
  };
  return page;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('i18n-switch: the page boots in zh-CN and the EN button translates every static text', () => {
  const page = bootPage();
  assert.equal(page.doc.documentElement.lang, 'zh-CN');
  assert.equal(page.text('relicCount'), '0 字');
  page.clickLang('en-US');
  assert.equal(page.MBX.I18n.getLocale(), 'en-US');
  assert.equal(page.doc.documentElement.lang, 'en-US');
  assert.equal(page.doc.title, 'Mojibake Archaeologist · Museum of Encodings');
  assert.equal(page.el('langSwitch').querySelector('[data-locale="en-US"]').getAttribute('aria-pressed'), 'true');
  // Every text node outside elements marked lang="zh-CN" (brand garnish, the ZH button, the
  // Chinese half of the switch's name) is English. The gallery cards and forge recipes quote
  // relic glyphs (data); tests/i18n-leak.test.js checks their wording with the data cut out.
  const leaks = [];
  const DATA_LISTS = new Set(['galleryList', 'forgePreset']);
  const walk = (node, zh) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (!zh && HAN.test(n.data)) leaks.push(n.data.trim()); continue; }
      if (n.localName === 'script' || n.localName === 'style') continue;
      const mark = zh || /^zh/i.test(n.getAttribute('lang') || '') || DATA_LISTS.has(n.id);
      for (const a of ['placeholder', 'aria-label', 'title']) if (!mark && HAN.test(n.getAttribute(a) || '')) leaks.push(`${a}=${n.getAttribute(a)}`);
      walk(n, mark);
    }
  };
  walk(page.doc.body, false);
  assert.deepEqual(leaks, [], 'Chinese left on the English page');
  assert.equal(JSON.parse(page.storage.getItem('mbx.prefs')).lang, 'en-US', 'the choice is remembered');
});

test('i18n-switch: switching relabels the result without searching again, and keeps the view', async () => {
  const page = bootPage();
  page.dig('Ã¦â€“â€¡Ã§â€°Â©');
  page.flush();
  assert.equal(page.analyses.length, 1, 'one search for the dig');
  assert.equal(page.analyses[0].locale, 'zh-CN');
  assert.ok(HAN.test(page.el('verdict').textContent), 'Chinese verdict');
  // AI docent requested once (zh); the visitor adopts candidate B, which restarts it (zh again).
  assert.equal(page.aiCalls.length, 1);
  assert.equal(page.aiCalls[0].locale, 'zh-CN');
  page.el('alternatives').querySelector('.alt__btn[data-index="1"]').click();
  page.flush();
  assert.equal(page.aiCalls.length, 2, 'adopting a candidate restarts the AI docent');
  assert.equal(page.aiCalls[0].signal.aborted, true);
  // Pin a byte, open the low-confidence guesses and the era evidence.
  const cell = page.el('strataBody').querySelector('.bg-char');
  assert.ok(cell, 'a byte-grid character');
  cell.click();
  const pinnedRow = cell.dataset.row;
  const pinnedK = cell.dataset.k;
  assert.ok(cell.classList.contains('is-focus'), 'pinned');
  const more = page.el('alternatives').querySelector('.alts__more');
  if (more) more.open = true;

  page.clickLang('en-US');
  page.flush();
  assert.equal(page.analyses.length, 1, 'no second search: the result is relabeled');
  assert.ok(!HAN.test(page.el('verdict').querySelector('.verdict__headline').textContent), 'English verdict headline');
  const current = page.el('alternatives').querySelector('.alt__btn[aria-current="true"]');
  assert.equal(current && current.getAttribute('data-index'), '1', 'the adopted candidate stays adopted');
  assert.ok(!HAN.test(current.querySelector('.alt__label').textContent), `English chain label: ${current.querySelector('.alt__label').textContent}`);
  // The AI docent was running: aborted and asked again, in English.
  assert.equal(page.aiCalls.length, 3, 'the running AI narration restarts');
  assert.equal(page.aiCalls[1].signal.aborted, true, 'the Chinese request is aborted');
  assert.equal(page.aiCalls[2].locale, 'en-US');
  // View state that a re-render would reset.
  const pinned = page.el('strataBody').querySelector('.bg-char.is-focus') || page.el('strataBody').querySelector('.is-focus');
  assert.ok(pinned && pinned.dataset.row === pinnedRow && pinned.dataset.k === pinnedK, 'the pinned byte stays pinned');
  assert.equal(pinned.tabIndex, 0, 'and is the grid\'s tab stop');
  const readout = pinned.closest('.stratum').querySelector('.stratum__readout').textContent;
  assert.ok(/^(Misread|Read) by /.test(readout), `readout in English: ${readout}`);
  if (more) assert.equal(page.el('alternatives').querySelector('.alts__more').open, true, 'the guesses stay unfolded');

  // The English AI narration finishes; switching back does not request it again.
  page.aiCalls[2].resolve('The AI docent speaks.');
  await page.settle();
  assert.equal(page.el('aiToggle').checked, true);
  page.clickLang('zh-CN');
  page.flush();
  assert.equal(page.aiCalls.length, 3, 'a finished AI narration is not re-requested (quota)');
  assert.equal(page.el('aiToggle').checked, false, 'the switch shows the AI is off for this exhibit');
  assert.equal(page.text('aiNotice'), page.MBX.I18n.t('ai.noticeLangSwitch', null, 'zh-CN'));
  assert.ok(HAN.test(page.el('narration').textContent), 'the built-in docent speaks Chinese');
  // Flipping the AI switch on asks again, in the language on screen.
  page.el('aiToggle').click();
  page.flush();
  assert.equal(page.aiCalls.length, 4);
  assert.equal(page.aiCalls[3].locale, 'zh-CN');
  assert.equal(page.analyses.length, 1, 'still a single search');
  // One I18n subscription, however often the language changes.
  for (let i = 0; i < 10; i++) page.clickLang(i % 2 ? 'zh-CN' : 'en-US');
  page.flush();
  assert.equal(page.listeners, 1, 'app.js subscribes to I18n once');
  assert.equal(page.analyses.length, 1, 'ten switches, no search');
});

test('i18n-switch: a switch during the dig animation rewords the log and searches once, in the new language', () => {
  const page = bootPage({ prefs: { animation: true, ai: false } });
  page.dig('å¤§å®¶å¥½');
  page.advance(0);
  const first = page.el('digLog').firstElementChild;
  assert.ok(first && HAN.test(first.textContent), 'a Chinese log line');
  assert.equal(page.analyses.length, 0, 'the search waits a frame');
  page.clickLang('en-US');
  assert.equal(page.el('digLog').firstElementChild.textContent, 'Brushing away the topsoil…', 'reworded in place');
  assert.equal(page.analyses.length, 0, 'no search on the switch');
  page.advance(5000);
  assert.deepEqual(page.analyses.map((a) => a.locale), ['en-US'], 'one search, in the language on screen');
  assert.ok(!HAN.test(page.el('verdict').querySelector('.verdict__headline').textContent), 'English verdict');
  assert.equal(page.el('digLog').textContent, '', 'the hidden log is cleared');
  // A switch after the dig leaves no old-language lines behind either.
  page.clickLang('zh-CN');
  assert.equal(page.el('digLog').textContent, '');
});

test('i18n-switch: the forge error and the settings drawer follow the language', async () => {
  const page = bootPage({ prefs: { ai: false } });
  page.el('forgeText').value = '';
  page.el('forgeForm').fire('submit');
  assert.equal(page.text('forgeError'), page.MBX.I18n.t('forge.needText', null, 'zh-CN'));
  page.clickLang('en-US');
  assert.equal(page.text('forgeError'), 'Write some original text first, then we can age it.');

  // Settings drawer: a finished test quoting llm.js's own message, then a switch.
  page.el('openSettings').click();
  page.el('setProvider').value = 'anthropic';
  page.el('setProvider').fire('change');
  page.el('testConn').click();
  assert.equal(page.tests.length, 1);
  assert.equal(page.tests[0].locale, 'en-US');
  page.tests[0].resolve({ ok: true, message: 'Mock OK (English)' });
  await page.settle();
  assert.equal(page.text('testResult'), 'Mock OK (English)');
  page.el('settingsDialog').querySelector('[data-locale="zh-CN"]').click();
  assert.equal(page.text('testResult'), page.MBX.I18n.t('settings.testOkStale', null, 'zh-CN'), 'no English left, no new request');
  assert.equal(page.tests.length, 1);
  // A test still running when the language changes ends in the new language.
  page.el('testConn').click();
  assert.equal(page.tests[1].locale, 'zh-CN');
  page.el('settingsDialog').querySelector('[data-locale="en-US"]').click();
  assert.equal(page.text('testResult'), 'Reaching the docent…');
  page.tests[1].resolve({ ok: false, message: '无法连接（中文消息）' });
  await page.settle();
  assert.equal(page.text('testResult'), 'Connection failed.', 'the old-language message is not shown');
});
