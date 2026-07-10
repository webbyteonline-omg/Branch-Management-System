import type { Bill, Settings } from "./types";
import { money } from "./format";

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
