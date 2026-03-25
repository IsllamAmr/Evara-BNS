const asyncHandler = require('../utils/asyncHandler');
const requestService = require('../services/requestService');
const { sendSuccess } = require('../utils/responseHelper');

const listRequests = asyncHandler(async (req, res) => {
  const items = await requestService.listRequests(req.user, req.query);

  return sendSuccess(res, {
    data: {
      items,
    },
  });
});

const createRequest = asyncHandler(async (req, res) => {
  const result = await requestService.createRequest(req.body, req.user);

  return sendSuccess(
    res,
    {
      message: 'Request submitted successfully',
      data: result,
    },
    201
  );
});

const getAllowanceSummary = asyncHandler(async (req, res) => {
  const allowance = await requestService.getAllowanceSummary(req.user, req.query);

  return sendSuccess(res, {
    data: allowance,
  });
});

const updateRequestStatus = asyncHandler(async (req, res) => {
  const result = await requestService.updateRequestStatus(req.params.id, req.body, req.user);

  return sendSuccess(res, {
    message: 'Request status updated successfully',
    data: result,
  });
});

module.exports = {
  createRequest,
  getAllowanceSummary,
  listRequests,
  updateRequestStatus,
};
