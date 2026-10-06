// Static asset speed: Brotli/gzip compression, versioned long-term caching,
// ETag revalidation and HTML link rewriting. Runs without Supabase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const express = require('express');
const {
  computeAssetVersion, createStaticAssets, pickEncoding, sendCompressed, versionAssetLinks,
} = require('../middlewares/staticAssets');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evara-static-'));
fs.mkdirSync(path.join(root, 'js'));
fs.mkdirSync(path.join(root, 'assets'));
const script = `export const value = "${'x'.repeat(5000)}";\n`;
fs.writeFileSync(path.join(root, 'js', 'app.js'), script);
fs.writeFileSync(path.join(root, 'js', 'tiny.js'), 'export {};\n');
fs.writeFileSync(path.join(root, 'assets', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const version = computeAssetVersion(root);
assert.match(version, /^[0-9a-f]{12}$/);

assert.equal(pickEncoding('gzip, deflate, br'), 'br');
assert.equal(pickEncoding('gzip, br;q=0'), 'gzip');
assert.equal(pickEncoding('identity'), null);
assert.equal(pickEncoding(''), null);

const html = '<link rel="stylesheet" href="css/style.css" /><link rel="manifest" href="/manifest.webmanifest" /><img src="/assets/logo.svg" /><script src="vendor/supabase.js"></script><script type="module" src="js/app.js"></script><a href="https://x.test/js/a.js">';
const rewritten = versionAssetLinks(html, 'abc123');
assert.ok(rewritten.includes('href="/v/abc123/css/style.css"'));
assert.ok(rewritten.includes('src="/v/abc123/assets/logo.svg"'));
assert.ok(rewritten.includes('src="/v/abc123/vendor/supabase.js"'));
assert.ok(rewritten.includes('src="/v/abc123/js/app.js"'));
assert.ok(rewritten.includes('href="/manifest.webmanifest"'), 'Manifest keeps its fixed URL');
assert.ok(rewritten.includes('href="https://x.test/js/a.js"'), 'External links are untouched');
assert.equal(versionAssetLinks(html, null), html, 'Local development keeps plain URLs');

const app = express();
app.get('/page', (req, res) => sendCompressed(req, res, `<p>${'hello '.repeat(400)}</p>`, 'text/html; charset=utf-8'));
app.use(createStaticAssets({ root, version }));
app.use((req, res) => res.status(404).send(`fallthrough:${req.url}`));

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  // Node fetch decompresses transparently; ask for raw bytes via a plain request.
  const http = require('node:http');
  const get = (url, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request(`${base}${url}`, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });

  try {
    let r = await get('/js/app.js', { 'accept-encoding': 'gzip, br' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-encoding'], 'br');
    assert.equal(zlib.brotliDecompressSync(r.body).toString(), script);
    assert.ok(r.body.length < script.length / 10, 'Brotli shrinks the script');
    assert.equal(r.headers['cache-control'], 'no-cache', 'Unversioned URLs are revalidated');
    assert.match(r.headers['content-type'], /javascript/);
    assert.equal(r.headers.vary, 'Accept-Encoding');

    r = await get('/js/app.js', { 'accept-encoding': 'gzip' });
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.equal(zlib.gunzipSync(r.body).toString(), script);

    r = await get('/js/app.js');
    assert.equal(r.headers['content-encoding'], undefined);
    assert.equal(r.body.toString(), script);

    r = await get(`/v/${version}/js/app.js`, { 'accept-encoding': 'br' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
    const etag = r.headers.etag;
    r = await get(`/v/${version}/js/app.js`, { 'accept-encoding': 'br', 'if-none-match': etag });
    assert.equal(r.status, 304, 'Matching ETag answers 304 Not Modified');
    assert.equal(r.body.length, 0);

    r = await get('/v/oldversion1/js/app.js', { 'accept-encoding': 'br' });
    assert.equal(r.headers['cache-control'], 'no-cache', 'A stale version is never cached long-term');

    r = await get('/js/tiny.js', { 'accept-encoding': 'br' });
    assert.equal(r.headers['content-encoding'], undefined, 'Tiny files are not compressed');

    r = await get(`/v/${version}/assets/logo.png`, { 'accept-encoding': 'br' });
    assert.equal(r.headers['content-type'], 'image/png');
    assert.equal(r.headers['content-encoding'], undefined, 'Images are already compressed');

    r = await get(`/v/${version}/js/missing.js`);
    assert.equal(r.status, 404);
    assert.equal(r.body.toString(), 'fallthrough:/js/missing.js', 'Unknown versioned files fall through without the prefix');

    r = await get('/js/../../etc/passwd');
    assert.equal(r.status, 404);

    r = await get('/js/app.js', { 'accept-encoding': 'br' }, 'HEAD');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 0);

    r = await get('/page', { 'accept-encoding': 'gzip' });
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.ok(zlib.gunzipSync(r.body).toString().startsWith('<p>hello'));
    console.log('Static assets: Brotli/gzip, versioned immutable caching, ETag 304, fall-through and HTML rewriting passed.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
