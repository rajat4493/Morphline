import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Morphline — Automation Evolution",
  description: "Determine, migrate, and remember the right target state for every automation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-line bg-white">
            <div className="mx-auto max-w-7xl px-6 h-14 flex items-center justify-between">
              <Link href="/" className="font-semibold tracking-tight text-ink">
                Morphline
              </Link>
              <span className="text-xs text-subtle">Automation Evolution Platform · Personal V0</span>
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
