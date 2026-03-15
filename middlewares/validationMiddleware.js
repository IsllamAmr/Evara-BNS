const { validationResult } = require('express-validator');
const { sendError } = require('../utils/responseHelper');

function handleValidation(req, res, next) {
  const result = validationResult(req);

  if (result.isEmpty()) {
    return next();
  }

  return sendError(res, 'Validation failed', 422, {
    errors: result.array().map((item) => ({
      field: item.path,
      message: item.msg,
    })),
  });
}

module.exports = {
  handleValidation,
};
