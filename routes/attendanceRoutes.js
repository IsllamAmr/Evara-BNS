const express = require('express');
const { body } = require('express-validator');
const { checkIn, checkOut, createManualAttendance, getQrCode } = require('../controllers/attendanceController');
const { protect } = require('../middlewares/authMiddleware');
const { requireAdmin } = require('../middlewares/roleMiddleware');
const { handleValidation } = require('../middlewares/validationMiddleware');
const { attendanceActionLimiter, adminWriteLimiter } = require('../middlewares/rateLimiters');

const router = express.Router();

const attendanceContextValidators = [
  body('latitude').optional({ nullable: true }).isFloat({ min: -90, max: 90 }).withMessage('latitude must be a valid latitude'),
  body('longitude').optional({ nullable: true }).isFloat({ min: -180, max: 180 }).withMessage('longitude must be a valid longitude'),
  body('accuracy').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('accuracy must be a valid positive number'),
];

router.post('/checkin', attendanceActionLimiter, protect, attendanceContextValidators, handleValidation, checkIn);
router.post('/checkout', attendanceActionLimiter, protect, attendanceContextValidators, handleValidation, checkOut);
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
