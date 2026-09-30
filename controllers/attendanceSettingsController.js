const asyncHandler = require('../utils/asyncHandler');
const settingsService = require('../services/attendanceSettingsService');
const qrService = require('../services/qrService');
const { resolveClientIp, isIpAllowed } = require('../services/attendanceGuardService');
const { sendSuccess } = require('../utils/responseHelper');

async function buildSettingsResponse(req, settings) {
  const qr = await qrService.generateAttendanceQr(req, settings);
  const detectedIp = resolveClientIp(req);
  const rules = Array.from(new Set([...settings.allowedNetworks, ...settings.environmentNetworks]));

  return {
    qr_image: qr.dataUrl,
    checkin_url: qr.targetUrl,
    qr_updated_at: settings.updatedAt,
    require_office_network: settings.requireOfficeNetwork,
    allowed_networks: settings.allowedNetworks,
    environment_networks: settings.environmentNetworks,
    detected_ip: detectedIp || null,
    detected_ip_allowed: detectedIp ? isIpAllowed(detectedIp, rules) : false,
  };
}

const getSettings = asyncHandler(async (req, res) => {
  const settings = await settingsService.getAttendanceSettings({ force: true });
  return sendSuccess(res, { data: await buildSettingsResponse(req, settings) });
});

const updateSettings = asyncHandler(async (req, res) => {
  const settings = await settingsService.updateAttendanceSettings(req.body, req.user);
  return sendSuccess(res, {
    message: 'Attendance settings saved',
    data: await buildSettingsResponse(req, settings),
  });
});

const rotateQr = asyncHandler(async (req, res) => {
  const settings = await settingsService.rotateQrToken(req.user);
  return sendSuccess(res, {
    message: 'A new QR code was generated. Print it and replace the old one.',
    data: await buildSettingsResponse(req, settings),
  });
});

module.exports = {
  getSettings,
  rotateQr,
  updateSettings,
};
