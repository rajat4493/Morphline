import { keywordClassifier, llmClassifier, type ExceptionClassifier } from "./classifier";
import { createSimulatedModel, SIMULATED_MODEL_ID } from "@/demo/simulated-model";

/** MORPHLINE_AI_EVIDENCE: off (default) | on (real model; needs ANTHROPIC_API_KEY) | demo (simulated model, demo connectors only). */
export type AiMode = "off" | "on" | "demo";
export const aiMode = (env: Record<string, string | undefined> = process.env): AiMode => (env.MORPHLINE_AI_EVIDENCE === "on" ? "on" : env.MORPHLINE_AI_EVIDENCE === "demo" ? "demo" : "off");

export type ResolvedAi = { classifier: ExceptionClassifier | null; mode: AiMode; status: string };

export function resolveClassifier(opts: { isDemo: boolean; env?: Record<string, string | undefined>; fetch?: typeof fetch }): ResolvedAi {
  const env = opts.env ?? process.env, mode = aiMode(env);
  if (mode === "off") return { classifier: null, mode, status: "Off. Assessments use deterministic rules only." };
  if (mode === "demo") return opts.isDemo
    ? { classifier: llmClassifier({ apiKey: "demo", model: SIMULATED_MODEL_ID, fetch: opts.fetch ?? createSimulatedModel() }), mode, status: "Simulated model (demo data only). No text leaves this server." }
    : { classifier: null, mode, status: "Demo AI mode applies to the demo connector only. This connector uses deterministic rules." };
  if (!env.ANTHROPIC_API_KEY) return { classifier: null, mode, status: "Enabled but ANTHROPIC_API_KEY is not set; using deterministic rules only." };
  const model = env.MORPHLINE_AI_EVIDENCE_MODEL ?? "claude-haiku-5-5";
  return { classifier: llmClassifier({ apiKey: env.ANTHROPIC_API_KEY, model, baseUrl: env.ANTHROPIC_BASE_URL, fetch: opts.fetch }), mode, status: `On: exception texts are redacted and sent to ${model} for labelling.` };
}
export { keywordClassifier };
