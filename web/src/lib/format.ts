import type { Range } from "./types";

export const money = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
export const timeStr = (t: string | number) =>
  new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
export const dateStr = (t: string | number) =>
  new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
export const initials = (n: string) =>
  n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

const DAY = 86400 * 1000;

export function rangeStart(r: Range): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (r === "today") return d.getTime();
  if (r === "week") return d.getTime() - 6 * DAY;
  return d.getTime() - 29 * DAY;
}
export function prevRange(r: Range): { from: number; to: number } {
  const len = r === "today" ? DAY : r === "week" ? 7 * DAY : 30 * DAY;
  const start = rangeStart(r);
  return { from: start - len, to: start };
}
export const rangeLabel = (r: Range) =>
  ({ today: "Today", week: "This Week", month: "This Month" }[r]);

export function pctDelta(now: number, prev: number) {
  if (prev === 0) return now === 0 ? { cls: "flat", txt: "No change" } : { cls: "up", txt: "New activity" };
  const p = ((now - prev) / prev) * 100;
  const cls = p > 0.5 ? "up" : p < -0.5 ? "down" : "flat";
  const arrow = p > 0.5 ? "▲" : p < -0.5 ? "▼" : "—";
  return { cls, txt: `${arrow} ${Math.abs(p).toFixed(1)}% vs prev` };
}
