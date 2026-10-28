/** Scores exception classifiers against eval/exception-labels.json.
 *  keyword baseline: always runs. model: runs only if MORPHLINE_AI_EVIDENCE=on and ANTHROPIC_API_KEY are set (otherwise reported as BLOCKED). */
import fs from "node:fs";
import { keywordClassifier, type ExceptionClassifier } from "../src/ai/classifier";
import { resolveClassifier } from "../src/ai/config";
import { redact } from "../src/ai/redact";

const set = JSON.parse(fs.readFileSync("eval/exception-labels.json", "utf8")).items as { text: string; label: string }[];
const texts = set.map((i) => redact(i.text));

async function score(c: ExceptionClassifier) {
  const got = new Map((await c.classify(texts)).map((x) => [x.text, x]));
  let ok = 0, covered = 0, hiConf = 0, hiConfOk = 0; const wrong: string[] = [];
  set.forEach((it, i) => { const g = got.get(texts[i]); if (!g) return; covered++; const right = g.label === it.label; ok += +right; if (g.confidence >= 60) { hiConf++; hiConfOk += +right; } if (!right) wrong.push(`  "${it.text}": expected ${it.label}, got ${g.label} (${g.confidence})`); });
  console.log(`\n${c.method}/${c.model}: accuracy ${(ok / set.length * 100).toFixed(0)}% (${ok}/${set.length}), coverage ${covered}/${set.length}, accuracy at confidence>=60: ${hiConf ? (hiConfOk / hiConf * 100).toFixed(0) + "%" : "n/a"} (${hiConfOk}/${hiConf})`);
  console.log(wrong.join("\n"));
}

await score(keywordClassifier);
const r = resolveClassifier({ isDemo: false });
if (r.classifier) await score(r.classifier); else console.log(`\nmodel: BLOCKED. ${r.status}`);
