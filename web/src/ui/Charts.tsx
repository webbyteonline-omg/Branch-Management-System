import { money } from "../lib/format";

/** Simple, dependency-free bar chart (responsive, flex-based). */
export function BarChart({ data, color = "var(--accent)", height = 150 }: {
  data: { label: string; value: number; sub?: string }[]; color?: string; height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height }}>
        {data.map((d, i) => (
          <div key={i} title={`${d.label}: ${money(d.value)}`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
            <div style={{ height: `${(d.value / max) * 100}%`, background: d.value ? color : "var(--line)", borderRadius: "5px 5px 2px 2px", minHeight: 3, transition: "height .3s" }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden" }}>
            {i % Math.ceil(data.length / 7) === 0 ? d.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal breakdown bars (e.g. payment split). */
export function Breakdown({ rows }: { rows: { label: string; value: number; color: string }[] }) {
  const total = Math.max(1, rows.reduce((a, r) => a + r.value, 0));
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
            <span style={{ color: "var(--muted)" }}>{r.label}</span>
            <b>{money(r.value)} · {Math.round(r.value / total * 100)}%</b>
          </div>
          <div style={{ height: 9, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(r.value / total * 100).toFixed(0)}%`, background: r.color, borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Donut chart (SVG) for a small categorical split. */
export function Donut({ rows, size = 150 }: { rows: { label: string; value: number; color: string }[]; size?: number }) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const r = size / 2 - 12, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={14} />
        {total > 0 && rows.map((row, i) => {
          const frac = row.value / total;
          const dash = frac * C;
          const el = <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={row.color} strokeWidth={14}
            strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-offset} transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="butt" />;
          offset += dash;
          return el;
        })}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="15" fontWeight="700" fill="var(--text)">{money(total)}</text>
      </svg>
      <div>
        {rows.map((row) => (
          <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: row.color }} />
            <span style={{ color: "var(--muted)" }}>{row.label}</span>
            <b style={{ marginLeft: "auto" }}>{money(row.value)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
