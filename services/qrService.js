const QRCode = require('qrcode');
const { getAttendanceSettings } = require('./attendanceSettingsService');

function getCheckinBaseUrl(req) {
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

function buildCheckinUrl(baseUrl, token) {
  const url = new URL(baseUrl);
  url.searchParams.set('k', token);
  return url.toString();
}

async function generateAttendanceQr(req, settingsOverride = null) {
  const settings = settingsOverride || await getAttendanceSettings();
  const targetUrl = buildCheckinUrl(getCheckinBaseUrl(req), settings.qrToken);
  const dataUrl = await QRCode.toDataURL(targetUrl, {
    margin: 2,
    width: 640,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#111827',
      light: '#FFFFFFFF',
    },
  });

  return {
    targetUrl,
    dataUrl,
    generatedAt: new Date().toISOString(),
    tokenUpdatedAt: settings.updatedAt,
  };
}

module.exports = {
  buildCheckinUrl,
  generateAttendanceQr,
};
