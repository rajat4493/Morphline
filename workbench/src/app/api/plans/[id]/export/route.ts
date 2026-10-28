import { z } from "zod";
import { getContext } from "@/lib/server";
import { planToHtml, planToMarkdown } from "@/plan/export";
import { getPlan } from "@/services/plans";
import { bad, handle } from "../../../_util";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = z.string().uuid().parse(params.id);
    const format = z.enum(["md", "html"]).default("md").parse(new URL(req.url).searchParams.get("format") ?? "md");
    const { db, ctx } = await getContext();
    const plan = await getPlan(db, ctx, id);
    if (!plan) return bad("Plan not found", 404);
    const safe = plan.content.processName.replace(/[^A-Za-z0-9_-]/g, "_");
    const body = format === "md" ? planToMarkdown(plan.content, plan.narrative) : planToHtml(plan.content, plan.narrative);
    return new Response(body, { headers: { "content-type": format === "md" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8", "content-disposition": `attachment; filename="migration-plan-${safe}.${format}"` } });
  } catch (e) { return handle(e); }
}
