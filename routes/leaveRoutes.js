const express = require('express');
const { body, param, query } = require('express-validator');
const { cancelLeave, createLeave, listLeaves, reviewLeave } = require('../controllers/leaveController');
const { protect } = require('../middlewares/authMiddleware');
const { handleValidation } = require('../middlewares/validationMiddleware');

const router = express.Router();

router.use(protect);

router.get(
  '/',
  [
    query('status').optional().isIn(['pending', 'approved', 'rejected', 'cancelled', 'all']).withMessage('status is invalid'),
    query('request_type').optional().isIn(['annual_leave', 'sick_leave', 'unpaid_leave', 'permission', 'all']).withMessage('request_type is invalid'),
    query('user_id').optional().isUUID().withMessage('user_id must be a valid UUID'),
    query('from').optional().isISO8601({ strict: true, strictSeparator: true }).withMessage('from must be a valid date'),
    query('to').optional().isISO8601({ strict: true, strictSeparator: true }).withMessage('to must be a valid date'),
  ],
  handleValidation,
  listLeaves
);

router.post(
  '/',
  [
    body('request_type').isIn(['annual_leave', 'sick_leave', 'unpaid_leave', 'permission']).withMessage('request_type is invalid'),
    body('request_scope').optional().isIn(['full_day', 'partial_day']).withMessage('request_scope is invalid'),
    body('start_date').isISO8601({ strict: true, strictSeparator: true }).withMessage('start_date must be a valid date'),
    body('end_date').optional().isISO8601({ strict: true, strictSeparator: true }).withMessage('end_date must be a valid date'),
    body('start_time').optional({ nullable: true, values: 'falsy' }).matches(/^\d{2}:\d{2}$/).withMessage('start_time must be a valid time'),
    body('end_time').optional({ nullable: true, values: 'falsy' }).matches(/^\d{2}:\d{2}$/).withMessage('end_time must be a valid time'),
    body('reason').notEmpty().withMessage('reason is required'),
  ],
  handleValidation,
  createLeave
);

router.patch(
  '/:id/review',
  [
    param('id').isInt({ min: 1 }).withMessage('id must be a valid numeric identifier'),
    body('status').isIn(['approved', 'rejected']).withMessage('status must be approved or rejected'),
    body('admin_note').optional({ nullable: true }).isString().withMessage('admin_note must be text'),
  ],
  handleValidation,
  reviewLeave
);

router.patch(
  '/:id/cancel',
  [param('id').isInt({ min: 1 }).withMessage('id must be a valid numeric identifier')],
  handleValidation,
  cancelLeave
);

module.exports = router;
