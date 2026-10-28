// Static, zero-dependency .nupkg analyzer. SECURITY CONTRACT:
//  - It only reads bytes it is given. It never writes files, spawns processes, loads, evals or executes anything from the package.
//  - DLLs, scripts, executables and every other non-XAML/JSON/nuspec entry are never even inflated; they are counted by extension.
//  - Allowed imports are listed in tests/package-worker-security.test.ts (node:zlib, node:crypto only). No network, fs or child_process.
//  - Raw selectors, connection strings, paths, email addresses and other literals are NOT emitted; only derived structural facts are.
import { crc32, inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";

export const ANALYZER_VERSION = "pkg-analyzer-1";
export const LIMITS = { maxPackageBytes: 100 * 1024 * 1024, maxEntries: 5000, maxEntryOut: 8 * 1024 * 1024, maxTotalOut: 64 * 1024 * 1024, maxRatio: 200, maxXmlNodes: 400000, maxXmlDepth: 256, maxAttrLen: 65536, maxWorkflows: 1000 };

const sha = (b) => createHash("sha256").update(b).digest("hex");

/* ---------------- ZIP (central-directory reader; sizes are enforced on real output, never trusted) ---------------- */
export function readZip(buf, L = LIMITS) {
  if (buf.length < 22) return { error: "not a zip archive (too small)" };
  let eocd = -1;
  for (let i = buf.length - 22, min = Math.max(0, buf.length - 22 - 65535); i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return { error: "not a zip archive (no end-of-central-directory record)" };
  const total = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) return { error: "zip64 archives are not supported" };
  if (total > L.maxEntries) return { error: `too many entries (${total})`, limit: "entries" };
  if (cdOff + cdSize > buf.length) return { error: "corrupt central directory" };
  const entries = []; let p = cdOff;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return { error: "corrupt central directory entry" };
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    if (p + 46 + nl > buf.length) return { error: "corrupt central directory entry" };
    entries.push({ name: normName(buf.toString("utf8", p + 46, p + 46 + nl)), flags, method, crc, csize, usize, lho, encrypted: !!(flags & 1) || method === 99 });
    p += 46 + nl + el + cl;
  }
  return { entries };
}
function normName(n) { try { n = decodeURIComponent(n); } catch { /* keep raw */ } return n.replace(/\\/g, "/").replace(/^\/+/, ""); }

function readEntry(buf, e, L, budget) {
  if (e.encrypted) return { error: "encrypted entry" };
  if (e.method !== 0 && e.method !== 8) return { error: `unsupported compression method ${e.method}` };
  const h = e.lho;
  if (h + 30 > buf.length || buf.readUInt32LE(h) !== 0x04034b50) return { error: "bad local header" };
  const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
  if (start + e.csize > buf.length) return { error: "truncated entry" };
  if (e.usize > L.maxEntryOut) return { error: "entry too large", limit: "entry_size" };
  if (e.csize > 0 && e.usize > (1 << 20) && e.usize / e.csize > L.maxRatio) return { error: "suspicious compression ratio", limit: "ratio" };
  if (budget.left < e.usize) return { error: "total uncompressed budget exceeded", limit: "total_size" };
  const raw = buf.subarray(start, start + e.csize);
  let out;
  try { out = e.method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: Math.min(L.maxEntryOut, e.usize + 1024) }); } catch (err) { return { error: `inflate failed (${err.code ?? "error"})`, limit: err.code === "ERR_BUFFER_TOO_LARGE" ? "inflate_overrun" : undefined }; }
  if (out.length !== e.usize) return { error: "size mismatch" };
  if (e.crc !== 0 && (crc32(out) >>> 0) !== e.crc) return { error: "crc mismatch" };
  budget.left -= out.length;
  return { data: out };
}

/* ---------------- Minimal XML walker: no DTD, no entity expansion, bounded depth/nodes ---------------- */
export class XmlError extends Error {}
const ENT = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
export const decodeEntities = (s) => (s.includes("&") ? s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e])) : s);
const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 13;

