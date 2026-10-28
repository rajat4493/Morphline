import { SearchX } from "lucide-react";
import Link from "next/link";
export default function NotFound() { return <div className="panel empty"><span className="empty-ico"><SearchX size={22} aria-hidden /></span><h2>Not found</h2><p>That page or record does not exist in this workspace.</p><Link className="btn secondary" href="/">Back to overview</Link></div>; }
