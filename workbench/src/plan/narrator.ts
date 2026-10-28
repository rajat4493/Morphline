import type { PlanContent } from "./generate";

/** Optional, bounded LLM use: restate structured findings as prose. It never
 *  classifies, never receives raw telemetry or secrets, and its output is stored
 *  and displayed as a DRAFT. Returns null when no LLM is configured. */
export interface Narrator { readonly name: string; draft(plan: PlanContent): Promise<string | null> }

export const nullNarrator: Narrator = { name: "none", draft: async () => null };

export function anthropicNarrator(opts: { apiKey: string; baseUrl?: string; model?: string; fetch?: typeof fetch }): Narrator {
  return {
    name: "anthropic",
    async draft(plan) {
      const facts = JSON.stringify({ process: plan.processName, recommendation: plan.recommendationLabel, confidence: plan.confidence, evidence: plan.evidence, risks: plan.riskFlags, unknowns: plan.unknowns, backlog: plan.backlog });
      const res = await (opts.fetch ?? fetch)(`${opts.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
        method: "POST", headers: { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: opts.model ?? "claude-sonnet-5-5", max_tokens: 500, system: "You write a short executive summary (max 150 words) of a migration plan from the supplied JSON ONLY. Do not add facts, numbers or recommendations that are not in the JSON. Do not change the recommendation. Mention the main unknowns.", messages: [{ role: "user", content: facts }] }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      return body.content?.filter((c) => c.type === "text").map((c) => c.text).join("").trim() || null;
    },
  };
}

export function narratorFromEnv(env = process.env): Narrator {
  return env.ANTHROPIC_API_KEY ? anthropicNarrator({ apiKey: env.ANTHROPIC_API_KEY, baseUrl: env.ANTHROPIC_BASE_URL, model: env.MORPHLINE_LLM_MODEL }) : nullNarrator;
}
