/** A scripted stand-in for the model API, used ONLY in demo mode (MORPHLINE_AI_EVIDENCE=demo on the demo connector).
 *  It exercises the real classifier request/validation path but returns canned labels for the demo estate's exception texts.
 *  It is not a model and its output must never be presented as one: the UI labels it "Simulated". */
export const SIMULATED_MODEL_ID = "simulated-demo";

const TABLE: [RegExp, string, number][] = [
  [/selector|element not found|ui timeout|login page/i, "ui_fragility", 92], [/supplier not found/i, "reference_data_missing", 86], [/layout|ocr|attachment|mixed-language/i, "document_input", 90],
  [/category|routing|multiple categories|intent not matched/i, "classification_ambiguity", 88],
  [/timeout|returned 500|ad timeout/i, "system_unavailable", 90], [/identity check|credential/i, "access_credentials", 90], [/approval/i, "approval_required", 88],
];

export function createSimulatedModel(): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const items = JSON.parse(JSON.parse(String(init?.body)).messages[0].content) as { i: number; text: string }[];
    const out = items.map(({ i, text }) => { const hit = TABLE.find(([re]) => re.test(text)); return { i, label: hit?.[1] ?? "other_unclear", confidence: hit?.[2] ?? 30, rationale: hit ? "simulated demo label" : "no demo rule matched" }; });
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(out) }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
