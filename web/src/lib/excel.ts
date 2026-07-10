// Export data to a real Excel file (.xls) that opens directly in Microsoft
// Excel / Google Sheets — no external library needed.
export function downloadExcel(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) =>
    String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const th = headers.map((h) => `<th style="background:#4f46e5;color:#fff;padding:6px;text-align:left">${esc(h)}</th>`).join("");
  const trs = rows
    .map((r) => `<tr>${r.map((c) => `<td style="padding:5px;border:1px solid #ddd">${esc(c)}</td>`).join("")}</tr>`)
    .join("");
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/></head>
    <body><table border="1"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
  const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xls") ? filename : filename + ".xls";
  a.click();
  URL.revokeObjectURL(url);
}
