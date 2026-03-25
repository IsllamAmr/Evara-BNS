const express = require('express');
const { body, param, query } = require('express-validator');
const {
  createRequest,
  getAllowanceSummary,
  listRequests,
  updateRequestStatus,
} = require('../controllers/requestController');
const { protect } = require('../middlewares/authMiddleware');
const { requireAdmin } = require('../middlewares/roleMiddleware');
const { attendanceActionLimiter, adminWriteLimiter } = require('../middlewares/rateLimiters');
const { handleValidation } = require('../middlewares/validationMiddleware');

const router = express.Router();

router.use(protect);

router.get(
  '/',
  [
    query('type').optional().isIn(['all', 'late_2_hours', 'annual_leave']).withMessage('type filter is invalid'),
    query('status').optional().isIn(['all', 'pending', 'approved', 'rejected', 'cancelled']).withMessage('status filter is invalid'),
    query('user_id').optional().isUUID().withMessage('user_id must be a valid UUID'),
  ],
  handleValidation,
  listRequests
);

router.get(
  '/allowance',
  [
    query('user_id').optional().isUUID().withMessage('user_id must be a valid UUID'),
    query('reference_date').optional().isISO8601({ strict: true, strictSeparator: true }).withMessage('reference_date must be a valid date'),
  ],
  handleValidation,
  getAllowanceSummary
);

router.post(
  '/',
  attendanceActionLimiter,
  [
    body('request_type').isIn(['late_2_hours', 'annual_leave']).withMessage('request_type is invalid'),
    body('late_date').optional({ nullable: true, values: 'falsy' }).isISO8601({ strict: true, strictSeparator: true }).withMessage('late_date must be a valid date'),
    body('leave_start_date').optional({ nullable: true, values: 'falsy' }).isISO8601({ strict: true, strictSeparator: true }).withMessage('leave_start_date must be a valid date'),
    body('leave_end_date').optional({ nullable: true, values: 'falsy' }).isISO8601({ strict: true, strictSeparator: true }).withMessage('leave_end_date must be a valid date'),
    body('reason').optional({ nullable: true }).isLength({ max: 1000 }).withMessage('reason must not exceed 1000 characters'),
    body('user_id').optional().isUUID().withMessage('user_id must be a valid UUID'),
  ],
  handleValidation,
  createRequest
);

router.patch(
  '/:id/status',
  adminWriteLimiter,
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
    body('status').isIn(['approved', 'rejected', 'cancelled']).withMessage('status must be approved, rejected, or cancelled'),
    body('admin_note').optional({ nullable: true }).isLength({ max: 1000 }).withMessage('admin_note must not exceed 1000 characters'),
  ],
  handleValidation,
  updateRequestStatus
);

module.exports = router;