export function walkXml(src, h, L = LIMITS) {
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0; const n = src.length, stack = []; let nodes = 0;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { if (src.slice(i).trim() && h.text) h.text(src.slice(i)); break; }
    if (lt > i && h.text) { const t = src.slice(i, lt); if (t.trim()) h.text(t); }
    if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt + 4); if (e < 0) throw new XmlError("unterminated comment"); i = e + 3; continue; }
    if (src.startsWith("<![CDATA[", lt)) { const e = src.indexOf("]]>", lt + 9); if (e < 0) throw new XmlError("unterminated CDATA"); h.text?.(src.slice(lt + 9, e)); i = e + 3; continue; }
    if (src.startsWith("<!", lt)) throw new XmlError("DTD or entity declarations are not allowed");
    if (src.startsWith("<?", lt)) { const e = src.indexOf("?>", lt + 2); if (e < 0) throw new XmlError("unterminated processing instruction"); i = e + 2; continue; }
    if (src.charCodeAt(lt + 1) === 47) { // </name>
      const e = src.indexOf(">", lt + 2); if (e < 0) throw new XmlError("unterminated end tag");
      const name = src.slice(lt + 2, e).trim();
      if (stack.pop() !== name) throw new XmlError("mismatched end tag");
      h.end?.(name); i = e + 1; continue;
    }
    let j = lt + 1; while (j < n && !isWs(src.charCodeAt(j)) && src[j] !== "/" && src[j] !== ">") j++;
    const name = src.slice(lt + 1, j); if (!name) throw new XmlError("empty tag name");
    const attrs = []; let self = false;
    for (;;) {
      while (j < n && isWs(src.charCodeAt(j))) j++;
      if (j >= n) throw new XmlError("unterminated start tag");
      if (src[j] === ">") { j++; break; }
      if (src[j] === "/" && src[j + 1] === ">") { self = true; j += 2; break; }
      const a0 = j; while (j < n && !isWs(src.charCodeAt(j)) && src[j] !== "=" && src[j] !== ">" && src[j] !== "/") j++;
      const an = src.slice(a0, j); if (!an) throw new XmlError("bad attribute");
      while (j < n && isWs(src.charCodeAt(j))) j++;
      if (src[j] !== "=") throw new XmlError("attribute without value");
      j++; while (j < n && isWs(src.charCodeAt(j))) j++;
      const q = src[j]; if (q !== '"' && q !== "'") throw new XmlError("unquoted attribute");
      const e = src.indexOf(q, j + 1); if (e < 0) throw new XmlError("unterminated attribute");
      attrs.push([an, src.slice(j + 1, Math.min(e, j + 1 + L.maxAttrLen))]); j = e + 1;
    }
    if (++nodes > L.maxXmlNodes) throw new XmlError("xml node limit exceeded");
    h.start?.(name, attrs, self);
    if (self) h.end?.(name); else { stack.push(name); if (stack.length > L.maxXmlDepth) throw new XmlError("xml depth limit exceeded"); }
    i = j;
  }
  if (stack.length) throw new XmlError("unclosed elements");
}

