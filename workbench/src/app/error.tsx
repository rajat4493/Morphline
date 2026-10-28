"use client";
import { TriangleAlert } from "lucide-react";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <div className="panel empty" role="alert"><span className="empty-ico"><TriangleAlert size={22} aria-hidden /></span><h2>This page could not be loaded</h2><p>Details are in the server log. Nothing was changed in Orchestrator.</p><button className="btn" onClick={reset}>Try again</button></div>;
}
