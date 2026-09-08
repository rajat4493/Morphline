"use client";

import { useState } from "react";
import { api, Assessment, BusinessContext, ImpactLevel, ImpactScope, TriState } from "@/lib/api";

const IMPACT_LEVELS: ImpactLevel[] = ["UNKNOWN", "NONE", "LOW", "MEDIUM", "HIGH"];
const SCOPES: ImpactScope[] = ["UNKNOWN", "INTERNAL_ONLY", "SINGLE_CASE", "MULTIPLE_CASES", "BUSINESS_UNIT", "ENTERPRISE", "EXTERNAL_CUSTOMERS"];
const TRI: TriState[] = ["UNKNOWN", "YES", "NO"];

function ImpactSelect({ value, onChange }: { value: ImpactLevel; onChange: (v: ImpactLevel) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as ImpactLevel)} className="rounded-md border border-line px-2 py-1.5 text-sm bg-white">
      {IMPACT_LEVELS.map((l) => (
        <option key={l} value={l}>{l}</option>
      ))}
    </select>
  );
}

function TriSelect({ value, onChange }: { value: TriState; onChange: (v: TriState) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as TriState)} className="rounded-md border border-line px-2 py-1.5 text-sm bg-white">
      {TRI.map((l) => (
        <option key={l} value={l}>{l}</option>
      ))}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label className="text-sm text-ink">{label}</label>
      {children}
    </div>
  );
}

export function BusinessContextForm({
  automationId,
  initial,
  onSaved,
}: {
  automationId: number;
  initial: BusinessContext;
  onSaved: (assessment: Assessment | null, biz: BusinessContext) => void;
}) {
  const [biz, setBiz] = useState<BusinessContext>(initial);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof BusinessContext>(key: K, value: BusinessContext[K]) {
    setBiz((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const result = await api.updateBusinessContext(automationId, biz);
      onSaved(result.assessment, result.business_context);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-white p-5 space-y-1">
      <h3 className="text-sm font-semibold text-ink">Business Context</h3>
      <p className="text-xs text-subtle mb-2">
        These facts cannot be reliably read from the UiPath package — they come from you. Unanswered fields stay
        UNKNOWN and can cap the maximum safe autonomy level (Section 13).
      </p>

      <Field label="Does this process affect customers?">
        <ImpactSelect value={biz.customer_impact} onChange={(v) => set("customer_impact", v)} />
      </Field>
      <Field label="Does it approve, move, or change money?">
        <ImpactSelect value={biz.financial_impact} onChange={(v) => set("financial_impact", v)} />
      </Field>
      <Field label="Does it affect legal or regulatory status?">
        <ImpactSelect value={biz.legal_regulatory_impact} onChange={(v) => set("legal_regulatory_impact", v)} />
      </Field>
      <Field label="Is a human required to remain accountable?">
        <TriSelect value={biz.human_accountability_required} onChange={(v) => set("human_accountability_required", v)} />
      </Field>
      <Field label="Is mandatory human approval required?">
        <TriSelect value={biz.mandatory_approval} onChange={(v) => set("mandatory_approval", v)} />
      </Field>
      <Field label="Are its actions difficult to reverse?">
        <TriSelect value={biz.irreversible_action} onChange={(v) => set("irreversible_action", v)} />
      </Field>
      <Field label="Is this a regulated process?">
        <TriSelect value={biz.regulated_process} onChange={(v) => set("regulated_process", v)} />
      </Field>
      <Field label="Maximum impact scope">
        <select value={biz.maximum_scope} onChange={(e) => set("maximum_scope", e.target.value as ImpactScope)} className="rounded-md border border-line px-2 py-1.5 text-sm bg-white">
          {SCOPES.map((s) => (
            <option key={s} value={s}>{s.replaceAll("_", " ")}</option>
          ))}
        </select>
      </Field>

      <button onClick={() => setShowMore((v) => !v)} className="text-xs text-accent mt-2 hover:underline">
        {showMore ? "Hide additional fields" : "Show additional fields"}
      </button>

      {showMore && (
        <div className="pt-2 space-y-1 border-t border-line mt-2">
          <Field label="Employee impact">
            <ImpactSelect value={biz.employee_impact} onChange={(v) => set("employee_impact", v)} />
          </Field>
          <Field label="External party impact">
            <ImpactSelect value={biz.external_party_impact} onChange={(v) => set("external_party_impact", v)} />
          </Field>
          <Field label="Monetary exposure">
            <ImpactSelect value={biz.monetary_exposure} onChange={(v) => set("monetary_exposure", v)} />
          </Field>
          <Field label="Involves sensitive data?">
            <TriSelect value={biz.sensitive_data} onChange={(v) => set("sensitive_data", v)} />
          </Field>
          <Field label="Supports a critical service?">
            <TriSelect value={biz.critical_service} onChange={(v) => set("critical_service", v)} />
          </Field>
          <div className="py-2">
            <label className="text-sm text-ink block mb-1">Process owner</label>
            <input value={biz.process_owner ?? ""} onChange={(e) => set("process_owner", e.target.value || null)} className="w-full rounded-md border border-line px-2 py-1.5 text-sm" />
          </div>
          <div className="py-2">
            <label className="text-sm text-ink block mb-1">Business description</label>
            <textarea value={biz.business_description ?? ""} onChange={(e) => set("business_description", e.target.value || null)} className="w-full rounded-md border border-line px-2 py-1.5 text-sm" rows={2} />
          </div>
          <div className="py-2">
            <label className="text-sm text-ink block mb-1">Known regulatory/policy requirements</label>
            <textarea value={biz.known_policies ?? ""} onChange={(e) => set("known_policies", e.target.value || null)} className="w-full rounded-md border border-line px-2 py-1.5 text-sm" rows={2} />
          </div>
          <div className="py-2">
            <label className="text-sm text-ink block mb-1">Known mandatory approvals / constraints</label>
            <textarea value={biz.known_constraints ?? ""} onChange={(e) => set("known_constraints", e.target.value || null)} className="w-full rounded-md border border-line px-2 py-1.5 text-sm" rows={2} />
          </div>
          <div className="py-2">
            <label className="text-sm text-ink block mb-1">Notes</label>
            <textarea value={biz.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} className="w-full rounded-md border border-line px-2 py-1.5 text-sm" rows={2} />
          </div>
        </div>
      )}

      {error && <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}

      <div className="pt-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50"
        >
          {saving ? "Saving & reassessing…" : "Save & Reassess"}
        </button>
      </div>
    </div>
  );
}
