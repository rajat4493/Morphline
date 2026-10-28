import { desc, eq } from "drizzle-orm";
import { CheckCircle2, PlugZap, Play, XCircle, ShieldCheck } from "lucide-react";
import { ActionButton, ConnectorForm, FolderPicker } from "@/components/Actions";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ds";
import * as s from "@/db/schema";
import { dt } from "@/lib/fmt";
import { getContext } from "@/lib/server";
import { connectorFolders, connectorList } from "@/services/queries";

export const dynamic = "force-dynamic";

export default async function Connectors() {
  const { db, ctx } = await getContext();
  const list = await connectorList(db, ctx);
  const runs = await db.select().from(s.importRuns).where(eq(s.importRuns.tenantId, ctx.tenantId)).orderBy(desc(s.importRuns.startedAt)).limit(15);
  const names = new Map(list.map((c) => [c.id, c.name]));
  const folderMap = new Map(await Promise.all(list.map(async (c) => [c.id, await connectorFolders(db, c.id)] as const)));
  return (
    <>
      <PageHeader title="Connectors & imports" meta={<><span><ShieldCheck size={14} aria-hidden />Read-only (GET only)</span><span>Config encrypted · tokens read from server env vars, never stored</span></>} />
      <div className="stack-l">
        {list.length === 0 && <EmptyState icon={<PlugZap size={22} />} title="No connections yet" action={<ActionButton url="/api/connectors" body={{ demo: true }} label="Create demo connection" variant="primary" />}>Create a simulated demo connection, or add a real Orchestrator below.</EmptyState>}
        {list.map((c) => {
          const folders = folderMap.get(c.id) ?? [];
          return (
            <section className="panel panel-pad" key={c.id} aria-labelledby={`c-${c.id}`}>
              <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap", alignItems: "flex-start" }}>
                <div><h2 className="panel-title" id={`c-${c.id}`} style={{ marginBottom: 4 }}>{c.name} {c.isDemo && <StatusBadge tone="amber">Simulated data</StatusBadge>}</h2>
                  <p className="muted" style={{ margin: 0 }}>{c.lastTestAt ? <>Last test {dt(c.lastTestAt)}: {c.lastTestOk ? <StatusBadge tone="sage" icon={<CheckCircle2 size={13} aria-hidden />}>OK</StatusBadge> : <StatusBadge tone="red" icon={<XCircle size={13} aria-hidden />}>Failed</StatusBadge>} {c.lastTestMessage}</> : "Not tested yet."}</p></div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><ActionButton url={`/api/connectors/${c.id}/test`} label="Test connection" busy="Testing…" variant="secondary" /><ActionButton url={`/api/connectors/${c.id}/import`} label="Run import" busy="Importing…" variant="primary" icon={<Play size={15} aria-hidden />} /></div>
              </div>
              <div className="divider" />
              {folders.length > 0 ? <FolderPicker connectorId={c.id} folders={folders} selected={c.selected} /> : <p className="muted" style={{ margin: 0 }}>Folders appear here after the first import (an import with no selection covers every folder visible to the token).</p>}
            </section>
          );
        })}
        <ConnectorForm />
        <section className="panel panel-pad" aria-labelledby="hist"><h2 className="panel-title" id="hist">Import history</h2>
          {runs.length === 0 ? <p className="muted" style={{ margin: 0 }}>No imports yet.</p> : <div className="tablewrap"><table className="dt"><thead><tr><th scope="col">Started</th><th scope="col">Connector</th><th scope="col">Status</th><th scope="col">Counts</th><th scope="col">Issues</th></tr></thead><tbody>
            {runs.map((r) => <tr key={r.id}><td>{dt(r.startedAt)}</td><td>{names.get(r.connectorId)}</td><td><StatusBadge tone={r.status === "success" ? "sage" : r.status === "partial" ? "amber" : "red"}>{r.status}</StatusBadge></td>
              <td className="mono">{Object.entries(r.counts).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(" ")}</td>
              <td>{r.errors.length === 0 ? "none" : <details><summary>{r.errors.length} issue(s)</summary><ul className="gaps">{r.errors.map((e, i) => <li key={i}><span className="mono">{e.entity}</span>{e.folder && ` (${e.folder})`}: {e.message}</li>)}</ul></details>}</td></tr>)}</tbody></table></div>}</section>
      </div>
    </>
  );
}
