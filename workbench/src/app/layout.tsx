import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = { title: "Morphline Workbench", description: "RPA to agentic migration assessment (read-only)" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body>
      <a className="skip" href="#main">Skip to content</a>
      <header className="top"><div className="in"><strong>Morphline Workbench</strong><Nav /><span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>Read-only assessment · no changes are made to Orchestrator</span></div></header>
      <main id="main">{children}</main>
    </body></html>
  );
}
