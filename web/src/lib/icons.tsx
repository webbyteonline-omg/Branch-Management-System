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
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  refresh: "M21 12a9 9 0 1 1-3-6.7M21 4v5h-5",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16z",
  check: "M20 6 9 17l-5-5",
  home: "M3 11l9-8 9 8M5 10v10h14V10M9 20v-6h6v6",
  sync: "M21 12a9 9 0 1 1-3-6.7M21 4v5h-5M3 12a9 9 0 1 1 3 6.7M3 20v-5h5",
  print: "M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z",
  creditCard: "M2 6h20v12H2zM2 10h20M6 15h4",
  splitPay: "M8 3 4 7l4 4M4 7h11a4 4 0 0 1 4 4v1M16 21l4-4-4-4M20 17H9a4 4 0 0 1-4-4v-1",
  qr: "M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM19 15h2v2h-2zM15 19h2v2h-2zM19 19h2v2h-2z",
  personSearch: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-3.3 3-5.2 6-5.2M15 15l5 5m-1-6a3 3 0 1 0-6 0 3 3 0 0 0 6 0z",
  calendar: "M3 4h18v17H3zM3 9h18M8 2v4M16 2v4",
  warning: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  filter: "M4 4h16l-6 8v6l-4 2v-8z",
  sort: "M7 4v16m0-16 4 4M7 4 3 8M17 20V4m0 16 4-4m-4 4-4-4",
  moreVert: "M12 6h.01M12 12h.01M12 18h.01",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.7a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2.1z",
  chevronDown: "M6 9l6 6 6-6",
  close: "M18 6 6 18M6 6l12 12",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  truck: "M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  lock: "M5 11h14v10H5zM7 11V7a5 5 0 0 1 10 0v4",
  addCircle: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v8M8 12h8",
  boxIcon: "M21 8 12 3 3 8l9 5 9-5zM3 8v9l9 5M21 8v9l-9 5M12 13v9",
  cloud: "M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z",
  wallet: "M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 3H4a2 2 0 0 0-2 2v2h18",
};

export function Icon({ name, size = 19 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {(paths[name] || "").split("M").filter(Boolean).map((d, i) => <path key={i} d={"M" + d} />)}
    </svg>
  );
}
