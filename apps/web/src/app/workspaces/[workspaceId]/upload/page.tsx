"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function UploadPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = Number(params.workspaceId);
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [automationName, setAutomationName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await api.upload(workspaceId, file, {
        automationName: automationName.trim() || file.name,
      });
      router.push(`/automations/${result.automation_id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-ink">Upload a UiPath Process</h1>
      <p className="mt-1.5 text-sm text-subtle">
        Accepted formats: <code className="rounded bg-slate-100 px-1 py-0.5">.nupkg</code>,{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5">.zip</code>,{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5">.xaml</code>. The package is parsed locally and never
        executed — see <span className="italic">SECURITY.md</span> for details.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5 rounded-lg border border-line bg-white p-6">
        <div>
          <label className="block text-sm font-medium text-ink">Process name</label>
          <input
            value={automationName}
            onChange={(e) => setAutomationName(e.target.value)}
            placeholder="Defaults to the uploaded file name"
            className="mt-1.5 w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink">File</label>
          <input
            type="file"
            accept=".nupkg,.zip,.xaml,.json"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1.5 block w-full text-sm text-subtle file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
          />
        </div>
        {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <button
          type="submit"
          disabled={!file || uploading}
          className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50"
        >
          {uploading ? "Analyzing…" : "Upload & Analyze"}
        </button>
      </form>
    </div>
  );
}
