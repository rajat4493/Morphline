import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { analyzePackage, analyzeXaml, profileSelector, readZip, walkXml } from "../worker/analyze.mjs";
import { writeZip, type ZipEntry } from "@/demo/zip-writer";

const NS = `xmlns="http://schemas.microsoft.com/netfx/2009/xaml/activities" xmlns:ui="http://schemas.uipath.com/workflow/activities" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"`;
const act = (body: string, members = "") => `<Activity ${NS} x:Class="W"><x:Members>${members}</x:Members>${body}</Activity>`;
const pkg = (files: Record<string, string>, extra: ZipEntry[] = [], project: object = { name: "P", main: "Main.xaml", dependencies: { "UiPath.System.Activities": "[23.10.5]" } }) =>
  writeZip([{ name: "P.nuspec", data: "<package><metadata><id>P</id><version>1.2.3</version></metadata></package>" }, { name: "content/project.json", data: JSON.stringify(project) }, ...Object.entries(files).map(([n, d]) => ({ name: `content/${n}`, data: d })), ...extra]);

describe("source status", () => {
  it("source_available: parses workflows, entry point, invoke edges and unreachable files", () => {
    const r = analyzePackage(pkg({
      "Main.xaml": act(`<Sequence DisplayName="m"><ui:InvokeWorkflowFile DisplayName="a" WorkflowFileName="Sub\\A.xaml" /><ui:InvokeWorkflowFile DisplayName="dyn" WorkflowFileName="[in_Name]" /><ui:InvokeWorkflowFile DisplayName="gone" WorkflowFileName="Missing.xaml" /></Sequence>`),
      "Sub/A.xaml": act(`<Sequence DisplayName="a"><Delay DisplayName="d" /></Sequence>`), "Orphan.xaml": act(`<Sequence DisplayName="o" />`) }));
    expect(r.source.status).toBe("source_available"); expect(r.coverage).toBe(1); expect(r.identity).toEqual({ id: "P", version: "1.2.3" });
    expect(r.entry).toBe("Main.xaml");
    expect(r.edges).toEqual(expect.arrayContaining([{ from: "Main.xaml", to: "Sub/A.xaml", kind: "file", resolved: true }, { from: "Main.xaml", to: null, kind: "dynamic", resolved: false }, { from: "Main.xaml", to: "Missing.xaml", kind: "file", resolved: false }]));
    expect(r.unreachable).toEqual(["Orphan.xaml"]); expect(r.project.dependencies).toEqual([{ id: "UiPath.System.Activities", version: "[23.10.5]" }]);
  });
  it("compiled_only: assemblies without XAML, or XAML stubs with no activities beside assemblies", () => {
    const dll = { name: "lib/net6.0/P.dll", data: Buffer.from("MZ not code") };
    expect(analyzePackage(pkg({}, [dll])).source.status).toBe("compiled_only");
    const stub = analyzePackage(pkg({ "Main.xaml": act("") }, [dll]));
    expect(stub.source.status).toBe("compiled_only"); expect(stub.coverage).toBe(0);
  });
  it("unreadable: encrypted entries, garbled XAML, truncated or non-zip input, zip64", () => {
    expect(analyzePackage(pkg({ "Main.xaml": act(`<Sequence DisplayName="x"/>`) }, [{ name: "content/Secret.xaml", data: "x", flags: 1 }])).source.status).toBe("unreadable");
    expect(analyzePackage(pkg({ "Main.xaml": "\u0000\u0001 binary garbage" })).source.status).toBe("unreadable");
    expect(analyzePackage(Buffer.from("this is not a zip at all, just text, long enough to pass the size check")).source.status).toBe("unreadable");
    expect(analyzePackage(pkg({ "Main.xaml": act(`<Sequence DisplayName="x"/>`) }).subarray(0, 80)).source.status).toBe("unreadable");
    const z64 = pkg({ "Main.xaml": act(`<Sequence DisplayName="x"/>`) }); z64.writeUInt16LE(0xffff, z64.length - 22 + 10);
    expect(analyzePackage(z64).source.reasons.join()).toMatch(/zip64/);
  });
  it("missing: nothing that looks like a workflow or assembly", () => { const r = analyzePackage(pkg({})); expect(r.source.status).toBe("missing"); expect(r.coverage).toBe(0); });
  it("partial coverage: one broken workflow among three", () => {
    const ok = act(`<Sequence DisplayName="x"><Delay DisplayName="d" /></Sequence>`);
    const r = analyzePackage(pkg({ "Main.xaml": ok, "A.xaml": ok, "B.xaml": "<Activity><Sequence DisplayName='x'>" }));
    expect(r.source.status).toBe("source_available"); expect(r.coverage).toBeCloseTo(0.667, 2); expect(r.source.reasons.join()).toMatch(/1 of 3/);
  });
  it("test workflows are reported but excluded from totals and coverage", () => {
    const r = analyzePackage(pkg({ "Main.xaml": act(`<Sequence DisplayName="m"><ui:Click DisplayName="c" /></Sequence>`), "Tests/T.xaml": act(`<Sequence DisplayName="t"><ui:Click DisplayName="c" /><ui:Click DisplayName="d" /></Sequence>`) }));
    expect(r.totals.byCategory.ui).toBe(1); expect(r.workflows.find((w: any) => w.file === "Tests/T.xaml").test).toBe(true);
  });
});

