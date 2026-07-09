import React from "react";
import { T, F } from "../../config/theme";

interface Props { children: React.ReactNode; name?: string; }
interface State { hasError: boolean; error?: Error; }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name}]`, error, info);
    // Report to Sentry when monitoring is configured (lazy — no-op otherwise)
    if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
      import("@sentry/react")
        .then(S => S.captureException(error, { tags: { boundary: this.props.name || "root" } }))
        .catch(() => {});
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "40px 24px", textAlign: "center", animation: "fadeUp .3s ease both" }}>
          <p style={{ fontFamily: F.sans, fontSize: 32, margin: "0 0 16px" }}>✦</p>
          <p style={{ fontFamily: F.serif, fontSize: 22, fontStyle: "italic", color: T.esp, margin: "0 0 8px" }}>
            Something went wrong
          </p>
          <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: "0 0 24px", lineHeight: 1.6 }}>
            {this.props.name ? `The ${this.props.name} screen` : "This screen"} hit an unexpected error.
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{ background: T.esp, color: "#fff", border: "none", borderRadius: 14, padding: "12px 24px", fontFamily: F.sans, fontSize: 14, fontWeight: 600, cursor: "pointer", minHeight: 44 }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
