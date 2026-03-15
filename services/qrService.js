const QRCode = require('qrcode');

function getTargetUrl(req) {
  const configured = (process.env.QR_TARGET_URL || '').trim();
  if (configured) {
    return configured;
  }

  if (req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.get('host');
    if (host) {
      return `${protocol}://${host}/checkin`;
    }
  }

  return 'http://localhost:5000/checkin';
}

async function generateAttendanceQr(req) {
  const targetUrl = getTargetUrl(req);
  const dataUrl = await QRCode.toDataURL(targetUrl, {
    margin: 1,
    width: 320,
    color: {
      dark: '#111827',
      light: '#FFFFFFFF',
    },
  });

  return {
    targetUrl,
    dataUrl,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  generateAttendanceQr,
};