describe("structure extraction", () => {
  const body = `<Sequence DisplayName="s">
    <ui:Click DisplayName="c1" Selector="&lt;wnd app='tn3270.exe' title='*C*' /&gt;&lt;ctrl idx='3' /&gt;" ContinueOnError="True" />
    <ui:TypeInto DisplayName="t" Selector="&lt;html app='chrome.exe' /&gt;&lt;webctrl id='user' tag='INPUT' /&gt;" /><ui:ClickImage DisplayName="img" />
    <HttpClient DisplayName="h" EndPoint="https://api.example.org/v1/things?token=abc" /><ui:ExecuteQuery DisplayName="q" ProviderName="System.Data.SqlClient" ConnectionString="Server=db;Password=hunter2" />
    <ui:ReadTextFile DisplayName="f" FileName="C:\\Data\\in.csv" /><ui:SendMail DisplayName="m" To="boss@example.org" /><ui:GetRobotAsset DisplayName="a" AssetName="MyAsset" /><ui:GetRobotCredential DisplayName="cr" AssetName="[in_Config(&quot;CredName&quot;).ToString]" />
    <ui:AddQueueItem DisplayName="qa" QueueName="Out" /><ui:GetTransactionItem DisplayName="qg" QueueType="[in_Config(&quot;QueueKey&quot;).ToString]" /><ui:InvokeProcess DisplayName="ip" ProcessName="Other_Process" />
    <ui:DigitizeDocument DisplayName="dd" /><ui:InvokePythonMethod DisplayName="py" /><ui:ExecuteQuery DisplayName="pw" Password="s3cret" />
    <If DisplayName="i1" /><Switch DisplayName="sw" /><ForEach DisplayName="fe" /><While DisplayName="wh" /><ui:RetryScope DisplayName="rs" NumberOfRetries="3" />
    <TryCatch DisplayName="tc"><TryCatch.Try><Delay DisplayName="d" /></TryCatch.Try><TryCatch.Catches><Catch x:TypeArguments="s:Exception" /></TryCatch.Catches><TryCatch.Finally><Delay DisplayName="fin" /></TryCatch.Finally></TryCatch>
    <Throw DisplayName="th" Exception="[New BusinessRuleException(&quot;x&quot;)]" /><Rethrow DisplayName="rt" /><Assign DisplayName="as" /><SomeVendorActivity DisplayName="vendor" /></Sequence>`;
  const members = `<x:Property Name="in_Config" Type="InArgument(x:String)" /><x:Property Name="out_Result" Type="OutArgument(x:Int32)" /><x:Property Name="io_Table" Type="InOutArgument(x:Object)" />`;
  const r = analyzeXaml(act(body, members), "Main.xaml");
  it("counts activities by category, control flow and error handling", () => {
    expect(r.parsed).toBe(true);
    expect(r.counts).toMatchObject({ ui: 3, imageBased: 1, api: 1, database: 2, file: 1, email: 1, queue: 2, asset: 2, document: 1, code: 1, branches: 2, loops: 2, retries: 1, tryCatch: 1, catches: 1, finallyBlocks: 1, throws: 1, rethrows: 1, continueOnError: 1, businessRuleExceptions: 1 });
    expect(r.unclassified).toEqual({ SomeVendorActivity: 1 }); expect(r.retries).toEqual([3]); expect(r.depth).toBeGreaterThanOrEqual(3); expect(r.complexity).toBe(1 + 2 + 2 + 1);
  });
  it("derives selector features and stable fingerprints without keeping the selector text", () => {
    expect(r.selectors).toMatchObject({ total: 2, fragile: 1, idx: 1 }); expect(r.selectors.byRoot).toEqual({ desktop: 1, web: 1 }); expect(r.selectors.apps).toEqual(["chrome.exe", "tn3270.exe"]);
    const a = profileSelector("<html app='chrome.exe' />  <webctrl id='x' />"), b = profileSelector("<html app='chrome.exe' /> <webctrl id='x'/>");
    expect(a.fp).toBe(b.fp); expect(profileSelector("<wnd app='a.exe' /><ctrl idx='2' />").fragile).toBe(true); expect(profileSelector("<html app='c.exe' /><webctrl id='btn7731234' />").dynamicId).toBe(true);
    expect(profileSelector("<html app='c.exe' /><webctrl css-selector='.save' />").fragile).toBe(false);
  });
  it("separates literal, Config-driven and dynamic references", () => {
    expect(r.refs.assets).toEqual([{ kind: "literal", name: "MyAsset", op: "GetRobotAsset" }, { kind: "config", key: "CredName", op: "GetRobotCredential" }]);
    expect(r.refs.queues).toEqual([{ kind: "literal", name: "Out", op: "add" }, { kind: "config", key: "QueueKey", op: "get" }]); expect(r.refs.externalProcesses).toEqual(["Other_Process"]); expect(r.refs.configKeys).toMatchObject({ CredName: 1, QueueKey: 1 });
  });
  it("reads argument names, directions and types", () => { expect(r.args.map((a: any) => [a.name, a.dir])).toEqual([["in_Config", "in"], ["out_Result", "out"], ["io_Table", "inout"]]); });
  it("flags hard-coded literals but never emits them", () => {
    expect(r.integrations).toMatchObject({ hardcodedConnectionStrings: 1, hardcodedPaths: 1, hardcodedEmails: 1, hardcodedSecrets: 1, hosts: ["api.example.org"], dbProviders: ["System.Data.SqlClient"] });
    const out = JSON.stringify(analyzePackage(pkg({ "Main.xaml": act(body, members) })));
    for (const leak of ["hunter2", "s3cret", "boss@example.org", "C:\\\\Data", "token=abc", "/v1/things", "title='*C*'", "webctrl id='user'", "Server=db"]) expect(out, leak).not.toContain(leak);
    expect(out).toContain("tn3270.exe"); // app targets are structural facts
  });
  it("is deterministic", () => { const p = pkg({ "Main.xaml": act(body, members) }); expect(JSON.stringify(analyzePackage(p))).toBe(JSON.stringify(analyzePackage(p))); });
});

