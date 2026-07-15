// Shown while auth/profile is resolving on app open — replaces the old
// plain "Loading…" text (and the brief Login-page flash before it existed).
// Deliberately mirrors the PWA manifest's background_color so there's no
// visible seam between the OS splash and this one.
export function SplashScreen() {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 18, background: "var(--bg)",
    }}>
      <div className="splash-logo">
        <svg width="72" height="72" viewBox="0 0 512 512">
          <rect width="512" height="512" rx="96" fill="#4f46e5" />
          <path d="M128 340V220l128-84 128 84v120a16 16 0 0 1-16 16h-72v-96h-80v96h-72a16 16 0 0 1-16-16z" fill="#ffffff" />
          <circle cx="256" cy="150" r="26" fill="#c7d2fe" />
        </svg>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", letterSpacing: "-.2px" }}>BranchManager</div>
      <div className="splash-dots"><span /><span /><span /></div>
    </div>
  );
}
