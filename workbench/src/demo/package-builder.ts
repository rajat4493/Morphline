import { writeZip, type ZipEntry } from "./zip-writer";

/** DEMO DATA ONLY: synthetic UiPath-style packages that go with the simulated Orchestrator. Their XAML is hand-written to tell a story
 *  per demo process; it is not exported from any real project. Some literals (a path, an email address, an endpoint host) are included
 *  on purpose so tests can prove they are never persisted. */
const NS = `xmlns="http://schemas.microsoft.com/netfx/2009/xaml/activities" xmlns:ui="http://schemas.uipath.com/workflow/activities" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:scg="clr-namespace:System.Collections.Generic;assembly=mscorlib"`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attrs = (a: Record<string, string>) => Object.entries(a).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
const el = (tag: string, a: Record<string, string> = {}, ...kids: string[]) => (kids.length ? `<${tag} ${attrs(a)}>${kids.join("")}</${tag}>` : `<${tag} ${attrs(a)} />`);
const seq = (dn: string, ...k: string[]) => el("Sequence", { DisplayName: dn }, ...k);
const click = (dn: string, selector: string, extra: Record<string, string> = {}) => el("ui:Click", { DisplayName: dn, Selector: selector, ...extra });
const wf = (name: string, args: [string, string][], body: string) => `<Activity ${NS} x:Class="${name}"><x:Members>${args.map(([n, t]) => `<x:Property Name="${n}" Type="${t}" />`).join("")}</x:Members>${body}</Activity>`;
const CONFIG: [string, string] = ["in_Config", "InArgument(scg:Dictionary(x:String, x:Object))"];
const invoke = (file: string) => el("ui:InvokeWorkflowFile", { DisplayName: `Invoke ${file}`, WorkflowFileName: file });
const tryCatch = (body: string) => el("TryCatch", { DisplayName: "Try Catch" }, body, el("Catch", { "x:TypeArguments": "s:Exception" }, el("ui:LogMessage", { DisplayName: "Log error", Message: "failed" })));

type Mode = "source" | "compiled" | "garbled";
type Bp = { mode: Mode; files: Record<string, string>; deps: Record<string, string> };

const DEPS = { "UiPath.System.Activities": "[23.10.5]", "UiPath.UIAutomation.Activities": "[23.10.12]" };

