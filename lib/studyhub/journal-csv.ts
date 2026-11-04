type Cell = string | number | null;

export function buildCsv(rows: Cell[][]) {
  const escape = (value: Cell) => {
    let text = String(value ?? '');

    if (typeof value === 'string' && /^\s*[=+\-@]/.test(text)) {
      text = "'" + text;
    }

    return '"' + text.replaceAll('"', '""') + '"';
  };

  return '\uFEFF' + rows.map((row) => row.map(escape).join(';')).join('\r\n');
}

export function downloadCsv(filename: string, rows: Cell[][]) {
  const blob = new Blob([buildCsv(rows)], {
    type: 'text/csv;charset=utf-8;',
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
