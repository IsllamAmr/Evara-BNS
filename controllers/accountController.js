const asyncHandler = require('../utils/asyncHandler');
const accountService = require('../services/accountService');
const { sendSuccess } = require('../utils/responseHelper');

const changeOwnPassword = asyncHandler(async (req, res) => {
  const result = await accountService.changeOwnPassword({
    supabase: req.supabase,
    actorProfile: req.user,
    currentPassword: req.body.current_password,
    newPassword: req.body.new_password,
  });

  return sendSuccess(res, {
    message: 'Password updated successfully',
    data: result,
  });
});

module.exports = {
  changeOwnPassword,
};

