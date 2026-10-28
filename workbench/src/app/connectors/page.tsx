import { desc, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { getContext } from "@/lib/server";
import { connectorFolders, connectorList } from "@/services/queries";
import { ActionButton, ConnectorForm, FolderPicker } from "@/components/Actions";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Connectors() {
  const { db, ctx } = await getContext();
  const list = await connectorList(db, ctx);
  const runs = await db.select().from(s.importRuns).where(eq(s.importRuns.tenantId, ctx.tenantId)).orderBy(desc(s.importRuns.startedAt)).limit(15);
  const names = new Map(list.map((c) => [c.id, c.name]));
  const folderMap = new Map(await Promise.all(list.map(async (c) => [c.id, await connectorFolders(db, c.id)] as const)));
  return (
    <>
      <h1>Connectors &amp; imports</h1>
      <p className="sub">Connections are read-only (HTTP GET only). Configuration is stored encrypted; access tokens are read from server environment variables and never stored.</p>
      {list.length === 0 && <Empty title="No connections yet">Create a simulated demo connection, or add a real Orchestrator below.<br /><br /><ActionButton url="/api/connectors" body={{ demo: true }} label="Create demo connection" /></Empty>}
      {list.map((c) => {
        const folders = folderMap.get(c.id) ?? [];
        return (
          <section className="card" key={c.id} style={{ marginBottom: 16 }}>
            <h2>{c.name} {c.isDemo && <span className="badge b-warn">Simulated data</span>}</h2>
            <p className="muted">{c.lastTestAt ? <>Last test {c.lastTestAt.toLocaleString()}: <span className={`badge ${c.lastTestOk ? "b-ok" : "b-bad"}`}>{c.lastTestOk ? "OK" : "Failed"}</span> {c.lastTestMessage}</> : "Not tested yet."}</p>
            <div className="row" style={{ marginBottom: 12 }}>
              <ActionButton url={`/api/connectors/${c.id}/test`} label="Test connection" busy="Testing…" secondary />
              <ActionButton url={`/api/connectors/${c.id}/import`} label="Run import" busy="Importing…" />
            </div>
            {folders.length > 0 ? <FolderPicker connectorId={c.id} folders={folders} selected={c.selected} /> : <p className="muted">Folders appear here after the first import (an import with no selection covers every folder visible to the token).</p>}
          </section>
        );
      })}
      <ConnectorForm />
      <section className="card" style={{ marginTop: 16 }} aria-labelledby="hist"><h2 id="hist">Import history</h2>
        {runs.length === 0 ? <p className="muted">No imports yet.</p> : <table><thead><tr><th>Started</th><th>Connector</th><th>Status</th><th>Counts</th><th>Issues</th></tr></thead><tbody>
          {runs.map((r) => <tr key={r.id}><td>{r.startedAt.toLocaleString()}</td><td>{names.get(r.connectorId)}</td><td><span className={`badge ${r.status === "success" ? "b-ok" : r.status === "partial" ? "b-warn" : "b-bad"}`}>{r.status}</span></td>
            <td className="mono">{Object.entries(r.counts).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(" ")}</td>
            <td>{r.errors.length === 0 ? "none" : <details><summary>{r.errors.length} issue(s)</summary><ul className="plain">{r.errors.map((e, i) => <li key={i}><span className="mono">{e.entity}</span>{e.folder && ` (${e.folder})`}: {e.message}</li>)}</ul></details>}</td></tr>)}</tbody></table>}</section>
    </>
  );
}
