"use client";
import { BarChart3, LayoutList, Menu, PlugZap, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const NAV: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/", label: "Overview", Icon: BarChart3 },
  { href: "/processes", label: "Estate inventory", Icon: LayoutList },
  { href: "/connectors", label: "Connectors & imports", Icon: PlugZap },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href) || (href === "/processes" && path.startsWith("/plans")));
  return (
    <nav aria-label="Main">
      <ul className="nav-list">
        {NAV.map(({ href, label, Icon }) => (
          <li key={href}><Link href={href} className="nav-link" aria-current={active(href) ? "page" : undefined} onClick={onNavigate}><Icon size={18} className="icon" aria-hidden />{label}</Link></li>
        ))}
      </ul>
    </nav>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <div className="mobilebar">
      <div className="bar">
        <Link href="/" className="brand" style={{ padding: 0 }}><span className="brand-mark"><Mark /></span>Morphline</Link>
        <button className="menu-btn" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
      </div>
      {open && <div id="mobile-nav"><SidebarNav onNavigate={() => setOpen(false)} /><div style={{ padding: "8px 12px 0" }}><ReadOnlyStatus /></div></div>}
    </div>
  );
}

export function Mark() { return <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden><path d="M6 25V8l10 10L26 8v17" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinejoin="round" strokeLinecap="round" /></svg>; }
export function ReadOnlyStatus() {
  return <div className="ro-status" role="status"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7fe0b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></svg><div><strong>Read-only mode</strong>GET requests only. Nothing is written to Orchestrator.</div></div>;
}

export type TabDef = { id: string; label: string; count?: number; icon?: React.ReactNode; panel: React.ReactNode };

/** WAI-ARIA tabs: arrow/Home/End keys, roving tabindex, #tab-<id> deep links. */
export function Tabs({ tabs, initial }: { tabs: TabDef[]; initial?: string }) {
  const [active, setActive] = useState(initial && tabs.some((t) => t.id === initial) ? initial : tabs[0].id);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const fromHash = useCallback(() => {
    const m = window.location.hash.match(/^#tab-(.+)$/);
    if (m && tabs.some((t) => t.id === m[1])) setActive(m[1]);
  }, [tabs]);
  useEffect(() => { fromHash(); window.addEventListener("hashchange", fromHash); return () => window.removeEventListener("hashchange", fromHash); }, [fromHash]);
  const select = (id: string, focus = false) => { setActive(id); history.replaceState(null, "", `#tab-${id}`); if (focus) refs.current[id]?.focus(); };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = tabs.length; let j = -1;
    if (e.key === "ArrowRight") j = (i + 1) % n; else if (e.key === "ArrowLeft") j = (i - 1 + n) % n; else if (e.key === "Home") j = 0; else if (e.key === "End") j = n - 1;
    if (j >= 0) { e.preventDefault(); select(tabs[j].id, true); }
  };
  return (
    <div className="tabs" id="tabs">
      <div role="tablist" aria-label="Process detail sections" className="tablist">
        {tabs.map((t, i) => (
          <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" id={`tab-${t.id}`} aria-selected={active === t.id} aria-controls={`panel-${t.id}`} tabIndex={active === t.id ? 0 : -1} className="tab" onClick={() => select(t.id)} onKeyDown={(e) => onKey(e, i)}>
            {t.icon}{t.label}{t.count !== undefined && <span className="badge neutral">{t.count}</span>}
          </button>
        ))}
      </div>
      {tabs.map((t) => <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={active !== t.id} className="tabpanel" tabIndex={0}>{t.panel}</div>)}
    </div>
  );
}

export function CopyLink({ label = "Copy link" }: { label?: string }) {
  const [done, setDone] = useState(false);
  return <button className="btn secondary" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href.split("#")[0]); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* clipboard unavailable */ } }}>{done ? "Link copied" : label}</button>;
}

/** Credential-type asset names stay masked until a reader explicitly reveals them. */
export function RevealName({ name }: { name: string }) {
  const [shown, setShown] = useState(false);
  return <><b>{shown ? name : `${name.slice(0, 3)}${"•".repeat(Math.max(4, Math.min(10, name.length - 3)))}`}</b><button className="reveal" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? "Hide name" : "Reveal name"}</button></>;
}
