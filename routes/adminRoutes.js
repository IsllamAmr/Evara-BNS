const express = require('express');
const { body, param } = require('express-validator');
const {
  createEmployee,
  deleteEmployee,
  resetEmployeePassword,
  toggleEmployeeStatus,
  updateEmployee,
} = require('../controllers/adminController');
const { getSettings, rotateQr, updateSettings } = require('../controllers/attendanceSettingsController');
const { exportPayroll, exportTimesheet, getExportSummary } = require('../controllers/timesheetExportController');
const { protect } = require('../middlewares/authMiddleware');
const { requireAdmin } = require('../middlewares/roleMiddleware');
const { adminWriteLimiter, employeeCreationLimiter } = require('../middlewares/rateLimiters');
const { handleValidation } = require('../middlewares/validationMiddleware');

const router = express.Router();

router.use(protect, requireAdmin, adminWriteLimiter);

router.post(
  '/employees',
  employeeCreationLimiter,
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
      .withMessage('password must be at least 8 chars and include upper, lower, number, and symbol')
      .custom((value) => {
        const commonPatterns = [
          /^password/i,
          /^123456/,
          /^qwerty/i,
          /^admin/i,
          /^user/i,
          /^login/i,
          /^welcome/i,
          /^abc123/i,
          /^111111/,
          /^000000/,
          /(.)\1{2,}/, // repeated characters
          /1234/,
          /abcd/i,
        ];

        if (commonPatterns.some(pattern => pattern.test(value))) {
          throw new Error('Password is too common or contains repeated patterns');
        }

        // Check for sequential characters
        const hasSequential = /(.)\1\1|123|234|345|456|567|678|789|abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz/i.test(value);
        if (hasSequential) {
          throw new Error('Password cannot contain sequential characters');
        }

        return true;
      }),
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

router.get('/attendance-settings', getSettings);

router.put(
  '/attendance-settings',
  [
    body('require_office_network').optional().isBoolean().withMessage('require_office_network must be true or false').toBoolean(),
    body('allowed_networks').optional().isArray({ max: 50 }).withMessage('allowed_networks must be a list of at most 50 rules'),
    body('allowed_networks.*').optional().isString().isLength({ max: 64 }).withMessage('Each network rule must be text up to 64 characters'),
  ],
  handleValidation,
  updateSettings
);

router.post('/attendance-settings/rotate-qr', rotateQr);

router.get(
  '/employees/:id/timesheet-export',
  [param('id').isUUID().withMessage('id must be a valid UUID')],
  handleValidation,
  getExportSummary
);

router.post(
  '/employees/:id/timesheet-export',
  [
    param('id').isUUID().withMessage('id must be a valid UUID'),
    body('from').isISO8601({ strict: true, strictSeparator: true }).withMessage('from must be a valid date (YYYY-MM-DD)'),
    body('to').isISO8601({ strict: true, strictSeparator: true }).withMessage('to must be a valid date (YYYY-MM-DD)'),
  ],
  handleValidation,
  exportTimesheet
);

router.post(
  '/reports/payroll-export',
  [
    body('month').matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('month must be YYYY-MM'),
    body('requiredHours').isFloat({ min: 0, max: 744 }).withMessage('requiredHours must be between 0 and 744'),
    body('employees').isArray({ min: 1, max: 300 }).withMessage('employees must be a list of 1 to 300 rows'),
    body('employees.*.name').isString().isLength({ min: 1, max: 120 }).withMessage('Each employee needs a name'),
    body('employees.*.hoursWorked').isFloat({ min: 0, max: 744 }).withMessage('hoursWorked must be between 0 and 744'),
    body('employees.*.notes').optional().isString().isLength({ max: 160 }),
  ],
  handleValidation,
  exportPayroll
);

module.exports = router;
