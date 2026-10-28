import { NextResponse } from "next/server";
import { getContext } from "@/lib/server";
import { testConnector } from "@/services/connectors";
import { bad, handle } from "../../../_util";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const { db, ctx } = await getContext();
    const r = await testConnector(db, ctx, params.id);
    return r ? NextResponse.json(r) : bad("Connector not found", 404);
  } catch (e) { return handle(e); }
}
