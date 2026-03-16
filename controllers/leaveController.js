const asyncHandler = require('../utils/asyncHandler');
const leaveService = require('../services/leaveService');
const { sendSuccess } = require('../utils/responseHelper');

const listLeaves = asyncHandler(async (req, res) => {
  const data = await leaveService.listLeaveRequests(req.user, req.query);

  return sendSuccess(res, {
    data,
  });
});

const createLeave = asyncHandler(async (req, res) => {
  const data = await leaveService.createLeaveRequest(req.body, req.user);

  return sendSuccess(
    res,
    {
      message: 'Leave request submitted successfully',
      data,
    },
    201
  );
});

const reviewLeave = asyncHandler(async (req, res) => {
  const data = await leaveService.reviewLeaveRequest(Number(req.params.id), req.body, req.user);

  return sendSuccess(res, {
    message: `Leave request ${req.body.status} successfully`,
    data,
  });
});

const cancelLeave = asyncHandler(async (req, res) => {
  const data = await leaveService.cancelLeaveRequest(Number(req.params.id), req.user);

  return sendSuccess(res, {
    message: 'Leave request cancelled successfully',
    data,
  });
});

module.exports = {
  cancelLeave,
  createLeave,
  listLeaves,
  reviewLeave,
};
