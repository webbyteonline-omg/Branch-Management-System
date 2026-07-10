import { Component, type ReactNode } from "react";

// Shows the actual error on screen instead of a blank white page.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("App crashed:", error); }

  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 560, margin: "60px auto", padding: 24, fontFamily: "system-ui" }}>
          <h2 style={{ color: "#dc2626", marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: "#64748b", fontSize: 14 }}>Please share this message so it can be fixed:</p>
          <pre style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 14, whiteSpace: "pre-wrap", fontSize: 13, color: "#991b1b" }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button onClick={() => location.reload()} style={{ marginTop: 12, padding: "10px 18px", border: "none", borderRadius: 8, background: "#4f46e5", color: "#fff", fontWeight: 600 }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}
