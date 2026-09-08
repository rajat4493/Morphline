import { PATTERN_LABELS, Recommendation, STATE_LABELS, STATE_ORDER } from "@/lib/api";
import type { EvolutionState } from "@/lib/api";

export function EvolutionLadder({ rec }: { rec: Recommendation }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <StatBlock label="Current State" state={rec.current_state} />
      <StatBlock label="Recommended State" state={rec.recommended_state} highlight />
      <StatBlock label="Maximum Safe State" state={rec.maximum_safe_state} />
      <StatBlock label="Next Possible State" state={rec.next_possible_state} muted />
      <div className="sm:col-span-2 lg:col-span-4 rounded-lg border border-accent/40 bg-blue-50/30 p-4">
        <div className="text-xs font-medium text-subtle uppercase tracking-wide">Recommended Migration Pattern</div>
        <div className="mt-1 text-base font-semibold text-ink">{PATTERN_LABELS[rec.recommended_pattern]}</div>
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <Ladder rec={rec} />
      </div>
    </div>
  );
}

function StatBlock({
  label,
  state,
  highlight,
  muted,
}: {
  label: string;
  state: EvolutionState;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? "border-accent bg-blue-50/40" : "border-line bg-white"}`}>
      <div className="text-xs font-medium text-subtle uppercase tracking-wide">{label}</div>
      <div className={`mt-1.5 text-lg font-semibold ${muted ? "text-subtle" : "text-ink"}`}>{STATE_LABELS[state]}</div>
    </div>
  );
}

function Ladder({ rec }: { rec: Recommendation }) {
  const currentIdx = STATE_ORDER.indexOf(rec.current_state);
  const recIdx = STATE_ORDER.indexOf(rec.recommended_state);
  const ceilingIdx = STATE_ORDER.indexOf(rec.maximum_safe_state);

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="flex items-center gap-1">
        {STATE_ORDER.map((state, idx) => {
          const isSafe = idx <= ceilingIdx;
          const isRecommended = idx === recIdx;
          const isCurrent = idx === currentIdx;
          return (
            <div key={state} className="flex-1 flex flex-col items-center gap-1.5">
              <div
                className={`h-2 w-full rounded-full ${
                  isSafe ? (isRecommended ? "bg-accent" : "bg-blue-200") : "bg-slate-100"
                }`}
              />
              <div className="text-[11px] text-center leading-tight">
                <div className={isRecommended ? "font-semibold text-ink" : "text-subtle"}>{STATE_LABELS[state]}</div>
                {isCurrent && <div className="text-[10px] text-subtle">(current)</div>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-subtle">
        Shaded bars mark states considered safe today given active constraints; the darker bar is the recommendation.
        States beyond the safe ceiling are greyed out — not because they are impossible, but because nothing currently
        justifies the added autonomy risk.
      </p>
    </div>
  );
}
