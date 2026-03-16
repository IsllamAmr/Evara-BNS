const asyncHandler = require('../utils/asyncHandler');
const attendanceWriteService = require('../services/attendanceWriteService');
const attendanceAdminService = require('../services/attendanceAdminService');
const attendanceGuardService = require('../services/attendanceGuardService');
const qrService = require('../services/qrService');
const { sendSuccess } = require('../utils/responseHelper');

const checkIn = asyncHandler(async (req, res) => {
  const attendanceContext = attendanceGuardService.extractAttendanceContext(req);
  attendanceGuardService.validateAttendanceAccess(attendanceContext);

  const data = await attendanceWriteService.checkIn(req.supabase, {
    p_ip_address: attendanceContext.ipAddress || null,
    p_device_info: attendanceGuardService.buildDeviceInfo(req),
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
  const attendanceContext = attendanceGuardService.extractAttendanceContext(req);
  attendanceGuardService.validateAttendanceAccess(attendanceContext);

  const data = await attendanceWriteService.checkOut(req.supabase, {
    p_ip_address: attendanceContext.ipAddress || null,
    p_device_info: attendanceGuardService.buildDeviceInfo(req),
  });

  return sendSuccess(res, {
    message: 'Check-out recorded successfully',
    data,
  });
});

const createManualAttendance = asyncHandler(async (req, res) => {
  const data = await attendanceAdminService.createOrUpdateManualAttendance(req.body, req.user);

  return sendSuccess(
    res,
    {
      message: 'Manual attendance entry saved successfully',
      data,
    },
    201
  );
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
  createManualAttendance,
  checkIn,
  checkOut,
  getQrCode,
};
