const express = require('express');
const { body } = require('express-validator');
const { changeOwnPassword } = require('../controllers/accountController');
const { protect } = require('../middlewares/authMiddleware');
const { handleValidation } = require('../middlewares/validationMiddleware');
const { passwordChangeLimiter } = require('../middlewares/rateLimiters');

const router = express.Router();

function strongPasswordValidation(fieldName) {
  return body(fieldName)
    .isStrongPassword({
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1,
    })
    .withMessage(`${fieldName} must be at least 8 chars and include upper, lower, number, and symbol`)
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
        /(.)\1{2,}/,
        /1234/,
        /abcd/i,
      ];

      if (commonPatterns.some((pattern) => pattern.test(value))) {
        throw new Error('Password is too common or contains repeated patterns');
      }

      const hasSequential = /(.)\1\1|123|234|345|456|567|678|789|abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz/i.test(value);
      if (hasSequential) {
        throw new Error('Password cannot contain sequential characters');
      }

      return true;
    });
}

router.use(protect, passwordChangeLimiter);

router.patch(
  '/password',
  [
    body('current_password').notEmpty().withMessage('current_password is required'),
    strongPasswordValidation('new_password'),
    body('new_password')
      .custom((value, { req }) => value !== req.body.current_password)
      .withMessage('new_password must be different from current_password'),
  ],
  handleValidation,
  changeOwnPassword
);

module.exports = router;
