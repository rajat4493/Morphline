// Test fixture: runs INSIDE the analyzer sandbox and reports what it is able to do. It deliberately attempts forbidden things.
import fs from "node:fs";
import net from "node:net";
import { spawnSync } from "node:child_process";
const out = { envKeys: Object.keys(process.env).length };
try { fs.readFileSync("/etc/hostname"); out.fsRead = "allowed"; } catch (e) { out.fsRead = e.code; }
try { fs.writeFileSync("/tmp/morphline-sandbox-probe.txt", "x"); out.fsWrite = "allowed"; } catch (e) { out.fsWrite = e.code; }
try { const r = spawnSync("echo", ["x"]); out.spawn = r.error ? r.error.code : "allowed"; } catch (e) { out.spawn = e.code; }
try { out.eval = String(eval("1+1")); } catch (e) { out.eval = e.code ?? e.name; }
const [host, port] = process.argv.slice(2);
await new Promise((res) => {
  const s = net.connect({ host, port: Number(port), timeout: 1500 });
  s.on("connect", () => { out.net = "connected"; s.destroy(); res(); });
  s.on("error", (e) => { out.net = e.code; res(); });
  s.on("timeout", () => { out.net = "timeout"; s.destroy(); res(); });
});
process.stdout.write(JSON.stringify(out));
