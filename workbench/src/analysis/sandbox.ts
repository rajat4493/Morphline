import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

export type IsolationReport = {
  separateProcess: true; emptyEnvironment: true; timeoutMs: number; maxHeapMb: number;
  /** Node permission model: filesystem reads limited to the worker directory; no child_process, worker threads or writes. */
  fsPermissionModel: boolean;
  /** OS network namespace (unshare -n): the worker has no network interfaces at all. */
  networkNamespace: boolean;
  codeGenerationFromStringsDisabled: true;
};

export const WORKER_DIR = () => path.join(process.cwd(), "worker");
const NODE = process.execPath;

let probed: { permission: boolean; netns: "n" | "rn" | null } | null = null;
/** Probes once which isolation layers this host supports. */
export function probeIsolation() {
  if (probed) return probed;
  const permission = spawnSync(NODE, ["--permission", "-e", "0"], { env: {} as NodeJS.ProcessEnv, timeout: 5000 }).status === 0;
  const unshare = (flag: string) => spawnSync("unshare", [flag, "true"], { env: {} as NodeJS.ProcessEnv, timeout: 5000 }).status === 0;
  probed = { permission, netns: unshare("-n") ? "n" : unshare("-rn") ? "rn" : null };
  return probed;
}
export const resetProbe = () => { probed = null; };

export type SandboxOptions = { script?: string; allowRead?: string[]; args?: string[]; timeoutMs?: number; maxHeapMb?: number; maxOutputBytes?: number; requireIsolation?: boolean };
export type SandboxResult = { ok: true; stdout: Buffer; isolation: IsolationReport } | { ok: false; code: "isolation_unavailable" | "timeout" | "crashed" | "output_too_large"; message: string; isolation?: IsolationReport };

/** Runs a fixed script in a restricted child process, feeding `input` on stdin. Never runs anything derived from package content. */
export function runSandboxed(input: Buffer, opts: SandboxOptions = {}): Promise<SandboxResult> {
  const p = probeIsolation();
  const require = opts.requireIsolation ?? process.env.MORPHLINE_ANALYZER_REQUIRE_ISOLATION === "1";
  const timeoutMs = opts.timeoutMs ?? 60_000, maxHeapMb = opts.maxHeapMb ?? 384;
  const isolation: IsolationReport = { separateProcess: true, emptyEnvironment: true, timeoutMs, maxHeapMb, fsPermissionModel: p.permission, networkNamespace: p.netns !== null, codeGenerationFromStringsDisabled: true };
  if (require && (!p.permission || !p.netns)) return Promise.resolve({ ok: false, code: "isolation_unavailable", message: `Required isolation is unavailable on this host (fs permission model: ${p.permission}, network namespace: ${p.netns !== null}). Run the analyzer in a container with no network or unset MORPHLINE_ANALYZER_REQUIRE_ISOLATION.`, isolation });
  const script = opts.script ?? path.join(WORKER_DIR(), "run.mjs");
  const allow = opts.allowRead ?? [WORKER_DIR()];
  const nodeArgs = [`--max-old-space-size=${maxHeapMb}`, "--disallow-code-generation-from-strings", ...(p.permission ? ["--permission", ...allow.map((d) => `--allow-fs-read=${d}`)] : []), script, ...(opts.args ?? [])];
  const [cmd, args] = p.netns ? ["unshare", [p.netns === "n" ? "-n" : "-rn", NODE, ...nodeArgs]] as const : [NODE, nodeArgs] as const;
  return new Promise((resolve) => {
    const child = spawn(cmd, args as string[], { env: {} as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = []; let size = 0, done = false, over = false; const maxOut = opts.maxOutputBytes ?? 32 * 1024 * 1024;
    const finish = (r: SandboxResult) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ ok: false, code: "timeout", message: `Analyzer exceeded ${timeoutMs} ms and was killed`, isolation }); }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => { size += c.length; if (size > maxOut) { over = true; child.kill("SIGKILL"); } else out.push(c); });
    child.stderr.on("data", () => { /* discarded: never surfaced, it may echo package content */ });
    child.on("error", (e) => finish({ ok: false, code: "crashed", message: `Analyzer could not start: ${e.message}`, isolation }));
    child.on("close", (code) => finish(over ? { ok: false, code: "output_too_large", message: "Analyzer output exceeded limit", isolation } : code === 0 ? { ok: true, stdout: Buffer.concat(out), isolation } : { ok: false, code: "crashed", message: `Analyzer exited with code ${code}`, isolation }));
    child.stdin.on("error", () => { /* child may exit before reading everything */ });
    child.stdin.end(input);
  });
}
