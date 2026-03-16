const express = require('express');
const { body, param } = require('express-validator');
const {
  createEmployee,
  deleteEmployee,
  resetEmployeePassword,
  toggleEmployeeStatus,
  updateEmployee,
} = require('../controllers/adminController');
const { protect } = require('../middlewares/authMiddleware');
const { requireAdmin } = require('../middlewares/roleMiddleware');
const { adminWriteLimiter } = require('../middlewares/rateLimiters');
const { handleValidation } = require('../middlewares/validationMiddleware');

const router = express.Router();

router.use(protect, requireAdmin, adminWriteLimiter);

router.post(
  '/employees',
  [
    body('employee_code').notEmpty().withMessage('employee_code is required'),
    body('full_name').notEmpty().withMessage('full_name is required'),
    body('email').isEmail().withMessage('A valid email is required'),
    body('password')
      .isStrongPassword({
        minLength: 8,
        minLowercase: 1,
        minUppercase: 1,
        minNumbers: 1,
        minSymbols: 1,
      })
      .withMessage('password must be at least 8 chars and include upper, lower, number, and symbol'),
    body('role').isIn(['admin', 'employee']).withMessage('role must be admin or employee'),
    body('status').isIn(['active', 'inactive', 'on_leave']).withMessage('status is invalid'),
  ],
  handleValidation,
  createEmployee
);

router.put(
  '/employees/:id',
  [
    param('id').isUUID().withMessage('id must be a valid UUID'),
    body('email').optional().isEmail().withMessage('A valid email is required'),
    body('role').optional().isIn(['admin', 'employee']).withMessage('role must be admin or employee'),
    body('status').optional().isIn(['active', 'inactive', 'on_leave']).withMessage('status is invalid'),
  ],
  handleValidation,
  updateEmployee
);

router.delete(
  '/employees/:id',
  [param('id').isUUID().withMessage('id must be a valid UUID')],
  handleValidation,
  deleteEmployee
);

router.patch(
  '/employees/:id/reset-password',
  [
    param('id').isUUID().withMessage('id must be a valid UUID'),
    body('new_password')
      .isStrongPassword({
        minLength: 8,
        minLowercase: 1,
        minUppercase: 1,
        minNumbers: 1,
        minSymbols: 1,
      })
      .withMessage('new_password must be at least 8 chars and include upper, lower, number, and symbol'),
  ],
  handleValidation,
  resetEmployeePassword
);

router.patch(
  '/employees/:id/toggle-status',
  [param('id').isUUID().withMessage('id must be a valid UUID')],
  handleValidation,
  toggleEmployeeStatus
);

module.exports = router;
