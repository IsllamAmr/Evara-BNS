const asyncHandler = require('../utils/asyncHandler');
const adminService = require('../services/adminService');
const { sendSuccess } = require('../utils/responseHelper');

const createEmployee = asyncHandler(async (req, res) => {
  const employee = await adminService.createEmployee(req.body);

  return sendSuccess(
    res,
    {
      message: 'Employee created successfully',
      data: employee,
    },
    201
  );
});

const updateEmployee = asyncHandler(async (req, res) => {
  const employee = await adminService.updateEmployee(req.params.id, req.body, req.user);

  return sendSuccess(res, {
    message: 'Employee updated successfully',
    data: employee,
  });
});

const deleteEmployee = asyncHandler(async (req, res) => {
  await adminService.deleteEmployee(req.params.id, req.user);

  return sendSuccess(res, {
    message: 'Employee deleted successfully',
  });
});

const resetEmployeePassword = asyncHandler(async (req, res) => {
  const employee = await adminService.resetEmployeePassword(
    req.params.id,
    req.body.new_password || req.body.password
  );

  return sendSuccess(res, {
    message: 'Employee password reset successfully',
    data: employee,
  });
});

const toggleEmployeeStatus = asyncHandler(async (req, res) => {
  const employee = await adminService.toggleEmployeeStatus(req.params.id, req.user);

  return sendSuccess(res, {
    message: 'Employee status updated successfully',
    data: employee,
  });
});

module.exports = {
  createEmployee,
  deleteEmployee,
  resetEmployeePassword,
  toggleEmployeeStatus,
  updateEmployee,
};

