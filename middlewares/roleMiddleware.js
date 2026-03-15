const { sendError } = require('../utils/responseHelper');

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, 'Authentication required', 401);
    }

    if (!req.user.is_active) {
      return sendError(res, 'Your account is inactive', 403);
    }

    if (!roles.includes(req.user.role)) {
      return sendError(res, 'You do not have permission to perform this action', 403);
    }

    return next();
  };
}

const requireAdmin = allowRoles('admin');

module.exports = {
  allowRoles,
  requireAdmin,
};

