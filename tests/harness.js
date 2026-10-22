'use strict';
// Minimal zero-dependency test harness shared by every tests/*.test.js file.

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

class AssertionError extends Error {}

function fmt(v) {
  if (v instanceof Uint8Array) return `Uint8Array[${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join(' ')}]`;
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

const assert = {
  ok(value, msg) {
    if (!value) throw new AssertionError(msg || `expected truthy, got ${fmt(value)}`);
  },
  equal(actual, expected, msg) {
    if (actual !== expected) {
      throw new AssertionError(`${msg ? msg + ': ' : ''}expected ${fmt(expected)}, got ${fmt(actual)}`);
    }
  },
  notEqual(actual, expected, msg) {
    if (actual === expected) throw new AssertionError(`${msg ? msg + ': ' : ''}did not expect ${fmt(actual)}`);
  },
  deepEqual(actual, expected, msg) {
    const a = fmt(actual);
    const e = fmt(expected);
    if (a !== e) throw new AssertionError(`${msg ? msg + ': ' : ''}expected ${e}, got ${a}`);
  },
  throws(fn, msg) {
    let threw = false;
    try { fn(); } catch (_) { threw = true; }
    if (!threw) throw new AssertionError(msg || 'expected function to throw');
  },
  async rejects(promise, msg) {
    let threw = false;
    try { await promise; } catch (_) { threw = true; }
    if (!threw) throw new AssertionError(msg || 'expected promise to reject');
  },
};

// Loads every src module into globalThis.MBX in browser order; safe to call repeatedly.
function loadAll() {
  const path = require('path');
  const order = ['i18n', 'lexicon', 'codecs', 'scorer', 'forge', 'engine', 'narrator', 'narrator-en', 'llm'];
  for (const name of order) {
    const file = path.join(__dirname, '..', 'src', `${name}.js`);
    try {
      require(file);
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND' || !String(err.message).includes(`${name}.js`)) throw err;
    }
  }
  return globalThis.MBX;
}

module.exports = { test, assert, tests, loadAll, AssertionError };
