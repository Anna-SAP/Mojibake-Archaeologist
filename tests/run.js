'use strict';
// Usage: node tests/run.js [filter]
// Runs every tests/*.test.js (optionally only files whose name contains `filter`).

const fs = require('fs');
const path = require('path');
const harness = require('./harness');

async function main() {
  const filter = process.argv[2] || '';
  const files = fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.test.js') && f.includes(filter))
    .sort();

  harness.loadAll();
  for (const f of files) require(path.join(__dirname, f));

  let passed = 0;
  const failures = [];
  for (const t of harness.tests) {
    try {
      await t.fn();
      passed++;
    } catch (err) {
      failures.push({ name: t.name, err });
    }
  }

  for (const f of failures) {
    console.log(`✗ ${f.name}\n    ${String(f.err && f.err.stack || f.err).split('\n').slice(0, 4).join('\n    ')}`);
  }
  console.log(`\n${passed} passed, ${failures.length} failed (${files.length} files)`);
  process.exitCode = failures.length ? 1 : 0;
}

main();
