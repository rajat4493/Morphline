"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ActionButton({ url, method = "POST", label, busy, secondary, redirectTo, body }: { url: string; method?: string; label: string; busy?: string; secondary?: boolean; redirectTo?: string; /* e.g. "/plans/{planId}" filled from the JSON response */ body?: unknown }) {
  const router = useRouter();
  const [state, setState] = useState<{ loading: boolean; msg?: string; ok?: boolean }>({ loading: false });
  return (
    <span>
      <button className={secondary ? "secondary" : ""} disabled={state.loading} onClick={async () => {
        setState({ loading: true });
        try {
          const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) { setState({ loading: false, ok: false, msg: data.error ?? `Request failed (${res.status})` }); return; }
          setState({ loading: false, ok: data.ok ?? data.status !== "failed", msg: data.message ?? (data.status ? `Import ${data.status}${data.errors?.length ? `: ${data.errors.length} issue(s)` : ""}` : undefined) });
          if (redirectTo) router.push(redirectTo.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(data[k] ?? "")))); else router.refresh();
        } catch (e) { setState({ loading: false, ok: false, msg: (e as Error).message }); }
      }}>{state.loading ? (busy ?? "Working…") : label}</button>
      <span role="status" aria-live="polite" className={state.ok === false ? "badge b-bad" : "muted"} style={{ marginLeft: 8 }}>{state.msg}</span>
    </span>
  );
}

export function ConnectorForm() {
  const router = useRouter();
  const [err, setErr] = useState<string>();
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault(); setErr(undefined);
      const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
      const res = await fetch("/api/connectors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: f.name, baseUrl: f.baseUrl, organization: f.organization || undefined, tenant: f.tenant || undefined, tokenEnvVar: f.tokenEnvVar }) });
      const data = await res.json();
      if (!res.ok) { setErr(data.issues ? data.issues.map((i: any) => `${i.path}: ${i.message}`).join("; ") : data.error); return; }
      router.refresh();
    }}>
      <h2>Add UiPath Orchestrator connection</h2>
      <p className="muted">The access token is never entered here or stored. Set it as a server environment variable and enter that variable&apos;s name.</p>
      <div className="row">
        <div><label htmlFor="name">Name</label><input id="name" name="name" required /></div>
        <div><label htmlFor="baseUrl">Orchestrator URL</label><input id="baseUrl" name="baseUrl" type="url" placeholder="https://cloud.uipath.com" required /></div>
        <div><label htmlFor="organization">Organisation (Cloud)</label><input id="organization" name="organization" /></div>
        <div><label htmlFor="tenant">Tenant (Cloud)</label><input id="tenant" name="tenant" /></div>
        <div><label htmlFor="tokenEnvVar">Token env var name</label><input id="tokenEnvVar" name="tokenEnvVar" placeholder="UIPATH_ACCESS_TOKEN" required pattern="[A-Z][A-Z0-9_]{1,63}" /></div>
        <button type="submit">Save connection</button>
      </div>
      {err && <p role="alert" className="notice err" style={{ marginTop: 12 }}>{err}</p>}
    </form>
  );
}

export function FolderPicker({ connectorId, folders, selected }: { connectorId: string; folders: { sourceId: string; path: string }[]; selected: string[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set(selected.length ? selected : folders.map((f) => f.sourceId)));
  const [saved, setSaved] = useState(false);
  return (
    <fieldset style={{ border: 0, padding: 0 }}>
      <legend className="muted">Folders to import ({sel.size} of {folders.length})</legend>
      {folders.map((f) => <label key={f.sourceId} style={{ display: "block", color: "inherit" }}><input type="checkbox" checked={sel.has(f.sourceId)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(f.sourceId) : n.delete(f.sourceId); setSel(n); setSaved(false); }} /> {f.path}</label>)}
      <button className="secondary" style={{ marginTop: 8 }} onClick={async () => { await fetch(`/api/connectors/${connectorId}/folders`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ folderSourceIds: [...sel] }) }); setSaved(true); router.refresh(); }}>Save folder selection</button>
      <span role="status" className="muted" style={{ marginLeft: 8 }}>{saved ? "Saved" : ""}</span>
    </fieldset>
  );
}
