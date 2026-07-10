const paths: Record<string, string> = {
  dashboard: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
  branch: "M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6",
  pin: "M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z",
  customers: "M9 8a3.2 3.2 0 1 0 0-.01M3 20c0-3.3 3-5.2 6-5.2s6 1.9 6 5.2M16 6.2A2.8 2.8 0 1 1 16 12M21 20c0-2.3-1.6-3.9-3.5-4.3",
  cart: "M2 3h3l2.5 12.5A2 2 0 0 0 9.5 17H17a2 2 0 0 0 2-1.6L21 7H6",
  book: "M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2zM5 4v16M9 8h6M9 12h6",
  reports: "M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8",
  settings: "M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2",
  sales: "M4 6h16l-1.5 11.5A2 2 0 0 1 16.5 19h-9a2 2 0 0 1-2-1.5zM9 9V6a3 3 0 0 1 6 0v3",
  bill: "M6 2h9l3 3v15l-2.5-1.5L13 20l-2.5-1.5L8 20l-2-1.5V2zM9 8h6M9 12h6",
  bell: "M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 0 0 4 0",
  day: "M3 4h18v17H3zM3 9h18M8 2v4M16 2v4",
  menu: "M4 6h16M4 12h16M4 18h16",
};

export function Icon({ name, size = 19 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {(paths[name] || "").split("M").filter(Boolean).map((d, i) => <path key={i} d={"M" + d} />)}
    </svg>
  );
}
