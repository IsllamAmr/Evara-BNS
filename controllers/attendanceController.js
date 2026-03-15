const asyncHandler = require('../utils/asyncHandler');
const attendanceWriteService = require('../services/attendanceWriteService');
const qrService = require('../services/qrService');
const { sendSuccess } = require('../utils/responseHelper');

const checkIn = asyncHandler(async (req, res) => {
  const data = await attendanceWriteService.checkIn(req.supabase, {
    p_ip_address: req.ip || null,
    p_device_info: req.headers['user-agent'] || null,
  });

  return sendSuccess(
    res,
    {
      message: 'Check-in recorded successfully',
      data,
    },
    201
  );
});

const checkOut = asyncHandler(async (req, res) => {
  const data = await attendanceWriteService.checkOut(req.supabase, {
    p_ip_address: req.ip || null,
    p_device_info: req.headers['user-agent'] || null,
  });

  return sendSuccess(res, {
    message: 'Check-out recorded successfully',
    data,
  });
});

const getQrCode = asyncHandler(async (req, res) => {
  const qr = await qrService.generateAttendanceQr(req);

  return sendSuccess(res, {
    data: {
      qr_image: qr.dataUrl,
      checkin_url: qr.targetUrl,
      generated_at: qr.generatedAt,
      expires_at: null,
    },
  });
});

module.exports = {
  checkIn,
  checkOut,
  getQrCode,
};

