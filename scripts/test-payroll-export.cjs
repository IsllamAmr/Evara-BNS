// Payroll workbook: layout of the company template, live formulas, inputs and validation.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { buildPayrollWorkbook } = require('../services/payrollExportService');

function unzip(buffer) {
  const files = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.slice(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    const data = buffer.slice(start, start + size);
    files[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    offset = start + size;
  }
  return files;
}

const employees = [
  { name: 'Abdullah Daker', hoursWorked: 150.5, notes: 'Present 19/22 days · Late 2' },
  { name: 'Islam Amr', hoursWorked: 180, notes: 'Present 22/22 days' },
  { name: 'Nora <khaled> & co', hoursWorked: 0, notes: '' },
];
const { buffer, fileName } = buildPayrollWorkbook({ month: '2026-09', requiredHours: 176, employees });
assert.strictEqual(fileName, 'Evara Payroll - Sep 2026.xlsx');
const sheet = unzip(buffer)['xl/worksheets/sheet1.xml'];
const styles = unzip(buffer)['xl/styles.xml'];

assert.match(sheet, /<c r="D4"[^>]*><v>176<\/v>/, 'required hours input');
assert.match(sheet, /<c r="C8"[^>]*><f>\$D\$4<\/f>/, 'row required hours follow D4');
assert.match(sheet, /<c r="D8"[^>]*><v>150.5<\/v>/, 'hours worked filled');
assert.match(sheet, /<c r="E8"[^>]*><f>IF\(OR\(C8=&quot;&quot;,C8=0,D8=&quot;&quot;\),0,D8\/C8\)<\/f><v>0.8551<\/v>/, 'percentage formula with cached value');
assert.match(sheet, /<c r="G10"[^>]*><f>ROUND\(F10\*E10,0\)<\/f>/, 'salary due formula');
assert.match(sheet, /<c r="E11"[^>]*><f>IF\(C11=0,0,D11\/C11\)<\/f>/, 'total row gives overall percentage');
assert.match(sheet, /<c r="G11"[^>]*><f>SUM\(G8:G10\)<\/f>/, 'salary total');
assert.match(sheet, /Nora &lt;khaled&gt; &amp; co/, 'names are escaped');
assert.match(sheet, /<conditionalFormatting sqref="E8:E10">.*lessThan.*greaterThanOrEqual/, 'percentage colouring');
assert.match(sheet, /<dataValidation [^>]*sqref="C8:D10"/, 'hours validation');
assert.match(styles, /<dxfs count="2">/, 'conditional styles registered');

assert.throws(() => buildPayrollWorkbook({ month: '2026-13', requiredHours: 1, employees }), /YYYY-MM/);
assert.throws(() => buildPayrollWorkbook({ month: '2026-09', requiredHours: 1, employees: [] }), /no employees/);

if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), buffer);
console.log('Payroll export: template layout, live formulas, totals, colouring, validation and escaping passed.');
