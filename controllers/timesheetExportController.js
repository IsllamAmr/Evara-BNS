const asyncHandler = require('../utils/asyncHandler');
const timesheetExportService = require('../services/timesheetExportService');
const payrollExportService = require('../services/payrollExportService');
const { sendSuccess } = require('../utils/responseHelper');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function contentDisposition(fileName) {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const getExportSummary = asyncHandler(async (req, res) => {
  const summary = await timesheetExportService.getExportSummary(req.params.id);
  return sendSuccess(res, { data: summary });
});

const exportTimesheet = asyncHandler(async (req, res) => {
  const result = await timesheetExportService.exportTimesheet(
    req.params.id,
    { from: req.body.from, to: req.body.to },
    req.user
  );

  res.set({
    'Content-Type': XLSX_MIME,
    'Content-Disposition': contentDisposition(result.fileName),
    'Content-Length': String(result.buffer.length),
    'Cache-Control': 'no-store',
    'X-Timesheet-Sheets': String(result.segments.length),
  });
  return res.status(200).send(result.buffer);
});

const exportPayroll = asyncHandler(async (req, res) => {
  const result = payrollExportService.buildPayrollWorkbook(req.body);

  res.set({
    'Content-Type': XLSX_MIME,
    'Content-Disposition': contentDisposition(result.fileName),
    'Content-Length': String(result.buffer.length),
    'Cache-Control': 'no-store',
  });
  return res.status(200).send(result.buffer);
});

module.exports = {
  exportPayroll,
  exportTimesheet,
  getExportSummary,
};
