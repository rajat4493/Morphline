"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Workspace } from "@/lib/api";

export default function HomePage() {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listWorkspaces().then(setWorkspaces).catch((e) => setError(String(e)));
  }, []);

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const ws = await api.createWorkspace(name.trim());
      setWorkspaces((prev) => [ws, ...(prev ?? [])]);
      setName("");
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-ink">Workspaces</h1>
      <p className="mt-1.5 text-sm text-subtle">
        A workspace groups the automations you upload for assessment. Create one to get started, or open an existing
        workspace below.
      </p>

      {error && (
        <div className="mt-6 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Could not reach the API. Is the backend running? ({error})
        </div>
      )}

      <form onSubmit={createWorkspace} className="mt-8 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New workspace name"
          className="flex-1 rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50"
        >
          Create Workspace
        </button>
      </form>

      <div className="mt-8 divide-y divide-line rounded-lg border border-line bg-white">
        {workspaces === null && <div className="px-4 py-6 text-sm text-subtle">Loading…</div>}
        {workspaces?.length === 0 && (
          <div className="px-4 py-6 text-sm text-subtle">No workspaces yet — create one above.</div>
        )}
        {workspaces?.map((ws) => (
          <Link
            key={ws.id}
            href={`/workspaces/${ws.id}`}
            className="flex items-center justify-between px-4 py-3.5 hover:bg-canvas transition-colors"
          >
            <span className="text-sm font-medium text-ink">{ws.name}</span>
            <span className="text-xs text-subtle">{ws.automation_count ?? 0} automation(s)</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
