import type { PlanContent } from "./generate";

export const AI_DRAFT_NOTICE = "AI-generated draft narrative. It restates the structured findings above and may be incomplete; review before use. It is not evidence.";

const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- (none)");

export function planToMarkdown(p: PlanContent, narrative?: string | null): string {
  return [
    `# Migration plan: ${p.processName}`,
    `*Folder:* ${p.folderPath} · *Recommendation:* **${p.recommendationLabel}** (confidence ${p.confidence}/100) · *Rule set:* ${p.ruleVersion} · *Generated:* ${p.generatedAt}`,
    `> **Logic analysis unavailable.** This plan is based on Orchestrator operational data only, not on the package's workflow logic.`,
    narrative ? `## Summary (draft)\n> ${AI_DRAFT_NOTICE}\n\n${narrative}` : "",
    `## Target pattern\n**${p.targetPattern.name}.** ${p.targetPattern.description}`,
    `## Retained RPA elements\n${list(p.retainedRpaElements)}`,
    `## Candidate integrations / tools\n${list(p.candidateIntegrations.map((i) => `**${i.name}** (${i.kind}): ${i.basis}`))}`,
    `## Policies and guardrails\n${list(p.policies)}`,
    `## Identity and RBAC\n${list(p.identityAndRbac)}`,
    `## Human approval and escalation\n${list(p.approvalPoints)}`,
    `## Test and validation criteria\n${list(p.validationCriteria)}`,
    `## Implementation backlog\n${p.backlog.map((b) => `### ${b.phase}: ${b.goal}\n${list(b.items)}`).join("\n\n")}`,
    `## Assumptions\n${list(p.assumptions)}`,
    `## Unknowns / information gaps\n${list(p.unknowns)}`,
    `## Risk flags\n${list(p.riskFlags)}`,
    `## Evidence (assessment ${p.assessmentId}, ${p.ruleVersion})\n${list(p.evidence.map((e) => `**${e.signal}** [${e.ruleId}]${e.provenance === "ai_inferred" ? " (AI-inferred, lower trust)" : ""}: ${e.observed}`))}`,
  ].filter(Boolean).join("\n\n") + "\n";
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function planToHtml(p: PlanContent, narrative?: string | null): string {
  const ul = (xs: string[]) => `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const sec = (h: string, body: string) => `<section><h2>${esc(h)}</h2>${body}</section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Migration plan: ${esc(p.processName)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}h1,h2{line-height:1.2}.note{border-left:4px solid #b45309;background:#fffbeb;padding:.5rem 1rem}.draft{border-left:4px solid #6b7280;background:#f3f4f6;padding:.5rem 1rem}</style></head><body>
<h1>Migration plan: ${esc(p.processName)}</h1><p>${esc(p.folderPath)} · <strong>${esc(p.recommendationLabel)}</strong> (confidence ${p.confidence}/100) · ${esc(p.ruleVersion)} · ${esc(p.generatedAt)}</p>
<p class="note"><strong>Logic analysis unavailable.</strong> Based on Orchestrator operational data only, not the package's workflow logic.</p>
${narrative ? `<section><h2>Summary (draft)</h2><p class="draft">${esc(AI_DRAFT_NOTICE)}</p><p>${esc(narrative)}</p></section>` : ""}
${sec("Target pattern", `<p><strong>${esc(p.targetPattern.name)}.</strong> ${esc(p.targetPattern.description)}</p>`)}
${sec("Retained RPA elements", ul(p.retainedRpaElements))}${sec("Candidate integrations / tools", ul(p.candidateIntegrations.map((i) => `${i.name} (${i.kind}): ${i.basis}`)))}
${sec("Policies and guardrails", ul(p.policies))}${sec("Identity and RBAC", ul(p.identityAndRbac))}${sec("Human approval and escalation", ul(p.approvalPoints))}${sec("Test and validation criteria", ul(p.validationCriteria))}
${sec("Implementation backlog", p.backlog.map((b) => `<h3>${esc(b.phase)}: ${esc(b.goal)}</h3>${ul(b.items)}`).join(""))}
${sec("Assumptions", ul(p.assumptions))}${sec("Unknowns / information gaps", ul(p.unknowns))}${sec("Risk flags", ul(p.riskFlags))}${sec(`Evidence (assessment ${p.assessmentId})`, ul(p.evidence.map((e) => `${e.signal} [${e.ruleId}]${e.provenance === "ai_inferred" ? " (AI-inferred, lower trust)" : ""}: ${e.observed}`)))}
</body></html>`;
}
