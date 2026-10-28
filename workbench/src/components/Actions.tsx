"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Variant = "primary" | "secondary" | "ghost" | "dark";
const cls = (v: Variant, sm?: boolean) => `btn ${v === "dark" ? "" : v}${sm ? " sm" : ""}`.trim();

export function ActionButton({ url, method = "POST", label, busy, variant = "dark", secondary, icon, redirectTo, body, sm }: { url: string; method?: string; label: string; busy?: string; variant?: Variant; secondary?: boolean; icon?: React.ReactNode; redirectTo?: string; /* e.g. "/plans/{planId}" filled from the JSON response */ body?: unknown; sm?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<{ loading: boolean; msg?: string; ok?: boolean }>({ loading: false });
  const v: Variant = secondary ? "secondary" : variant;
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button className={cls(v, sm)} disabled={state.loading} aria-busy={state.loading} onClick={async () => {
        setState({ loading: true });
        try {
          const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) { setState({ loading: false, ok: false, msg: data.error ?? `Request failed (${res.status})` }); return; }
          setState({ loading: false, ok: data.ok ?? data.status !== "failed", msg: data.message ?? (data.status ? `Import ${data.status}${data.errors?.length ? `: ${data.errors.length} issue(s)` : ""}` : undefined) });
          if (redirectTo) router.push(redirectTo.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(data[k] ?? "")))); else router.refresh();
        } catch (e) { setState({ loading: false, ok: false, msg: (e as Error).message }); }
      }}>{state.loading ? <Loader2 size={16} className="icon spin" aria-hidden /> : icon}{state.loading ? (busy ?? "Working…") : label}</button>
      <span role="status" aria-live="polite" className={state.msg ? `badge ${state.ok === false ? "red" : "neutral"}` : undefined}>{state.msg}</span>
    </span>
  );
}

export function ConnectorForm() {
  const router = useRouter();
  const [err, setErr] = useState<string>();
  return (
    <form className="panel panel-pad" onSubmit={async (e) => {
      e.preventDefault(); setErr(undefined);
      const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
      const res = await fetch("/api/connectors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: f.name, baseUrl: f.baseUrl, organization: f.organization || undefined, tenant: f.tenant || undefined, tokenEnvVar: f.tokenEnvVar }) });
      const data = await res.json();
      if (!res.ok) { setErr(data.issues ? data.issues.map((i: any) => `${i.path}: ${i.message}`).join("; ") : data.error); return; }
      router.refresh();
    }}>
      <h2 className="panel-title">Add UiPath Orchestrator connection</h2>
      <p className="muted" style={{ marginTop: -4 }}>The access token is never entered here or stored. Set it as a server environment variable and enter that variable&apos;s name.</p>
      <div className="toolbar" style={{ padding: 0 }}>
        <div className="field"><label htmlFor="name">Name</label><input className="input" id="name" name="name" required /></div>
        <div className="field"><label htmlFor="baseUrl">Orchestrator URL</label><input className="input" id="baseUrl" name="baseUrl" type="url" placeholder="https://cloud.uipath.com" required /></div>
        <div className="field"><label htmlFor="organization">Organisation (Cloud)</label><input className="input" id="organization" name="organization" /></div>
        <div className="field"><label htmlFor="tenant">Tenant (Cloud)</label><input className="input" id="tenant" name="tenant" /></div>
        <div className="field"><label htmlFor="tokenEnvVar">Token env var name</label><input className="input" id="tokenEnvVar" name="tokenEnvVar" placeholder="UIPATH_ACCESS_TOKEN" required pattern="[A-Z][A-Z0-9_]{1,63}" /></div>
        <button type="submit" className="btn">Save connection</button>
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
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label" style={{ marginBottom: 8 }}>Folders to import ({sel.size} of {folders.length})</legend>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 4 }}>
        {folders.map((f) => <label key={f.sourceId} className="chk"><input type="checkbox" checked={sel.has(f.sourceId)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(f.sourceId) : n.delete(f.sourceId); setSel(n); setSaved(false); }} /> {f.path}</label>)}
      </div>
      <button className="btn secondary sm" style={{ marginTop: 8 }} onClick={async () => { await fetch(`/api/connectors/${connectorId}/folders`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ folderSourceIds: [...sel] }) }); setSaved(true); router.refresh(); }}>Save folder selection</button>
      <span role="status" className="muted" style={{ marginLeft: 8 }}>{saved ? "Saved" : ""}</span>
    </fieldset>
  );
}

export function PackageSettingsForm({ connectorId, initial }: { connectorId: string; initial: { enabled: boolean; permissionConfirmed: boolean; retainRaw: boolean } }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  return (
    <form onSubmit={async (e) => {
      e.preventDefault(); setMsg(undefined);
      const res = await fetch(`/api/connectors/${connectorId}/package-settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: data.issues ? data.issues.map((i: any) => i.message).join("; ") : data.error ?? "Could not save" }); return; }
      setMsg({ ok: true, text: "Saved" }); router.refresh();
    }}>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label" style={{ marginBottom: 6 }}>Package analysis (opt-in, off by default)</legend>
        <label className="chk"><input type="checkbox" checked={v.permissionConfirmed} onChange={(e) => setV({ ...v, permissionConfirmed: e.target.checked, enabled: e.target.checked ? v.enabled : false })} /> I confirm this connection&apos;s token holds the <b>Packages.View</b> permission</label>
        <label className="chk"><input type="checkbox" checked={v.enabled} disabled={!v.permissionConfirmed} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /> Download the exact deployed package version and analyse it statically (read-only)</label>
        <label className="chk"><input type="checkbox" checked={v.retainRaw} disabled={!v.enabled} onChange={(e) => setV({ ...v, retainRaw: e.target.checked })} /> Also retain the raw .nupkg, encrypted at rest (separate from analysis; turning it off deletes retained packages)</label>
      </fieldset>
      <button className="btn secondary sm" type="submit" style={{ marginTop: 8 }}>Save package settings</button>
      <span role="status" aria-live="polite" className={msg ? `badge ${msg.ok ? "sage" : "red"}` : undefined} style={{ marginLeft: 8 }}>{msg?.text}</span>
    </form>
  );
}
