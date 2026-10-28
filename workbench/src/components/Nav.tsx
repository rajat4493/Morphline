"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [["/", "Overview"], ["/processes", "Estate inventory"], ["/connectors", "Connectors & imports"]] as const;
export function Nav() {
  const path = usePathname();
  return <nav aria-label="Main">{items.map(([href, label]) => <Link key={href} href={href} aria-current={(href === "/" ? path === "/" : path.startsWith(href)) ? "page" : undefined}>{label}</Link>)}</nav>;
}
