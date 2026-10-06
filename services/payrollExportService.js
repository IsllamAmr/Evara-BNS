// Monthly payroll workbook in the layout of "Evara Payroll - <Mon YYYY>.xlsx".
// Hours worked come from the reports page (same numbers the admin sees); yellow cells
// stay editable inputs and every derived value is a live Excel formula.
const { AppError } = require('../middlewares/errorMiddleware');
const { buildXlsx } = require('../utils/xlsxWriter');

// Kept well inside the 50 KB JSON body limit (about 100 bytes per row).
const MAX_EMPLOYEES = 300;
const NAVY = 'FF1F3864';
const INPUT_FILL = 'FFFFF2CC';
const BAND_FILL = 'FFF2F5FA';
const TOTAL_FILL = 'FFD9E1F2';
const HEADER_ROW = 7; // 1-based, as in the template
const FIRST_DATA_ROW = HEADER_ROW + 1;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

function toHours(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0;
}

function cleanText(value, max = 160) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function validatePayload(payload) {
  const month = String(payload?.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new AppError('month must be YYYY-MM', 422);
  }
  const employees = Array.isArray(payload?.employees) ? payload.employees : null;
  if (!employees || !employees.length) {
    throw new AppError('There are no employees in this report to export', 422);
  }
  if (employees.length > MAX_EMPLOYEES) {
    throw new AppError(`At most ${MAX_EMPLOYEES} employees can be exported at once`, 422);
  }
  const requiredHours = toHours(payload.requiredHours);
  return { month, requiredHours, employees };
}

