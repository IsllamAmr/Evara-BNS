// Fast static files: compressed (Brotli or gzip) and cached on the device.
//
// In production every asset link in the HTML is rewritten to /v/<version>/...,
// where <version> is a hash of all files in public/. Those URLs are cached for a
// year, so repeat visits download nothing. Any deploy that changes a file
// changes the version, so browsers fetch the new copy automatically.
// Relative ES-module imports inherit the /v/<version>/ prefix on their own.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CONTENT_TYPES = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.svg', '.json', '.webmanifest', '.txt']);
const MIN_COMPRESS_BYTES = 1024;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const VERSIONED_PATH = /^\/v\/([A-Za-z0-9_-]{1,40})(\/.*)$/;

function listFiles(root, dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(root, absolute, out);
    else if (entry.isFile()) out.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
  return out;
}

function computeAssetVersion(root) {
  const hash = crypto.createHash('sha256');
  for (const relative of listFiles(root).sort()) {
    hash.update(relative);
    hash.update(fs.readFileSync(path.join(root, relative)));
  }
  return hash.digest('hex').slice(0, 12);
}

// Brotli is ~15% smaller than gzip; both are supported by every current browser.
function pickEncoding(acceptEncoding = '') {
  const offered = String(acceptEncoding).toLowerCase().split(',').map((part) => {
    const [name, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return { name: name.trim(), q: q ? Number(q.slice(2)) : 1 };
  });
  const accepts = (name) => offered.some((item) => (item.name === name || item.name === '*') && item.q > 0);
  if (accepts('br')) return 'br';
  if (accepts('gzip')) return 'gzip';
  return null;
}

function compress(buffer, encoding, { fast = false } = {}) {
  if (encoding === 'br') {
    return zlib.brotliCompressSync(buffer, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: fast ? 5 : 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
      },
    });
  }
  return zlib.gzipSync(buffer, { level: fast ? 6 : 9 });
}

/** Sends a small dynamic text body (the rendered HTML pages) compressed. */
function sendCompressed(req, res, body, contentType) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Vary', 'Accept-Encoding');
  const encoding = buffer.length >= MIN_COMPRESS_BYTES ? pickEncoding(req.headers['accept-encoding']) : null;
  const payload = encoding ? compress(buffer, encoding, { fast: true }) : buffer;
  if (encoding) res.setHeader('Content-Encoding', encoding);
  res.setHeader('Content-Length', String(payload.length));
  if (req.method === 'HEAD') return res.end();
  return res.end(payload);
}

/** Points the page's own asset links at the versioned, long-cached URLs. */
function versionAssetLinks(html, version) {
  if (!version) return html;
  return html.replace(/(\s(?:href|src)=")\/?((?:css|js|vendor|assets)\/)/g, `$1/v/${version}/$2`);
}

function createStaticAssets({ root, version = null }) {
  const knownFiles = new Set(listFiles(root));
  const cache = new Map();

  function load(relative) {
    const absolute = path.join(root, relative);
    const stat = fs.statSync(absolute);
    const cached = cache.get(relative);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;
    const raw = fs.readFileSync(absolute);
    const entry = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      raw,
      hash: crypto.createHash('sha1').update(raw).digest('hex').slice(0, 20),
      encoded: {},
    };
    cache.set(relative, entry);
    return entry;
  }

  return function staticAssets(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    let pathname;
    try {
      pathname = decodeURIComponent(req.path);
    } catch (_error) {
      return next();
    }

    const versioned = pathname.match(VERSIONED_PATH);
    if (versioned) pathname = versioned[2];
    const relative = pathname.replace(/^\/+/, '');
    const extension = path.extname(relative).toLowerCase();

    // Unknown files, HTML pages and anything odd go to the regular handlers.
    if (!knownFiles.has(relative) || extension === '.html' || relative.split('/').includes('..')) {
      if (versioned) req.url = pathname + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
      return next();
    }

    let entry;
    try {
      entry = load(relative);
    } catch (_error) {
      return next();
    }

    const compressible = COMPRESSIBLE.has(extension) && entry.raw.length >= MIN_COMPRESS_BYTES;
    const encoding = compressible ? pickEncoding(req.headers['accept-encoding']) : null;
    const etag = `"${entry.hash}${encoding ? `-${encoding}` : ''}"`;

    res.setHeader('Content-Type', CONTENT_TYPES[extension] || 'application/octet-stream');
    res.setHeader('Cache-Control', versioned && versioned[1] === version ? IMMUTABLE : 'no-cache');
    res.setHeader('ETag', etag);
    if (compressible) res.setHeader('Vary', 'Accept-Encoding');

    const ifNoneMatch = String(req.headers['if-none-match'] || '');
    if (ifNoneMatch && ifNoneMatch.split(',').map((tag) => tag.trim().replace(/^W\//, '')).includes(etag)) {
      res.statusCode = 304;
      return res.end();
    }

    let body = entry.raw;
    if (encoding) {
      if (!entry.encoded[encoding]) entry.encoded[encoding] = compress(entry.raw, encoding);
      body = entry.encoded[encoding];
      res.setHeader('Content-Encoding', encoding);
    }
    res.setHeader('Content-Length', String(body.length));
    if (req.method === 'HEAD') return res.end();
    return res.end(body);
  };
}

module.exports = {
  computeAssetVersion,
  createStaticAssets,
  pickEncoding,
  sendCompressed,
  versionAssetLinks,
};
