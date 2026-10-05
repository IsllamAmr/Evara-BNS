import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.window = {
  location: { origin: 'https://evara.example', pathname: '/' },
  __EVARA_CONFIG__: { APP_URL: 'https://evara.example' },
};
const { officeQrDestination } = await import('../public/js/qrScanner.js');
const token = 'office_QR_preview_token_123456789';
const destination = `/checkin?k=${token}`;
assert.equal(officeQrDestination(`https://evara.example/checkin?k=${token}`), destination);
assert.equal(officeQrDestination(`https://evara.example/checkin.html?k=${token}&next=https://other.example`), destination);
for (const value of [
  `https://other.example/checkin?k=${token}`,
  `https://evara.example.evil.example/checkin?k=${token}`,
  `https://username:password@evara.example/checkin?k=${token}`,
  `https://evara.example/admin?k=${token}`,
  'https://evara.example/checkin',
  'https://evara.example/checkin?k=short',
  `https://evara.example/checkin?k=${'x'.repeat(257)}`,
  'https://evara.example/checkin?k=not%20a%20token',
  'javascript:alert(1)',
  '//other.example/checkin?k=test',
  'not a URL',
]) assert.equal(officeQrDestination(value), null, `Reject unrelated or malformed QR: ${value}`);

const require = createRequire(import.meta.url);
const QRCode = require('qrcode');
const { PNG } = require('pngjs');
const decode = require('../public/vendor/jsQR.js');
const source = `https://evara.example${destination}`;
const png = PNG.sync.read(await QRCode.toBuffer(source, { width: 512, margin: 3 }));
const code = decode(new Uint8ClampedArray(png.data), png.width, png.height, { inversionAttempts: 'dontInvert' });
assert.equal(code?.data, source, 'Bundled decoder reads the generated attendance QR');
assert.equal(officeQrDestination(code.data), destination);
console.log('Office QR URL validation and real QR image decoding passed.');
