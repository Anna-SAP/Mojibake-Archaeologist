'use strict';
// Zero-dependency static server for local preview: node tools/serve.js [port]
// The app itself works from file:// too; this exists for browsers or tools that
// restrict scripts on file:// pages.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8765);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

function send(res, code, text) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(text);
}

function handle(req, res) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (_) {
    send(res, 400, 'Bad request');
    return;
  }
  // fs throws synchronously on a NUL in the path; refuse it before it gets that far.
  if (rel.includes('\u0000')) {
    send(res, 400, 'Bad request');
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  // Dotfiles and dot-folders (.claude/, .git/ …) are not part of the site; this also catches
  // "." / ".." segments that only appear after percent-decoding.
  if (rel.split(/[\\/]/).some((seg) => seg.startsWith('.'))) {
    send(res, 404, 'Not found');
    return;
  }
  const file = path.resolve(ROOT, '.' + rel);
  // Refuse anything that escapes the project folder.
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    send(res, 403, 'Forbidden');
    return;
  }
  // Re-check on the resolved path, in case a segment only became a dot-segment after resolving.
  if (path.relative(ROOT, file).split(path.sep).some((seg) => seg.startsWith('.'))) {
    send(res, 404, 'Not found');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      send(res, 404, 'Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  try {
    handle(req, res);
  } catch (err) {
    // A malformed request must never take the preview server down.
    send(res, 500, 'Internal error');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`乱码考古学家 running at http://127.0.0.1:${PORT}/`);
});