/* ---------------- Activity taxonomy (presentation of structure, not of code) ---------------- */
const set = (s) => new Set(s.split(/\s+/).filter(Boolean));
const UI = set("Click DoubleClick RightClick TypeInto SendHotkey GetText GetFullText GetVisibleText SetText SelectItem Check Uncheck Hover ElementExists FindElement FindChildren WaitUiElementAppear WaitUiElementVanish OpenBrowser AttachBrowser AttachWindow CloseApplication CloseTab NavigateTo GetAttribute SetFocus Highlight MouseScroll TakeScreenshot ExtractStructuredData ScreenScraping UseApplicationBrowser NClick NTypeInto NGetText NSelectItem NCheck NHover NApplicationCard NKeyboardShortcuts NCheckState NMouseScroll NExtractData NGoToUrl NDoubleClick NRightClick NSetText NHighlight NGetUrl NCloseApplication NExtractTable");
const IMAGE = set("ClickImage FindImage ImageExists ClickOCRText FindOCRText GetOCRText ClickText HoverImage DoubleClickImage");
const API = set("HttpClient NetHttpRequest DeserializeJson SerializeJson DeserializeJsonArray SoapClient SendHttpRequest HttpRequest");
const DB = set("DatabaseConnect ConnectDatabase ExecuteQuery ExecuteNonQuery InsertDataTable BulkInsert DatabaseTransaction DatabaseDisconnect");
const FILE = set("ReadTextFile WriteTextFile AppendLine CopyFile MoveFile DeleteFile PathExists CreateDirectory ReadCsvFile WriteCsvFile ReadRange WriteRange AppendRange ExcelApplicationScope UseExcelFile ExcelReadRange ExcelWriteRange ReadPDFText ReadPDFWithOCR CompressFiles ExtractFiles ForEachFileX ForEachFolderX ReadRangeX WriteRangeX AppendRangeX");
const EMAIL = set("SendMail SendOutlookMail SendSMTPMailMessage GetIMAPMailMessages GetOutlookMailMessages GetPOP3MailMessages ReplyToOutlookMessage SaveMailMessage MoveOutlookMessage DeleteOutlookMessage MarkAsRead SendMailX GetMailX");
const QUEUE_ADD = set("AddQueueItem BulkAddQueueItems AddTransactionItem");
const QUEUE_GET = set("GetQueueItem GetQueueItems GetTransactionItem SetTransactionStatus PostponeTransactionItem GetQueueItemX");
const ASSET = set("GetRobotAsset GetAsset GetRobotCredential GetCredential SetRobotAsset SetAsset");
const DOC = set("DigitizeDocument ClassifyDocument ExtractDocumentData PresentValidationStation GoogleOCR MicrosoftOCR UiPathDocumentOCR TesseractOCR MLSkill IntelligentOCR");
const CODE = set("InvokeCode InvokeMethod InvokePowerShell InvokePythonMethod PythonScope LoadPythonScript RunPythonScript InvokeVBScript InvokeCom StartProcess KillProcess ShellActivity");
const BRANCH = set("If IfElseIf Switch FlowDecision FlowSwitch");
const LOOP = set("ForEach ForEachRow ForEachFileX ForEachFolderX ParallelForEach While DoWhile ForEachRowX");
const MISC_KNOWN = set("Sequence Flowchart StateMachine State FlowStep Assign MultipleAssign Delay LogMessage RetryScope TryCatch Throw Rethrow Parallel Break Continue TerminateWorkflow InvokeWorkflowFile InvokeProcess StartJob RunJob ShouldStop Comment CommentOut Rethrow InputDialog MessageBox Pick PickBranch");
const NOISE = set("Activity Variable Members Property Literal VisualBasicValue VisualBasicReference CSharpValue CSharpReference InArgument OutArgument InOutArgument Catches Catch Collection Dictionary Reference Target TargetAnchorable TargetApp Argument ActivityAction DelegateInArgument DelegateOutArgument WorkflowViewStateService ViewStateData ViewStateManager TextExpression Imports Import Transition Default Then Else Body Cases Case Finally Try Sequence.Variables String Int32 Boolean Object");
const KNOWN = new Set([...UI, ...IMAGE, ...API, ...DB, ...FILE, ...EMAIL, ...QUEUE_ADD, ...QUEUE_GET, ...ASSET, ...DOC, ...CODE, ...BRANCH, ...LOOP, ...MISC_KNOWN]);

function category(loc) {
  if (UI.has(loc) || IMAGE.has(loc)) return "ui"; if (API.has(loc)) return "api"; if (DB.has(loc)) return "database"; if (EMAIL.has(loc)) return "email";
  if (QUEUE_ADD.has(loc) || QUEUE_GET.has(loc)) return "queue"; if (ASSET.has(loc)) return "asset"; if (DOC.has(loc)) return "document"; if (CODE.has(loc)) return "code"; if (FILE.has(loc)) return "file";
  return null;
}
const local = (n) => n.slice(n.indexOf(":") + 1);
const isTestFile = (f) => /(^|\/)(tests?|testcases?)\//i.test(f) || /tests?\.xaml$/i.test(f);
const norm = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();

