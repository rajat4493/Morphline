import { NextResponse } from "next/server";
import { getContext } from "@/lib/server";
import { runImport } from "@/services/import";
import { handle } from "../../../_util";

export const maxDuration = 300;
export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const { db, ctx } = await getContext();
    return NextResponse.json(await runImport(db, ctx, params.id));
  } catch (e) { return handle(e); }
}
