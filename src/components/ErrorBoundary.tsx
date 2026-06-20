"use client";

import { Component } from "react";
import { UI } from "@/lib/colors";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

/** After this many retries we stop offering "Try Again" and ask for a reload —
 *  guards against an infinite loop when the same render throws immediately. */
const MAX_RETRIES = 3;

/** Catches React rendering errors and displays a recovery UI instead of crashing. */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            padding: 32,
            background: "var(--color-bg)",
            color: UI.text.secondary,
            fontFamily: "monospace",
          }}
        >
          <div
            style={{
              color: UI.error,
              fontSize: 18,
              fontWeight: "bold",
              marginBottom: 12,
            }}
          >
            Something went wrong
          </div>
          <div
            style={{
              color: UI.text.muted,
              fontSize: 13,
              maxWidth: 500,
              textAlign: "center",
              marginBottom: 16,
            }}
          >
            {this.state.error?.message || "An unexpected error occurred"}
          </div>
          {this.state.retryCount >= MAX_RETRIES ? (
            <div
              style={{
                color: UI.text.muted,
                fontSize: 13,
                textAlign: "center",
              }}
            >
              Repeated errors — reload the page
            </div>
          ) : (
            <button
              onClick={() =>
                this.setState((prev) => ({
                  hasError: false,
                  error: null,
                  retryCount: prev.retryCount + 1,
                }))
              }
              style={{
                background: "var(--color-panel)",
                border: `1px solid ${UI.primary}44`,
                color: UI.primary,
                padding: "8px 16px",
                borderRadius: 4,
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 13,
              }}
            >
              Try Again
            </button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
