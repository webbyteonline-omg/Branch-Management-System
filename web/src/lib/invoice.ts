import type { Bill, Settings } from "./types";
import { money } from "./format";

export interface InvoiceLine {
  name: string; qty: number; price: number;
  discountType?: "percent" | "flat"; discountValue?: number; discount?: number;
}

const lineDiscAmt = (l: InvoiceLine) => {
  const gross = l.qty * l.price;
  const dType = l.discountType ?? (l.discount ? "percent" : undefined);
  const dValue = l.discountValue ?? l.discount ?? 0;
  return dType === "flat" ? Math.min(gross, dValue) : gross * dValue / 100;
};
const lineNet = (l: InvoiceLine) => Math.max(0, l.qty * l.price - lineDiscAmt(l));

/** Itemized POS invoice (multi-product bill) — print / save-as-PDF.
 *  Simple bill only (no GST). Shows paid/due breakdown when the bill wasn't
 *  fully paid at billing time. */
export function printItemizedBill(
  billNo: string, lines: InvoiceLine[], customer: string,
  paymentMode: string, settings: Settings | undefined, branchName: string,
  paidAmount?: number,
) {
  const co = settings?.company || "My Shop";
  const when = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const total = lines.reduce((a, l) => a + lineNet(l), 0);
  const anyDisc = lines.some((l) => lineDiscAmt(l) > 0);
  const discFor = (l: InvoiceLine) => {
    const amt = lineDiscAmt(l);
    if (!amt) return "-";
    const dType = l.discountType ?? (l.discount ? "percent" : undefined);
    return dType === "flat" ? money(amt) : `${l.discountValue ?? l.discount}%`;
  };
  const rows = lines.map((l) => `<tr><td>${escapeHtml(l.name)}</td><td style="text-align:center">${l.qty}</td><td style="text-align:right">${money(l.price)}</td>${anyDisc ? `<td style="text-align:right">${discFor(l)}</td>` : ""}<td style="text-align:right">${money(lineNet(l))}</td></tr>`).join("");

  const paid = paidAmount === undefined ? total : Math.min(total, Math.max(0, paidAmount));
  const due = Math.max(0, total - paid);
  const paymentBlock = due > 0
    ? `<div class="meta"><span>Paid (${escapeHtml(paymentMode.toUpperCase())})</span><span>${money(paid)}</span></div><div class="meta due"><span>Balance due</span><span>${money(due)}</span></div>`
    : `<div class="meta"><span>Payment</span><span>${escapeHtml(paymentMode.toUpperCase())} — PAID IN FULL</span></div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${billNo}</title>
  <style>
    *{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}
    body{max-width:440px;margin:0 auto;padding:22px}
    h1{font-size:20px;margin:0}.muted{color:#64748b;font-size:12px}
    .hd{border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;margin-top:6px;font-size:13px}
    th{text-align:left;border-bottom:1px solid #cbd5e1;padding:6px 0;font-size:11px;color:#64748b;text-transform:uppercase}
    td{padding:7px 0;border-bottom:1px solid #eef1f6}
    .tot{display:flex;justify-content:space-between;font-weight:700;font-size:17px;border-top:2px solid #0f172a;margin-top:8px;padding-top:10px}
    .meta{display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin-top:4px}
    .meta.due{color:#dc2626;font-weight:700;font-size:13px}
    .foot{margin-top:20px;text-align:center;color:#64748b;font-size:12px}
    @media print{button{display:none}}
  </style></head><body>
    <div class="hd"><h1>${escapeHtml(co)}</h1>
      <div class="muted">${settings?.address ? escapeHtml(settings.address) + " · " : ""}${escapeHtml(settings?.phone || "")}</div>
      ${settings?.gstin ? `<div class="muted">GSTIN: ${escapeHtml(settings.gstin)}</div>` : ""}
      <div class="muted">${escapeHtml(branchName)}</div>
    </div>
    <div class="meta"><span>Bill: <b>${billNo}</b></span><span>${when}</span></div>
    <div class="meta"><span>Customer: <b>${escapeHtml(customer)}</b></span></div>
    <table><thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th>${anyDisc ? `<th style="text-align:right">Disc</th>` : ""}<th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="tot"><span>Total</span><span>${money(total)}</span></div>
    ${paymentBlock}
    <div class="foot">${escapeHtml(settings?.footer || "Thank you for your business!")}</div>
    <div style="text-align:center;margin-top:18px"><button onclick="window.print()" style="padding:10px 22px;border:none;border-radius:8px;background:#4f46e5;color:#fff;font-weight:600">Print / Save PDF</button></div>
    <script>window.onload=()=>setTimeout(()=>window.print(),350)</script>
  </body></html>`;
  openPrint(html);
}

function escapeHtml(s: string) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }
function openPrint(html: string) {
  const w = window.open("", "_blank", "width=460,height=720");
  if (!w) return;
  w.document.write(html); w.document.close();
}

/** Opens a clean printable invoice/receipt in a new window and triggers print.
 *  Works on phone and laptop (browser's built-in print / save-as-PDF). */
export function printInvoice(bill: Bill, settings: Settings | undefined, branchName: string) {
  const co = settings?.company || "My Shop";
  const when = new Date(bill.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Invoice</title>
  <style>
    *{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}
    body{max-width:420px;margin:0 auto;padding:24px}
    h1{font-size:20px;margin:0}
    .muted{color:#64748b;font-size:12px}
    .row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #eef1f6;font-size:14px}
    .tot{font-weight:700;font-size:16px;border-top:2px solid #0f172a;margin-top:6px;padding-top:10px}
    .due{color:#dc2626}.paid{color:#059669}
    .hd{border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:14px}
    .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700}
    .foot{margin-top:22px;text-align:center;color:#64748b;font-size:12px}
    @media print{button{display:none}}
  </style></head><body>
    <div class="hd">
      <h1>${co}</h1>
      <div class="muted">${settings?.address ? settings.address + " · " : ""}${settings?.phone || ""}</div>
      ${settings?.gstin ? `<div class="muted">GSTIN: ${settings.gstin}</div>` : ""}
      <div class="muted">${branchName}</div>
    </div>
    <div class="row"><span>Invoice for</span><b>${bill.customer_name}</b></div>
    <div class="row"><span>Date</span><span>${when}</span></div>
    <div class="row"><span>Status</span><span class="badge ${bill.status === "paid" ? "paid" : "due"}">${bill.status.toUpperCase()}</span></div>
    <div class="row"><span>Bill amount</span><span>${money(bill.amount)}</span></div>
    <div class="row"><span>Paid</span><span class="paid">${money(bill.paid)}</span></div>
    <div class="row tot"><span>Balance due</span><span class="${bill.due_amount > 0 ? "due" : "paid"}">${money(bill.due_amount)}</span></div>
    <div class="foot">${settings?.footer || "Thank you for your business!"}</div>
    <div style="text-align:center;margin-top:18px"><button onclick="window.print()" style="padding:10px 22px;border:none;border-radius:8px;background:#4f46e5;color:#fff;font-weight:600">Print / Save PDF</button></div>
    <script>window.onload=()=>setTimeout(()=>window.print(),350)</script>
  </body></html>`;
  const w = window.open("", "_blank", "width=460,height=680");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
