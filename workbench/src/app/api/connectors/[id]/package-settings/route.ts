import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/server";
import { updatePackageSettings } from "@/services/package-analysis";
import { bad, handle } from "../../../_util";

const Body = z.object({ enabled: z.boolean(), permissionConfirmed: z.boolean(), retainRaw: z.boolean() }).strict()
  .refine((v) => !v.enabled || v.permissionConfirmed, { message: "Confirm that the token holds the Packages.View permission before enabling package analysis", path: ["permissionConfirmed"] });

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const input = Body.parse(await req.json());
    const { db, ctx } = await getContext();
    const row = await updatePackageSettings(db, ctx, z.string().uuid().parse(params.id), input);
    return row ? NextResponse.json({ ok: true, enabled: row.packageAnalysisEnabled, retainRaw: row.packageRetainRaw }) : bad("Connector not found", 404);
  } catch (e) { return handle(e); }
}
