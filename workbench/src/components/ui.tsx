import Link from "next/link";
import { RECOMMENDATION_LABEL, type Recommendation } from "@/assessment/types";

export const RecBadge = ({ rec }: { rec: string }) => <span className={`badge b-${rec}`}>{RECOMMENDATION_LABEL[rec as Recommendation] ?? rec}</span>;
export const Health = ({ rate, jobs }: { rate: number; jobs: number }) =>
  jobs === 0 ? <span className="badge b-warn">No runs</span> : rate >= 0.25 ? <span className="badge b-bad">Failing {(rate * 100).toFixed(0)}%</span> : rate >= 0.08 ? <span className="badge b-warn">Degraded {(rate * 100).toFixed(0)}%</span> : <span className="badge b-ok">Healthy {(rate * 100).toFixed(1)}%</span>;
export const Stat = ({ n, label }: { n: string | number; label: string }) => <div className="card stat"><div className="n">{n}</div><div className="l">{label}</div></div>;
export const Empty = ({ title, children }: { title: string; children?: React.ReactNode }) => <div className="card empty"><h2>{title}</h2><p>{children}</p></div>;
export const ago = (d: Date | null) => (d ? `${Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400_000))}d ago` : "none in window");
export const ProcessLink = ({ id, name }: { id: string; name: string }) => <Link href={`/processes/${id}`}>{name}</Link>;
