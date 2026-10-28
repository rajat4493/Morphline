import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { probeIsolation, runSandboxed } from "@/analysis/sandbox";
import { writeZip } from "@/demo/zip-writer";
import { analyzePackage } from "../worker/analyze.mjs";

const FIX = path.join(process.cwd(), "tests", "fixtures"), WORKER = path.join(process.cwd(), "worker");
const iso = probeIsolation();

describe("analyzer source is locked down", () => {
  const files = fs.readdirSync(WORKER).filter((f) => f.endsWith(".mjs"));
  it("imports only node:zlib, node:crypto and itself", () => {
    expect(files.sort()).toEqual(["analyze.mjs", "run.mjs"]);
    for (const f of files) for (const m of fs.readFileSync(path.join(WORKER, f), "utf8").matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)) expect(["node:zlib", "node:crypto", "./analyze.mjs"], `${f} imports ${m[1]}`).toContain(m[1]);
  });
  it("contains no dynamic code loading, process spawning, network or filesystem access", () => {
    for (const f of files) {
      const src = fs.readFileSync(path.join(WORKER, f), "utf8").replace(/\/\/.*$/gm, "");
      for (const bad of [/\beval\s*\(/, /new\s+Function\s*\(/, /\bimport\s*\(/, /\brequire\s*\(/, /child_process/, /process\.binding/, /\bfetch\s*\(/, /node:(net|http|https|dns|dgram|tls|http2|fs|vm|worker_threads|child_process)/, /writeFile|createWriteStream|readFileSync|readFile\(/]) expect(src, `${f}: ${bad}`).not.toMatch(bad);
    }
  });
});

describe("sandbox behaviour (hostile probe run inside the real sandbox)", () => {
  it.skipIf(!iso.permission)("empty environment, no filesystem reads outside the allow-list, no writes, no child processes, no eval", async () => {
    const r = await runSandboxed(Buffer.alloc(0), { script: path.join(FIX, "sandbox-probe.mjs"), allowRead: [FIX], args: ["127.0.0.1", "9"] });
    expect(r.ok).toBe(true); if (!r.ok) return;
    const out = JSON.parse(r.stdout.toString());
    expect(out).toMatchObject({ envKeys: 0, fsRead: "ERR_ACCESS_DENIED", fsWrite: "ERR_ACCESS_DENIED", spawn: "ERR_ACCESS_DENIED" });
    expect(out.eval).not.toBe("2"); // --disallow-code-generation-from-strings
    expect(fs.existsSync("/tmp/morphline-sandbox-probe.txt")).toBe(false);
  });
  it.skipIf(!iso.netns)("has no network: it cannot reach a listener on the host's loopback", async () => {
    let connections = 0;
    const server = net.createServer((s) => { connections++; s.destroy(); });
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    try {
      const r = await runSandboxed(Buffer.alloc(0), { script: path.join(FIX, "sandbox-probe.mjs"), allowRead: [FIX], args: ["127.0.0.1", String((server.address() as net.AddressInfo).port)] });
      expect(r.ok).toBe(true); if (!r.ok) return;
      expect(JSON.parse(r.stdout.toString()).net).not.toBe("connected");
      expect(connections).toBe(0);
    } finally { server.close(); }
  });
  it("kills a runaway worker at the timeout", async () => {
    const r = await runSandboxed(Buffer.alloc(0), { script: path.join(FIX, "hang.mjs"), allowRead: [FIX], timeoutMs: 600 });
    expect(r).toMatchObject({ ok: false, code: "timeout" });
  });
  it("caps worker output", async () => {
    const r = await runSandboxed(Buffer.alloc(0), { script: path.join(FIX, "flood.mjs"), allowRead: [FIX], maxOutputBytes: 1024 * 1024 });
    expect(r).toMatchObject({ ok: false, code: "output_too_large" });
  });
  it("reports the isolation layers actually in effect", async () => {
    const r = await runSandboxed(Buffer.alloc(0), { script: path.join(FIX, "sandbox-probe.mjs"), allowRead: [FIX], args: ["127.0.0.1", "9"] });
    expect(r.isolation).toMatchObject({ separateProcess: true, emptyEnvironment: true, fsPermissionModel: iso.permission, networkNamespace: iso.netns !== null });
  });
});

describe("package content is never executed", () => {
  const marker = "/tmp/morphline-package-executed-marker";
  const NS = `xmlns="http://schemas.microsoft.com/netfx/2009/xaml/activities" xmlns:ui="http://schemas.uipath.com/workflow/activities" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"`;
  const hostile = writeZip([
    { name: "P.nuspec", data: "<package><metadata><id>P</id><version>1.0.0</version></metadata></package>" }, { name: "content/project.json", data: JSON.stringify({ name: "P", main: "Main.xaml" }) },
    { name: "content/Main.xaml", data: `<Activity ${NS}><Sequence DisplayName="s"><ui:InvokeCode DisplayName="code" Code="require('fs').writeFileSync('${marker}', 'pwned')" /><ui:InvokePowerShell DisplayName="ps" Script="New-Item ${marker}" /><ui:StartProcess DisplayName="sp" FileName="/bin/sh" Arguments="-c 'touch ${marker}'" /></Sequence></Activity>` },
    { name: "content/payload.ps1", data: `New-Item ${marker}` }, { name: "content/payload.sh", data: `#!/bin/sh\ntouch ${marker}\n` }, { name: "content/tool.exe", data: "MZ" }, { name: "content/Evil.dll", data: "MZ" },
  ]);
  it("analysing a package full of runnable content runs none of it (in-process and in the sandbox)", async () => {
    fs.rmSync(marker, { force: true });
    const inProc = analyzePackage(hostile);
    expect(inProc.totals.byCategory.code).toBe(3); expect(inProc.embedded).toMatchObject({ scripts: 2, executables: 1, dlls: 1 });
    const r = await runSandboxed(hostile); expect(r.ok).toBe(true); if (!r.ok) return;
    const viaSandbox = JSON.parse(r.stdout.toString());
    expect(viaSandbox.result).toEqual(JSON.parse(JSON.stringify(inProc))); // same answer across the process boundary
    expect(fs.existsSync(marker)).toBe(false);
    expect(r.stdout.toString()).not.toContain("pwned");
  });
  it("requiring isolation succeeds only where the host provides it", async () => {
    const r = await runSandboxed(Buffer.from("x"), { requireIsolation: true });
    if (iso.permission && iso.netns) expect(r.ok).toBe(true); else expect(r).toMatchObject({ ok: false, code: "isolation_unavailable" });
  });
});
