const express = require('express');
const { body } = require('express-validator');
const { checkIn, checkOut, createManualAttendance, getQrCode } = require('../controllers/attendanceController');
const { protect } = require('../middlewares/authMiddleware');
const { requireAdmin } = require('../middlewares/roleMiddleware');
const { handleValidation } = require('../middlewares/validationMiddleware');
const { attendanceActionLimiter, adminWriteLimiter } = require('../middlewares/rateLimiters');

const router = express.Router();

// Attendance is recorded only from the office QR page, which sends the QR secret.
const attendanceContextValidators = [
  body('qr_token').isString().withMessage('Scan the office QR code to record attendance').bail()
    .isLength({ min: 16, max: 128 }).withMessage('Scan the office QR code to record attendance'),
];

router.post('/checkin', attendanceActionLimiter, protect, attendanceContextValidators, handleValidation, checkIn);
router.post('/checkout', attendanceActionLimiter, protect, [
  ...attendanceContextValidators,
  body('work_notes').isString().withMessage('Daily work notes are required').bail().trim().isLength({ min: 1, max: 4000 }).withMessage('Daily work notes must contain 1 to 4000 characters'),
  body('work_place').optional({ nullable: true }).isString().bail().trim().isLength({ max: 120 }).withMessage('Workplace must be at most 120 characters'),
  body('training_minutes').optional({ nullable: true }).isInt({ min: 0, max: 1440 }).withMessage('Training minutes must be between 0 and 1440').toInt(),
], handleValidation, checkOut);
router.post(
  '/manual',
  adminWriteLimiter,
  protect,
  requireAdmin,
  [
    body('user_id').isUUID().withMessage('user_id must be a valid UUID'),
    body('attendance_date').isISO8601({ strict: true, strictSeparator: true }).withMessage('attendance_date must be a valid date'),
    body('attendance_status').isIn(['present', 'absent', 'late', 'checked_out']).withMessage('attendance_status is invalid'),
    body('check_in_time').optional({ nullable: true, values: 'falsy' }).isISO8601().withMessage('check_in_time must be a valid ISO date/time'),
    body('check_out_time').optional({ nullable: true, values: 'falsy' }).isISO8601().withMessage('check_out_time must be a valid ISO date/time'),
  ],
  handleValidation,
  createManualAttendance
);
router.get('/qr', protect, requireAdmin, getQrCode);

module.exports = router;