function blueprint(name: string, vi: number, last: boolean): Bp {
  switch (name) {
    case "Invoice_Portal_Download": return { mode: "source", deps: DEPS, files: {
      "Main.xaml": wf("Main", [CONFIG], seq("Main", el("ui:GetRobotCredential", { DisplayName: "Get portal login", AssetName: "Portal_Login" }), invoke("Download.xaml"))),
      "Download.xaml": wf("Download", [CONFIG], seq("Download", el("ui:OpenBrowser", { DisplayName: "Open portal", Url: "https://portal.supplier.example/login" }), click("Open invoices", "<html app='chrome.exe' title='Supplier Portal' /><webctrl id='invoicesTab' tag='A' />"),
        el("ForEach", { DisplayName: "For each invoice" }, last ? el("RetryScope", { DisplayName: "Retry download", NumberOfRetries: "3" }, click("Download", `<html app='chrome.exe' /><webctrl id='dl${vi === 0 ? "Old" : "Btn"}' tag='A' />`)) : click("Download", "<html app='chrome.exe' /><webctrl id='dlOld' tag='A' />")))) } };
    case "Invoice_Data_Extraction": return { mode: "source", deps: { ...DEPS, "UiPath.PDF.Activities": "[23.10.2]", "UiPath.Mail.Activities": "[1.22.1]" }, files: {
      "Main.xaml": wf("Main", [CONFIG], seq("Main", el("ui:GetRobotAsset", { DisplayName: "Get endpoint", AssetName: "DocUnderstanding_ApiEndpoint" }), el("ui:GetRobotCredential", { DisplayName: "Get API key", AssetName: '[in_Config("CredentialAsset").ToString]' }), tryCatch(invoke("Process.xaml")))),
      "Process.xaml": wf("Process", [CONFIG, ["in_TransactionItem", "InArgument(x:Object)"], ["out_Status", "OutArgument(x:String)"]], seq("Process", el("ui:GetTransactionItem", { DisplayName: "Get item", QueueType: '[in_Config("OrchestratorQueueName").ToString]' }),
        el("ui:ReadPDFText", { DisplayName: "Read PDF", FileName: "invoice.pdf" }), el("HttpClient", { DisplayName: "Call extraction API", EndPoint: "https://api.invoice-ocr.example/v2/extract" }),
        el("If", { DisplayName: "Layout known?" }), el("If", { DisplayName: "Total matches PO?" }), el("Throw", { DisplayName: "Business rule", Exception: "[New BusinessRuleException(\"Supplier not found\")]" }),
        el("ui:SendMail", { DisplayName: "Notify AP", To: "ap-team@corp.example", Subject: "Exception" }), ...(vi === 0 ? [] : [invoke("Extract.xaml")]))),
      ...(vi === 0 ? {} : { "Extract.xaml": wf("Extract", [CONFIG], seq("Extract", el("ui:DigitizeDocument", { DisplayName: "Digitize" }), el("ui:ExtractDocumentData", { DisplayName: "Extract fields" }))) }) } };
    case "ServiceDesk_Ticket_Triage": return { mode: "source", deps: { ...DEPS, "UiPath.Mail.Activities": "[1.22.1]" }, files: {
      "Main.xaml": wf("Main", [CONFIG], seq("Main", el("ForEach", { DisplayName: "For each ticket" }, invoke("Classify.xaml")), tryCatch(el("ui:RetryScope", { DisplayName: "Retry", NumberOfRetries: "2" }, invoke("Dispatch.xaml"))))),
      "Classify.xaml": wf("Classify", [CONFIG, ["in_Text", "InArgument(x:String)"], ["out_Category", "OutArgument(x:String)"]], seq("Classify", ...Array.from({ length: 9 }, (_, i) => el("If", { DisplayName: `Rule ${i + 1}` })), el("Switch", { DisplayName: "Category" }), el("Throw", { DisplayName: "Unknown", Exception: "[New BusinessRuleException(\"unknown\")]" }))),
      "Dispatch.xaml": wf("Dispatch", [CONFIG], seq("Dispatch", el("ui:AddQueueItem", { DisplayName: "To resets", QueueName: "PasswordResets" }), el("ui:AddQueueItem", { DisplayName: "To access", QueueName: "AccessRequests" }),
        el("ui:InvokeProcess", { DisplayName: "Urgent reset", ProcessName: "ServiceDesk_PasswordReset" }), el("ui:SendMail", { DisplayName: "Escalate", To: "servicedesk-leads@corp.example" }))) } };
    case "ServiceDesk_PasswordReset": return { mode: "source", deps: DEPS, files: { "Main.xaml": wf("Main", [CONFIG], seq("Main", el("ui:GetTransactionItem", { DisplayName: "Get item", QueueType: "PasswordResets" }), el("HttpClient", { DisplayName: "Reset in AD", EndPoint: "https://ad-gateway.corp.example/reset" }), el("ui:SetTransactionStatus", { DisplayName: "Done" }))) } };
    case "ServiceDesk_AccessProvisioning": return { mode: "garbled", deps: DEPS, files: { "Main.xaml": "\u0000\u0001\u0002 binary payload without markup \u0003" } };
    case "Claims_Legacy_Mainframe_Update": return { mode: "source", deps: { ...DEPS, "UiPath.UIAutomation.Activities": last ? "[23.10.12]" : "[22.10.4]" }, files: {
      "Main.xaml": wf("Main", [CONFIG], seq("Main", ...Array.from({ length: 24 }, (_, i) => click(`Field ${i + 1}`, `<wnd app='tn3270.exe' title='*CLAIMS*' /><ctrl idx='${3 + i + vi * 40}' />`, i % 3 === 0 ? { ContinueOnError: "True" } : {})),
        ...Array.from({ length: 3 }, (_, i) => el("ui:ClickImage", { DisplayName: `Image ${i + 1}` })), el("ui:SendHotkey", { DisplayName: "Enter", Key: "enter" }))) } };
    case "Weekly_Sales_Report": return { mode: "source", deps: { "UiPath.Excel.Activities": "[2.22.2]", "UiPath.Mail.Activities": "[1.22.1]" }, files: {
      "Main.xaml": wf("Main", [], seq("Main", el("ui:ReadRange", { DisplayName: "Read sales", WorkbookPath: "C:\\Reports\\sales.xlsx", SheetName: "Data" }), el("ui:WriteRange", { DisplayName: "Write summary", WorkbookPath: "C:\\Reports\\summary.xlsx" }), el("ui:SendOutlookMail", { DisplayName: "Send", To: "managers@corp.example" }))) } };
    case "Weekly_Sales_Report_Copy": return { mode: "source", deps: { "UiPath.Excel.Activities": "[2.22.2]" }, files: { "Main.xaml": wf("Main", [], seq("Main", el("ui:ReadRange", { DisplayName: "Read sales", WorkbookPath: "C:\\Reports\\sales.xlsx" }))) } };
    case "Customer_Email_Classifier": return { mode: "compiled", deps: DEPS, files: {} };
    default: return { mode: "source", deps: DEPS, files: { "Main.xaml": wf("Main", [], seq("Main")) } };
  }
}

/** versions: the process's known versions, oldest first. */
export function buildDemoPackage(processName: string, packageId: string, version: string, versions: string[]): Buffer {
  const vi = Math.max(0, versions.indexOf(version)), last = vi === versions.length - 1;
  const bp = blueprint(processName, vi, last);
  const entries: ZipEntry[] = [
    { name: `${packageId}.nuspec`, data: `<?xml version="1.0"?><package><metadata><id>${packageId}</id><version>${version}</version></metadata></package>` },
    { name: "content/project.json", data: JSON.stringify({ name: packageId, main: "Main.xaml", projectType: "Workflow", expressionLanguage: "VisualBasic", studioVersion: "23.10.4.0", dependencies: bp.deps, entryPoints: [{ filePath: "Main.xaml" }] }) },
    { name: "[Content_Types].xml", data: "<Types/>" },
  ];
  if (bp.mode === "compiled") entries.push({ name: `lib/net6.0-windows7.0/${packageId}.dll`, data: Buffer.from("MZ\u0090\u0000 not a real assembly; never read by the analyzer") });
  for (const [f, text] of Object.entries(bp.files)) entries.push({ name: `content/${f}`, data: text });
  return writeZip(entries);
}
