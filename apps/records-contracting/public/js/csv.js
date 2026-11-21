// CSV downloads for auditors who work in spreadsheets. Built in the browser from API data.

// Spreadsheet programs run cells that start with these characters as formulas.
const formulaStart = /^[=+\-@\t\r]/;

function cell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (formulaStart.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// columns: [{ header, value(row) }]
export function toCsv(columns, rows) {
  const lines = [columns.map(column => cell(column.header)).join(',')];
  for (const row of rows) lines.push(columns.map(column => cell(column.value(row))).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  // The byte order mark makes spreadsheet programs read the file as UTF-8.
  const url = URL.createObjectURL(new Blob([type.startsWith('text/csv') ? '﻿' : '', text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const today = () => new Date().toISOString().slice(0, 10);