function buildPayrollWorkbook(payload) {
  const { month, requiredHours, employees } = validatePayload(payload);
  const label = monthLabel(month);
  const lastDataRow = FIRST_DATA_ROW + employees.length - 1;
  const totalRow = lastDataRow + 1;

  const border = true;
  const title = { bold: true, size: 18, color: NAVY, align: { h: 'center', v: 'center' } };
  const label12 = { bold: true, align: { v: 'center' } };
  const input = { bold: true, color: 'FF0000FF', fill: INPUT_FILL, border, align: { h: 'center', v: 'center' } };
  const help = { color: 'FF404040', align: { v: 'top', wrap: true } };
  const header = { bold: true, color: 'FFFFFFFF', fill: NAVY, border, align: { h: 'center', v: 'center', wrap: true } };
  const total = { bold: true, color: NAVY, fill: TOTAL_FILL, border };

  const rows = [];
  rows[0] = { height: 30, cells: [{ value: 'EVARA BNS - Monthly Payroll / كشف المرتبات الشهري', style: title }] };
  rows[2] = {
    height: 21.95,
    cells: [
      { value: 'Month / الشهر', style: label12 }, null, null,
      { value: label, style: { ...input, numFmt: '@' } }, null,
      {
        value: 'How to use / طريقة الاستخدام:\n'
          + '• Yellow cells are inputs — اكتب في الخلايا الصفراء فقط\n'
          + '• Hours worked are filled from EVARA BNS attendance — ساعات العمل من نظام الحضور\n'
          + '• Percentage = Hours worked ÷ Required hours (over 100% = overtime)\n'
          + '• Salary due = Base salary × Percentage',
        style: help,
      },
    ],
  };
  rows[3] = {
    height: 21.95,
    cells: [
      { value: 'Required hours per month / الساعات المطلوبة في الشهر', style: label12 }, null, null,
      { value: requiredHours, style: { ...input, numFmt: '0' } },
    ],
  };
  rows[4] = { height: 21.95, cells: [] };
  rows[HEADER_ROW - 1] = {
    height: 36,
    cells: [
      '#', 'Employee\nالموظف', 'Required Hours\nالساعات المطلوبة', 'Hours Worked\nساعات العمل',
      'Percentage\nالنسبة %', 'Base Salary (EGP)\nالمرتب الأساسي', 'Salary Due (EGP)\nالمستحق', 'Notes\nملاحظات',
    ].map((value) => ({ value, style: header })),
  };

  // Cached results go next to each formula: Excel recalculates on open, but phone
  // previews (WhatsApp, iOS Files) only show stored values.
  const ratio = (hours) => (requiredHours ? Math.round((hours / requiredHours) * 10000) / 10000 : 0);
  const totalHours = employees.reduce((sum, employee) => sum + toHours(employee.hoursWorked), 0);

  employees.forEach((employee, index) => {
    const row = FIRST_DATA_ROW + index;
    const hours = toHours(employee.hoursWorked);
    const band = index % 2 ? { fill: BAND_FILL } : {};
    const cell = (extra = {}) => ({ border, align: { v: 'center' }, ...band, ...extra });
    rows[row - 1] = {
      height: 20.1,
      cells: [
        { value: index + 1, style: cell({ numFmt: '0', align: { h: 'center', v: 'center' } }) },
        { value: cleanText(employee.name, 120), style: cell({ numFmt: '@' }) },
        { formula: '$D$4', value: requiredHours, style: cell({ numFmt: '0.0', fill: INPUT_FILL, align: { h: 'center', v: 'center' } }) },
        { value: hours, style: cell({ numFmt: '0.0', fill: INPUT_FILL, align: { h: 'center', v: 'center' } }) },
        { formula: `IF(OR(C${row}="",C${row}=0,D${row}=""),0,D${row}/C${row})`, value: ratio(hours), style: cell({ numFmt: '0.0%', align: { h: 'center', v: 'center' } }) },
        { value: null, style: cell({ numFmt: '#,##0', fill: INPUT_FILL }) },
        { formula: `ROUND(F${row}*E${row},0)`, value: 0, style: cell({ numFmt: '#,##0', bold: true }) },
        { value: cleanText(employee.notes), style: cell({ align: { v: 'center', wrap: true } }) },
      ],
    };
  });

  // The template's total row summed the percentages and put the salary total under
  // Notes; here each column totals what it holds and the percentage is overall.
  const range = (column) => `${column}${FIRST_DATA_ROW}:${column}${lastDataRow}`;
  rows[totalRow - 1] = {
    height: 24,
    cells: [
      { value: 'Total / الإجمالي', style: total }, { value: null, style: total },
      { formula: `SUM(${range('C')})`, value: Math.round(requiredHours * employees.length * 100) / 100, style: { ...total, numFmt: '#,##0.0' } },
      { formula: `SUM(${range('D')})`, value: Math.round(totalHours * 100) / 100, style: { ...total, numFmt: '#,##0.0' } },
      { formula: `IF(C${totalRow}=0,0,D${totalRow}/C${totalRow})`, value: ratio(totalHours / employees.length), style: { ...total, numFmt: '0.0%' } },
      { formula: `SUM(${range('F')})`, value: 0, style: { ...total, numFmt: '#,##0' } },
      { formula: `SUM(${range('G')})`, value: 0, style: { ...total, numFmt: '#,##0' } },
      { value: null, style: total },
    ],
  };

  const buffer = buildXlsx({
    creator: 'EVARA BNS',
    sheets: [{
      name: label,
      columns: [{ width: 5 }, { width: 24 }, { width: 19.3 }, { width: 17 }, { width: 15 }, { width: 18 }, { width: 19 }, { width: 34 }],
      rows,
      merges: ['A1:H1', 'A3:C3', 'A4:C4', 'F3:H5', `A${totalRow}:B${totalRow}`],
      freeze: { rows: HEADER_ROW },
      landscape: true,
      conditionalFormats: [{
        ref: range('E'),
        rules: [
          { operator: 'lessThan', formula: '0.75', style: { color: 'FFC00000', bold: true } },
          { operator: 'greaterThanOrEqual', formula: '1', style: { color: 'FF00803C', bold: true } },
        ],
      }],
      dataValidations: [
        { ref: `C${FIRST_DATA_ROW}:D${lastDataRow}`, operator: 'between', formula1: '0', formula2: '744', error: 'Enter hours between 0 and 744.' },
        { ref: range('F'), operator: 'greaterThanOrEqual', formula1: '0', error: 'Salary must be a positive number.' },
      ],
    }],
  });

  return { buffer, fileName: `Evara Payroll - ${label}.xlsx` };
}

module.exports = {
  buildPayrollWorkbook,
  monthLabel,
};
