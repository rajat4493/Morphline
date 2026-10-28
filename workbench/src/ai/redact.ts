/** Best-effort PII/secret redaction applied to every text BEFORE it is sent to a model or stored by the AI layer.
 *  This reduces, but cannot eliminate, the chance of personal data leaving the server: see README "AI evidence". */
const PATTERNS: [RegExp, string][] = [
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[email]"],
  [/\b(?:eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}|(?:sk|pk|key|tok|secret)[-_][A-Za-z0-9_-]{12,})\b/gi, "[secret]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  [/\b(?:\d[ -]?){13,19}\b/g, "[number]"],
  [/\+?\d[\d ()-]{8,}\d/g, "[phone]"],
  [/\b\d{6,}\b/g, "[number]"],
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, "[iban]"],
  [/(?:[A-Za-z]:\\|\/(?:home|users|mnt|srv)\/)[^\s"']+/gi, "[path]"],
  [/\bhttps?:\/\/[^\s"']+/gi, "[url]"],
];
export const MAX_TEXT = 200;

export function redact(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  for (const [re, rep] of PATTERNS) t = t.replace(re, rep);
  return t.slice(0, MAX_TEXT);
}
