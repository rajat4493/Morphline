// Sandbox entry point. Reads ONE package from stdin, writes ONE JSON document to stdout. No files, no network, no child processes.
// The parent starts this under: an empty environment, Node's permission model (fs read limited to this directory), a network namespace
// where the OS allows it, and a hard timeout. This script is a second line of defence, not the first.
import { ANALYZER_VERSION, LIMITS, analyzePackage } from "./analyze.mjs";

globalThis.fetch = undefined; globalThis.WebSocket = undefined; // tripwire: nothing here should ever need the network

const chunks = []; let size = 0;
process.stdin.on("data", (c) => { size += c.length; if (size > LIMITS.maxPackageBytes + 1024) { process.stdout.write(JSON.stringify({ ok: false, error: "input too large" })); process.exit(0); } chunks.push(c); });
process.stdin.on("end", () => {
  try { process.stdout.write(JSON.stringify({ ok: true, analyzerVersion: ANALYZER_VERSION, result: analyzePackage(Buffer.concat(chunks)) })); }
  catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: `analyzer error: ${String(e?.message ?? e).slice(0, 120)}` })); }
});
