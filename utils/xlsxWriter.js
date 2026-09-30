// Minimal, dependency-free .xlsx writer (Office Open XML in a ZIP container).
// Supports: several sheets, strings, numbers, formulas with cached values,
// merged cells, column widths, row heights, and a small style model
// (font bold/size/color, fill, border, alignment, number format).
const zlib = require('zlib');

// ---------------------------------------------------------------- ZIP ----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | (Math.floor(date.getSeconds() / 2) & 0x1F);
  const day = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0x0F) << 5) | (date.getDate() & 0x1F);
  return { time, day };
}

function createZip(files, now = new Date()) {
  const { time, day } = dosDateTime(now);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 6 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

// ---------------------------------------------------------------- XML ----
function escapeXml(value) {
  return String(value ?? '')
    // Characters that are illegal in XML 1.0 are dropped.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnName(index) {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function cellRef(rowIndex, columnIndex) {
  return `${columnName(columnIndex)}${rowIndex + 1}`;
}

// ------------------------------------------------------------- Styles ----
function createStyleRegistry() {
  const fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  const numFmts = [];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const xfIndex = new Map([['{}', 0]]);

  function indexOf(list, xml) {
    const found = list.indexOf(xml);
    if (found >= 0) return found;
    list.push(xml);
    return list.length - 1;
  }

  function numFmtId(code) {
    const builtIn = { General: 0, '0': 1, '0.00': 2, '0%': 9, '0.00%': 10 };
    if (code in builtIn) return builtIn[code];
    const existing = numFmts.find((item) => item.code === code);
    if (existing) return existing.id;
    const id = 164 + numFmts.length;
    numFmts.push({ id, code });
    return id;
  }

  function register(style = {}) {
    const key = JSON.stringify(style);
    if (xfIndex.has(key)) return xfIndex.get(key);

    const fontXml = `<font>${style.bold ? '<b/>' : ''}${style.italic ? '<i/>' : ''}<sz val="${style.size || 11}"/>${style.color ? `<color rgb="${style.color}"/>` : ''}<name val="${escapeXml(style.font || 'Calibri')}"/><family val="2"/></font>`;
    const fontId = indexOf(fonts, fontXml);
    const fillId = style.fill
      ? indexOf(fills, `<fill><patternFill patternType="solid"><fgColor rgb="${style.fill}"/><bgColor indexed="64"/></patternFill></fill>`)
      : 0;
    const borderId = style.border
      ? indexOf(borders, '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>')
      : 0;
    const formatId = numFmtId(style.numFmt || 'General');
    const align = style.align || {};
    const alignmentXml = (align.h || align.v || align.wrap || align.readingOrder)
      ? `<alignment${align.h ? ` horizontal="${align.h}"` : ''}${align.v ? ` vertical="${align.v}"` : ''}${align.wrap ? ' wrapText="1"' : ''}${align.readingOrder ? ` readingOrder="${align.readingOrder}"` : ''}/>`
      : '';

    const xf = `<xf numFmtId="${formatId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"`
      + `${formatId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}${fillId ? ' applyFill="1"' : ''}${borderId ? ' applyBorder="1"' : ''}`
      + `${alignmentXml ? ` applyAlignment="1">${alignmentXml}</xf>` : '/>'}`;
    xfs.push(xf);
    const index = xfs.length - 1;
    xfIndex.set(key, index);
    return index;
  }

  function toXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((item) => `<numFmt numFmtId="${item.id}" formatCode="${escapeXml(item.code)}"/>`).join('')}</numFmts>` : '')
      + `<fonts count="${fonts.length}">${fonts.join('')}</fonts>`
      + `<fills count="${fills.length}">${fills.join('')}</fills>`
      + `<borders count="${borders.length}">${borders.join('')}</borders>`
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '</styleSheet>';
  }

  return { register, toXml };
}

// ------------------------------------------------------------- Sheets ----
function sanitizeSheetName(name, used) {
  let base = String(name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${counter})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    counter += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function cellXml(ref, cell, styles) {
  if (cell === null || cell === undefined) return '';
  const normalized = (typeof cell === 'object' && !(cell instanceof Date)) ? cell : { value: cell };
  const styleId = normalized.style ? styles.register(normalized.style) : 0;
  const styleAttr = styleId ? ` s="${styleId}"` : '';
  const { value, formula } = normalized;

  if (formula) {
    const formulaXml = `<f>${escapeXml(String(formula).replace(/^=/, ''))}</f>`;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `<c r="${ref}"${styleAttr}>${formulaXml}<v>${value}</v></c>`;
    }
    if (value === null || value === undefined || value === '') {
      return `<c r="${ref}"${styleAttr} t="str">${formulaXml}<v></v></c>`;
    }
    return `<c r="${ref}"${styleAttr} t="str">${formulaXml}<v>${escapeXml(value)}</v></c>`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
  }

  if (typeof value === 'boolean') {
    return `<c r="${ref}"${styleAttr} t="b"><v>${value ? 1 : 0}</v></c>`;
  }

  if (value === null || value === undefined || value === '') {
    return styleId ? `<c r="${ref}"${styleAttr}/>` : '';
  }

  const text = String(value);
  const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t${preserve}>${escapeXml(text)}</t></is></c>`;
}

