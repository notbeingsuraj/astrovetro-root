/* -------------------------------------------------------------------------
   CSV export helpers
   -------------------------------------------------------------------------

   Two jobs, both easy to get wrong:

   1. Quoting, so a product name containing a comma, a quote or a newline does
      not silently shift every later column in a spreadsheet.

   2. Formula injection. A spreadsheet treats a cell starting with =, +, - or @
      as a formula, so a product called `=HYPERLINK("http://evil","click")`
      becomes a live formula when an administrator opens the export. Prefixing
      those cells with an apostrophe keeps them as text — the same defence
      OWASP recommends for untrusted spreadsheet output. The check runs BEFORE
      quoting so the guard character is inside the quotes.
   ------------------------------------------------------------------------- */

/** One spreadsheet-safe cell. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Build a CSV document.
 *
 * @param {Array<{ key: string, label: string, value?: (row: any) => any }>} columns
 * @param {Array<object>} rows
 * @returns {string} CSV text (CRLF line endings, which spreadsheets prefer)
 */
export function buildCsv(columns, rows) {
  const header = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((row) =>
    columns.map((c) => csvCell(c.value ? c.value(row) : row[c.key])).join(',')
  );
  return [header, ...body].join('\r\n');
}

/** Send a CSV download with a filename that survives every browser. */
export function sendCsv(res, filename, text) {
  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '-');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  /* A BOM makes Excel on Windows read it as UTF-8 rather than the local
     codepage, which otherwise mangles £/₹/accents in product names. */
  return res.send(`\uFEFF${text}`);
}