/* ---------------- Selector profile (derived features + fingerprint; the raw string is discarded) ---------------- */
export function profileSelector(raw) {
  const s = decodeEntities(raw).trim();
  const elems = [...s.matchAll(/<\s*([a-z0-9_-]+)((?:\s+[a-z0-9_:-]+\s*=\s*(?:'[^']*'|"[^"]*"))*)\s*\/?>/gi)];
  const dynamic = /\{\{|"\s*\+|'\s*\+|\+\s*"|\+\s*'/.test(s);
  if (!elems.length) return { root: "other", elements: 0, apps: [], idx: false, wildcards: 0, stable: false, dynamicId: false, dynamic, fragile: true, fp: sha(s.toLowerCase()).slice(0, 12) };
  const apps = new Set(); let idx = false, wild = 0, stable = false, dynId = false;
  for (const m of elems) for (const a of m[2].matchAll(/([a-z0-9_:-]+)\s*=\s*(?:'([^']*)'|"([^"]*)")/gi)) {
    const k = a[1].toLowerCase(), v = a[2] ?? a[3] ?? "";
    if (k === "app" && v) apps.add(v.toLowerCase()); if (k === "idx") idx = true; if (/[*?]/.test(v)) wild++;
    if (["id", "automationid", "name", "aaname", "css-selector", "data-testid"].includes(k) && v && !/^[*?]+$/.test(v)) stable = true;
    if (k === "id" && /\d{4,}/.test(v)) dynId = true;
  }
  const root = elems[0][1].toLowerCase();
  // fingerprint a canonical form (lowercase tag + sorted attributes) so cosmetic reformatting is not mistaken for a change
  const canon = elems.map((m) => `<${m[1].toLowerCase()} ${[...m[2].matchAll(/([a-z0-9_:-]+)\s*=\s*(?:'([^']*)'|"([^"]*)")/gi)].map((a) => `${a[1].toLowerCase()}=${a[2] ?? a[3] ?? ""}`).sort().join(" ")}>`).join("");
  return { root: root === "html" || root === "webctrl" ? "web" : root === "wnd" || root === "ctrl" ? "desktop" : ["java", "sap", "uia"].includes(root) ? root : "other", elements: elems.length, apps: [...apps], idx, wildcards: wild, stable, dynamicId: dynId, dynamic, fragile: idx || dynId || !stable, fp: sha(canon).slice(0, 12) };
}

/* ---------------- Per-workflow XAML analysis ---------------- */
function refValue(v) {
  const s = decodeEntities(v).trim(); if (!s) return { kind: "dynamic" };
  if (!s.startsWith("[")) return { kind: "literal", value: s };
  const e = s.replace(/^\[|\]$/g, "").trim(); let m;
  if ((m = e.match(/^"([^"]*)"$/))) return { kind: "literal", value: m[1] };
  if ((m = e.match(/Config\s*\(\s*"([^"]+)"\s*\)/))) return { kind: "config", key: m[1] };
  return { kind: "dynamic" };
}
const looksAbsPath = (v) => /^[a-z]:[\\/]|^\\\\|^\/(?!\/)/i.test(v);
const isLiteral = (v) => v && !v.trim().startsWith("[") && !/^\{.*\}$/.test(v.trim());

export function analyzeXaml(text, file, L = LIMITS) {
  const w = { file, test: isTestFile(file), parsed: false, activities: 0, depth: 0, complexity: 1, args: [], invokes: [], selectorFps: [], selectors: { total: 0, fragile: 0, idx: 0, dynamic: 0, byRoot: {}, apps: [] },
    counts: { ui: 0, imageBased: 0, api: 0, database: 0, file: 0, email: 0, queue: 0, asset: 0, document: 0, code: 0, branches: 0, loops: 0, retries: 0, tryCatch: 0, catches: 0, finallyBlocks: 0, throws: 0, rethrows: 0, continueOnError: 0, businessRuleExceptions: 0 },
    byActivity: {}, unclassified: {}, refs: { assets: [], queues: [], configKeys: {}, externalProcesses: [], dynamic: 0 }, integrations: { hosts: [], dbProviders: [], hardcodedConnectionStrings: 0, hardcodedPaths: 0, hardcodedEmails: 0, hardcodedSecrets: 0, fileExts: {} }, retries: [] };
  const stack = [], hosts = new Set(), providers = new Set(), apps = new Set(); let depth = 0, inInvokeArgs = false, root = null;
  const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
  try {
    walkXml(text, {
      start(name, attrs) {
        const loc = local(name), isProp = loc.includes("."), amap = new Map(attrs.map(([k, v]) => [local(k), v]));
        if (root === null) root = loc;
        for (const [k, v] of attrs) {
          if (v.includes("BusinessRuleException")) w.counts.businessRuleExceptions += (v.match(/BusinessRuleException/g) ?? []).length;
          for (const m of v.matchAll(/Config\s*\(\s*(?:&quot;|")([^"&]+)(?:&quot;|")\s*\)/g)) bump(w.refs.configKeys, m[1]);
          const kl = local(k);
          if (kl === "Selector" || kl === "FullSelectorArgument" || kl === "FuzzySelectorArgument") {
            const p = profileSelector(v); w.selectors.total++; if (p.fragile) w.selectors.fragile++; if (p.idx) w.selectors.idx++; if (p.dynamic) w.selectors.dynamic++; bump(w.selectors.byRoot, p.root); p.apps.forEach((a) => apps.add(a)); w.selectorFps.push(p.fp);
          }
        }
        if (loc === "Members" && name.startsWith("x:")) { stack.push({ members: true }); return; }
        if (loc === "Property" && name.startsWith("x:") && stack[stack.length - 1]?.members) {
          const t = amap.get("Type") ?? "", d = /^InOutArgument/.test(t) ? "inout" : /^InArgument/.test(t) ? "in" : /^OutArgument/.test(t) ? "out" : "prop";
          w.args.push({ name: (amap.get("Name") ?? "").slice(0, 80), dir: d, type: t.slice(0, 80) });
        }
        if (isProp) {
          if (loc === "TryCatch.Finally") w.counts.finallyBlocks++;
          if (loc === "InvokeWorkflowFile.Arguments") inInvokeArgs = true;
          stack.push({ prop: true, invokeArgs: loc === "InvokeWorkflowFile.Arguments" }); return;
        }
        if (loc === "Catch") { w.counts.catches++; w.complexity++; stack.push({}); return; }
        const act = !NOISE.has(loc) && (KNOWN.has(loc) || amap.has("DisplayName"));
        stack.push({ act });
        if (!act) return;
        depth++; w.depth = Math.max(w.depth, depth); w.activities++; bump(w.byActivity, loc);
        const cat = category(loc); if (cat) { w.counts[cat]++; }
        if (IMAGE.has(loc)) w.counts.imageBased++;
        if (!KNOWN.has(loc)) bump(w.unclassified, loc);
        if (BRANCH.has(loc)) { w.counts.branches++; w.complexity++; } if (LOOP.has(loc)) { w.counts.loops++; w.complexity++; }
        if (loc === "RetryScope") { w.counts.retries++; const n = parseInt(amap.get("NumberOfRetries") ?? "", 10); if (Number.isFinite(n)) w.retries.push(n); }
        if (loc === "TryCatch") w.counts.tryCatch++; if (loc === "Throw") w.counts.throws++; if (loc === "Rethrow") w.counts.rethrows++;
        if (/^true$/i.test(amap.get("ContinueOnError") ?? "")) w.counts.continueOnError++;
        if (loc === "InvokeWorkflowFile") { const t = refValue(amap.get("WorkflowFileName") ?? ""); w.invokes.push(t.kind === "literal" ? { target: t.value.replace(/\\/g, "/"), kind: "file", argc: 0 } : { target: null, kind: "dynamic", argc: 0 }); }
        if (loc === "InvokeProcess" || loc === "StartJob" || loc === "RunJob") { const t = refValue(amap.get("ProcessName") ?? amap.get("ReleaseName") ?? amap.get("WorkflowFileName") ?? ""); if (t.kind === "literal") w.refs.externalProcesses.push(t.value.slice(0, 120)); else w.refs.dynamic++; }
        if (ASSET.has(loc)) { const t = refValue(amap.get("AssetName") ?? amap.get("CredentialName") ?? ""); w.refs.assets.push(t.kind === "literal" ? { kind: "literal", name: t.value.slice(0, 120), op: loc } : t.kind === "config" ? { kind: "config", key: t.key, op: loc } : { kind: "dynamic", op: loc }); }
        if (QUEUE_ADD.has(loc) || QUEUE_GET.has(loc)) { const t = refValue(amap.get("QueueName") ?? amap.get("QueueType") ?? ""); const op = QUEUE_ADD.has(loc) ? "add" : "get"; w.refs.queues.push(t.kind === "literal" ? { kind: "literal", name: t.value.slice(0, 120), op } : t.kind === "config" ? { kind: "config", key: t.key, op } : { kind: "dynamic", op }); }
        for (const [k, v] of attrs) {
          const kl = local(k), dv = decodeEntities(v);
          if (/^(ConnectionString|ConnString)$/.test(kl) && isLiteral(dv)) w.integrations.hardcodedConnectionStrings++;
          if (kl === "ProviderName" && isLiteral(dv)) providers.add(dv.slice(0, 60));
          if (/^(EndPoint|Endpoint|Url|URL|Uri|EndpointUrl|RequestUrl)$/.test(kl) && isLiteral(dv)) { try { hosts.add(new URL(dv).hostname.toLowerCase()); } catch { /* not a URL */ } }
          if (/^(FilePath|Path|FileName|WorkbookPath|SourcePath|DestinationPath|Destination|Source|FolderPath)$/.test(kl) && isLiteral(dv)) { if (looksAbsPath(dv)) w.integrations.hardcodedPaths++; const m = dv.match(/\.([a-z0-9]{1,5})$/i); if (m) bump(w.integrations.fileExts, m[1].toLowerCase()); }
          if (/^(To|Cc|Bcc|From|Account|Recipients)$/.test(kl) && isLiteral(dv) && dv.includes("@")) w.integrations.hardcodedEmails++;
          if (/^(Password|SecurePassword|ApiKey|Secret|Token)$/i.test(kl) && isLiteral(dv) && dv.trim()) w.integrations.hardcodedSecrets++;
        }
      },
      end(name) {
        const top = stack.pop(); if (top?.act) depth--; if (top?.invokeArgs) inInvokeArgs = false;
        const loc = local(name);
        if (top && !top.prop && !top.members && loc === "InvokeWorkflowFile") { /* arg count tracked below */ }
      },
      text(t) { if (t.includes("BusinessRuleException")) w.counts.businessRuleExceptions += (t.match(/BusinessRuleException/g) ?? []).length; },
    }, L);
    w.parsed = true;
  } catch (e) { w.error = e instanceof XmlError ? e.message.slice(0, 80) : "parse error"; }
  w.integrations.hosts = [...hosts].sort(); w.integrations.dbProviders = [...providers].sort(); w.selectors.apps = [...apps].sort();
  w.complexity = Math.max(1, w.complexity);
  const topA = Object.entries(w.byActivity).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  w.hash = sha(JSON.stringify([topA, w.invokes.map((i) => [i.kind, i.target]), w.args.map((a) => [a.name, a.dir]), [...w.selectorFps].sort(), w.counts])).slice(0, 16);
  return w;
}

/* ---------------- Package analysis ---------------- */
export function analyzePackage(bytesIn, opts = {}, L = LIMITS) {
  const buf = Buffer.isBuffer(bytesIn) ? bytesIn : Buffer.from(bytesIn);
  const out = { analyzerVersion: ANALYZER_VERSION, sha256: sha(buf), bytes: buf.length, entryCount: 0, source: { status: "missing", reasons: [], xamlTotal: 0, xamlParsed: 0, xamlFailed: 0, dllCount: 0, encryptedEntries: 0 }, coverage: 0, identity: null, project: null, workflows: [], edges: [], entry: null, unreachable: [], totals: null, embedded: { scripts: 0, executables: 0, dlls: 0, other: 0, byExt: {} }, limits: { hit: [] }, warnings: [] };
  const fail = (status, reason, limit) => { out.source.status = status; out.source.reasons.push(reason); if (limit) out.limits.hit.push(limit); return out; };
  if (buf.length > L.maxPackageBytes) return fail("unreadable", "package exceeds size limit", "package_size");
  const z = readZip(buf, L);
  if (z.error) return fail("unreadable", z.error, z.limit);
  const entries = z.entries; out.entryCount = entries.length;
  out.source.encryptedEntries = entries.filter((e) => e.encrypted).length;
  const dirs = (e) => e.name.endsWith("/");
  const files = entries.filter((e) => !dirs(e));
  const ext = (n) => (n.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  const xamlEntries = files.filter((e) => ext(e.name) === "xaml" && !e.name.startsWith("package/"));
  const dll = files.filter((e) => ext(e.name) === "dll"); out.source.dllCount = dll.length; out.embedded.dlls = dll.length;
  for (const e of files) { const x = ext(e.name); if (["xaml", "dll", "json", "nuspec", "rels", "psmdcp", "xml"].includes(x) || e.name.startsWith("package/") || e.name === "[Content_Types].xml") continue; out.embedded.byExt[x || "(none)"] = (out.embedded.byExt[x || "(none)"] ?? 0) + 1; if (["ps1", "psm1", "py", "js", "vbs", "bat", "cmd", "sh", "wsf"].includes(x)) out.embedded.scripts++; else if (["exe", "msi", "com", "scr", "so", "dylib"].includes(x)) out.embedded.executables++; else out.embedded.other++; }
  const budget = { left: L.maxTotalOut };

  const nuspecE = files.find((e) => ext(e.name) === "nuspec");
  if (nuspecE) { const r = readEntry(buf, nuspecE, L, budget); if (r.data) { const id = { id: null, version: null }; let cur = null; try { walkXml(r.data.toString("utf8"), { start(n) { cur = local(n); }, end() { cur = null; }, text(t) { if (cur === "id" && !id.id) id.id = t.trim().slice(0, 120); if (cur === "version" && !id.version) id.version = t.trim().slice(0, 60); } }, L); } catch { out.warnings.push("nuspec unreadable"); } out.identity = id; } }
  const projE = files.find((e) => /(^|\/)project\.json$/i.test(e.name));
  if (projE) { const r = readEntry(buf, projE, L, budget); if (r.data) { try { const j = JSON.parse(r.data.toString("utf8")); out.project = { name: String(j.name ?? "").slice(0, 120), projectType: j.projectType ?? null, expressionLanguage: j.expressionLanguage ?? null, studioVersion: j.studioVersion ?? null, targetFramework: j.targetFramework ?? null, main: typeof j.main === "string" ? j.main : null, entryPoints: Array.isArray(j.entryPoints) ? j.entryPoints.map((x) => String(x?.filePath ?? "")).filter(Boolean).slice(0, 50) : [], dependencies: Object.entries(j.dependencies ?? {}).map(([id, v]) => ({ id: String(id).slice(0, 120), version: String(v).slice(0, 60) })).sort((a, b) => a.id.localeCompare(b.id)) }; } catch { out.warnings.push("project.json unreadable"); } } }

  out.source.xamlTotal = xamlEntries.length;
  if (xamlEntries.length > L.maxWorkflows) { out.limits.hit.push("workflow_count"); xamlEntries.length = L.maxWorkflows; }
  const wfs = [];
  for (const e of xamlEntries) {
    const rel = e.name.replace(/^content\//i, "");
    const r = readEntry(buf, e, L, budget);
    if (!r.data) { wfs.push({ file: rel, test: isTestFile(rel), parsed: false, error: r.error }); if (r.limit) out.limits.hit.push(r.limit); continue; }
    const text = r.data.toString("utf8");
    if (!text.includes("<")) { wfs.push({ file: rel, test: isTestFile(rel), parsed: false, error: "not xml (binary or encrypted content)" }); continue; }
    wfs.push(analyzeXaml(text, rel, L));
  }
  const nonTest = wfs.filter((w) => !w.test), base = nonTest.length ? nonTest : wfs;
  out.source.xamlParsed = wfs.filter((w) => w.parsed).length; out.source.xamlFailed = wfs.length - out.source.xamlParsed;
  const parsedBase = base.filter((w) => w.parsed), stub = parsedBase.filter((w) => w.activities === 0);

  if (out.source.encryptedEntries > 0) fail("unreadable", `${out.source.encryptedEntries} encrypted entr${out.source.encryptedEntries === 1 ? "y" : "ies"}`);
  else if (wfs.length === 0) { if (dll.length) fail("compiled_only", "assemblies present but no workflow (XAML) files"); else fail("missing", "no workflow files or assemblies in the package"); }
  else if (parsedBase.length === 0) { if (dll.length && base.every((w) => !w.parsed && /not xml|no activities/.test(w.error ?? "x"))) fail("compiled_only", "workflow files are not readable XAML; assemblies present"); else fail("unreadable", "workflow files present but none could be parsed"); }
  else if (parsedBase.length === stub.length && dll.length) fail("compiled_only", "workflow files contain no activities; logic is in compiled assemblies");
  else out.source.status = "source_available";
  out.coverage = out.source.status === "source_available" ? Math.round((parsedBase.length / base.length) * 1000) / 1000 : 0;
  if (out.source.status === "source_available" && out.coverage < 1) out.source.reasons.push(`${base.length - parsedBase.length} of ${base.length} workflow files could not be parsed`);

  // resolve the invoke graph
  const byPath = new Map(wfs.filter((w) => w.parsed).map((w) => [norm(w.file), w]));
  const edges = [];
  for (const w of wfs) for (const inv of w.invokes ?? []) {
    if (inv.kind === "dynamic") { edges.push({ from: w.file, to: null, kind: "dynamic", resolved: false }); continue; }
    const t = byPath.get(norm(inv.target)) ?? [...byPath.values()].find((x) => norm(x.file).endsWith("/" + norm(inv.target)) || norm(inv.target).endsWith("/" + norm(x.file)));
    edges.push({ from: w.file, to: t ? t.file : inv.target, kind: "file", resolved: !!t }); inv.resolved = !!t;
  }
  out.edges = edges;
  const entry = out.project?.main ?? "Main.xaml";
  const entryW = byPath.get(norm(entry)) ?? [...byPath.values()].find((x) => norm(x.file).endsWith("/" + norm(entry)));
  out.entry = entryW?.file ?? null;
  const reach = new Set(); const q = [...new Set([out.entry, ...(out.project?.entryPoints ?? []).map((p) => byPath.get(norm(p))?.file)].filter(Boolean))];
  while (q.length) { const f = q.pop(); if (reach.has(f)) continue; reach.add(f); for (const e of edges) if (e.from === f && e.resolved && e.to) q.push(e.to); }
  out.unreachable = out.entry ? nonTest.filter((w) => w.parsed && !reach.has(w.file)).map((w) => w.file) : [];

  // totals (tests excluded)
  const T = { activities: 0, byCategory: { ui: 0, imageBased: 0, api: 0, database: 0, file: 0, email: 0, queue: 0, asset: 0, document: 0, code: 0 }, topActivities: {}, unclassified: {}, control: { branches: 0, loops: 0, retries: 0, tryCatch: 0, catches: 0, finallyBlocks: 0, throws: 0, rethrows: 0, continueOnError: 0, businessRuleExceptions: 0, maxDepth: 0, cyclomatic: 0 },
    ui: { selectors: 0, fragile: 0, idx: 0, dynamic: 0, byRoot: {}, apps: [] }, integrations: { hosts: [], dbProviders: [], hardcodedConnectionStrings: 0, hardcodedPaths: 0, hardcodedEmails: 0, hardcodedSecrets: 0, fileExts: {} },
    references: { assets: [], queues: [], configKeys: {}, externalProcesses: [], dynamic: 0 }, args: { inbound: 0, outbound: 0 } };
  const apps = new Set(), hosts = new Set(), provs = new Set(), ass = new Map(), qs = new Map(), ext2 = new Set();
  for (const w of parsedBase) {
    T.activities += w.activities; for (const k of Object.keys(T.byCategory)) T.byCategory[k] += w.counts[k] ?? 0;
    for (const [k, v] of Object.entries(w.byActivity)) T.topActivities[k] = (T.topActivities[k] ?? 0) + v; for (const [k, v] of Object.entries(w.unclassified)) T.unclassified[k] = (T.unclassified[k] ?? 0) + v;
    for (const k of ["branches", "loops", "retries", "tryCatch", "catches", "finallyBlocks", "throws", "rethrows", "continueOnError", "businessRuleExceptions"]) T.control[k] += w.counts[k];
    T.control.maxDepth = Math.max(T.control.maxDepth, w.depth); T.control.cyclomatic += w.complexity - 1;
    T.ui.selectors += w.selectors.total; T.ui.fragile += w.selectors.fragile; T.ui.idx += w.selectors.idx; T.ui.dynamic += w.selectors.dynamic; for (const [k, v] of Object.entries(w.selectors.byRoot)) T.ui.byRoot[k] = (T.ui.byRoot[k] ?? 0) + v; w.selectors.apps.forEach((a) => apps.add(a));
    w.integrations.hosts.forEach((h) => hosts.add(h)); w.integrations.dbProviders.forEach((p) => provs.add(p));
    for (const k of ["hardcodedConnectionStrings", "hardcodedPaths", "hardcodedEmails", "hardcodedSecrets"]) T.integrations[k] += w.integrations[k]; for (const [k, v] of Object.entries(w.integrations.fileExts)) T.integrations.fileExts[k] = (T.integrations.fileExts[k] ?? 0) + v;
    for (const a of w.refs.assets) { if (a.kind === "literal") ass.set(a.name, { name: a.name, op: a.op, workflow: w.file }); }
    for (const a of w.refs.queues) { if (a.kind === "literal") qs.set(a.name + "|" + a.op, { name: a.name, op: a.op, workflow: w.file }); }
    for (const [k, v] of Object.entries(w.refs.configKeys)) T.references.configKeys[k] = (T.references.configKeys[k] ?? 0) + v;
    T.references.dynamic += w.refs.dynamic + w.refs.assets.filter((a) => a.kind === "dynamic").length + w.refs.queues.filter((a) => a.kind === "dynamic").length;
    w.refs.externalProcesses.forEach((p) => ext2.add(p));
    for (const a of w.args) { if (a.dir === "in" || a.dir === "inout") T.args.inbound++; if (a.dir === "out" || a.dir === "inout") T.args.outbound++; }
  }
  T.ui.apps = [...apps].sort(); T.integrations.hosts = [...hosts].sort(); T.integrations.dbProviders = [...provs].sort();
  T.references.assets = [...ass.values()]; T.references.queues = [...qs.values()]; T.references.externalProcesses = [...ext2].sort();
  T.references.assetConfigRefs = parsedBase.flatMap((w) => w.refs.assets.filter((a) => a.kind === "config").map((a) => ({ key: a.key, op: a.op, workflow: w.file })));
  T.references.queueConfigRefs = parsedBase.flatMap((w) => w.refs.queues.filter((a) => a.kind === "config").map((a) => ({ key: a.key, op: a.op, workflow: w.file })));
  T.topActivities = Object.fromEntries(Object.entries(T.topActivities).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 25));
  T.unclassified = Object.fromEntries(Object.entries(T.unclassified).sort((a, b) => b[1] - a[1]).slice(0, 15));
  out.totals = T;
  // workflows output: structural facts only (strip anything that could carry literals)
  out.workflows = wfs.map((w) => ({ file: w.file, test: w.test, parsed: w.parsed, error: w.error ?? null, activities: w.activities ?? 0, depth: w.depth ?? 0, complexity: w.complexity ?? 1, hash: w.hash ?? null, args: w.args ?? [], invokes: (w.invokes ?? []).map((i) => ({ kind: i.kind, target: i.target, resolved: !!i.resolved })), counts: w.counts ?? null, selectorFps: w.selectorFps ?? [], selectors: w.selectors ? { total: w.selectors.total, fragile: w.selectors.fragile } : null }));
  return out;
}
