import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/server";
import { narratorFromEnv } from "@/plan/narrator";
import { createPlan } from "@/services/plans";
import { bad, handle } from "../../../_util";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const id = z.string().uuid().parse(params.id);
    const { db, ctx } = await getContext();
    const plan = await createPlan(db, ctx, id, narratorFromEnv());
    return plan ? NextResponse.json({ planId: plan.id }, { status: 201 }) : bad("Process not found", 404);
  } catch (e) { return handle(e); }
}