describe("hostile input", () => {
  const ok = act(`<Sequence DisplayName="x" />`);
  it("rejects DTDs and entity declarations (no entity expansion)", () => {
    for (const bad of [`<!DOCTYPE a [<!ENTITY x "y">]><Activity/>`, `<!ENTITY lol "lol"><Activity/>`]) expect(() => walkXml(bad, {})).toThrow(/not allowed/);
    expect(analyzePackage(pkg({ "Main.xaml": `<!DOCTYPE lolz [<!ENTITY lol "lol">]><Activity ${NS}><Sequence DisplayName="&lol;"/></Activity>` })).source.status).toBe("unreadable");
  });
  it("bounds XML depth and node count", () => {
    expect(() => walkXml("<a>".repeat(300) + "</a>".repeat(300), {}, { maxXmlDepth: 256, maxXmlNodes: 1e6, maxAttrLen: 1e5 })).toThrow(/depth/);
    expect(() => walkXml("<a>" + "<b/>".repeat(50) + "</a>", {}, { maxXmlDepth: 10, maxXmlNodes: 20, maxAttrLen: 1e5 })).toThrow(/node/);
  });
  it("rejects a zip bomb by real output size, even when the declared size lies", () => {
    const bomb = Buffer.alloc(12 * 1024 * 1024, 0x41);
    const honest = analyzePackage(pkg({}, [{ name: "content/Big.xaml", data: bomb }]));
    expect(honest.limits.hit.join()).toMatch(/entry_size|ratio/);
    const liar = analyzePackage(pkg({}, [{ name: "content/Lie.xaml", rawCompressed: deflateRawSync(bomb), lieUsize: 1000 }]));
    expect(liar.source.status).not.toBe("source_available"); expect(liar.workflows[0].parsed).toBe(false);
  });
  it("caps the number of entries", () => { expect(readZip(writeZip(Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.txt`, data: "x" }))), { maxEntries: 5 } as any).limit).toBe("entries"); });
  it("lists but never opens scripts, executables or assemblies (corrupt data inside them is irrelevant)", () => {
    const r = analyzePackage(pkg({ "Main.xaml": ok }, [{ name: "content/run.ps1", rawCompressed: Buffer.from("not deflate"), lieUsize: 5 }, { name: "content/tool.exe", data: "MZ" }, { name: "content/x.dll", data: "MZ" }, { name: "content/data.py", data: "import os; os.system('x')" }]));
    expect(r.source.status).toBe("source_available"); expect(r.embedded).toMatchObject({ scripts: 2, executables: 1, dlls: 1 });
  });
  it("ignores path-traversal names (nothing is ever written to disk)", () => {
    const r = analyzePackage(pkg({ "Main.xaml": ok }, [{ name: "../../etc/passwd", data: "x" }, { name: "content/..\\..\\evil.xaml", data: ok }]));
    expect(r.source.status).toBe("source_available");
  });
});
