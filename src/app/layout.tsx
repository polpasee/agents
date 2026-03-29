import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="antialiased">
        <a href="#main-content" className="skip-link">Skip to main content</a>
        {children}
      </body>
    </html>
  );
}
