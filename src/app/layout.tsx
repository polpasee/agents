import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Agent Monitor",
  description: "Real-time monitoring dashboard for Claude agents and sub-agents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: Chrome extensions (Google Cast injects
    // __gcrremoteframetoken; Grammarly, dark-reader, etc. inject class
    // changes) mutate <html>/<body> before React hydrates. Our own markup
    // is correct — the suppression silences a noisy false-positive.
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