function sheetXml(sheet, styles) {
  const columns = sheet.columns || [];
  const colsXml = columns.length
    ? `<cols>${columns.map((col, index) => (col && col.width ? `<col min="${index + 1}" max="${index + 1}" width="${col.width}" customWidth="1"/>` : '')).join('')}</cols>`
    : '';
  const rows = sheet.rows || [];
  const rowsXml = rows.map((row, rowIndex) => {
    if (!row) return '';
    const cells = Array.isArray(row) ? row : row.cells || [];
    const height = !Array.isArray(row) && row.height ? ` ht="${row.height}" customHeight="1"` : '';
    const cellsXml = cells.map((cell, columnIndex) => cellXml(cellRef(rowIndex, columnIndex), cell, styles)).join('');
    if (!cellsXml && !height) return '';
    return `<row r="${rowIndex + 1}"${height}>${cellsXml}</row>`;
  }).join('');
  const merges = sheet.merges || [];
  const mergesXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : '';
  const view = sheet.freeze
    ? `<sheetView workbookViewId="0"${sheet.rightToLeft ? ' rightToLeft="1"' : ''}><pane ySplit="${sheet.freeze.rows}" topLeftCell="A${sheet.freeze.rows + 1}" activePane="bottomLeft" state="frozen"/></sheetView>`
    : `<sheetView workbookViewId="0"${sheet.rightToLeft ? ' rightToLeft="1"' : ''}/>`;
  const printSetup = sheet.landscape
    ? '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0" fitToWidth="1"/>'
    : '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>';

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + (sheet.landscape ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '')
    + `<sheetViews>${view}</sheetViews>`
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + colsXml
    + `<sheetData>${rowsXml}</sheetData>`
    + mergesXml
    + printSetup
    + '</worksheet>';
}

/**
 * Build an .xlsx file.
 * @param {{ sheets: Array<{name: string, columns?: Array<{width:number}>, rows: Array, merges?: string[], freeze?: {rows:number}, landscape?: boolean}>, creator?: string }} workbook
 * @returns {Buffer}
 */
function buildXlsx(workbook) {
  const sheets = workbook.sheets && workbook.sheets.length ? workbook.sheets : [{ name: 'Sheet1', rows: [] }];
  const styles = createStyleRegistry();
  const usedNames = new Set();
  const names = sheets.map((sheet) => sanitizeSheetName(sheet.name, usedNames));
  const sheetFiles = sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(sheet, styles) }));
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const files = [
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + sheets.map((_sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        + '</Types>',
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        + '</Relationships>',
    },
    {
      name: 'docProps/core.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        + `<dc:creator>${escapeXml(workbook.creator || 'EVARA BNS')}</dc:creator>`
        + `<dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created>`
        + `<dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified>`
        + '</cp:coreProperties>',
    },
    {
      name: 'docProps/app.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>EVARA BNS</Application></Properties>',
    },
    {
      name: 'xl/workbook.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="15000" activeTab="' + (sheets.length - 1) + '"/></bookViews>'
        + `<sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>`
        + '<calcPr calcId="191029" fullCalcOnLoad="1"/>'
        + '</workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + sheets.map((_sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')
        + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
        + '</Relationships>',
    },
    ...sheetFiles,
  ];

  // styles.xml must be generated after every sheet registered its styles.
  files.push({ name: 'xl/styles.xml', data: styles.toXml() });
  return createZip(files);
}

module.exports = {
  buildXlsx,
  cellRef,
  columnName,
  crc32,
  escapeXml,
};
