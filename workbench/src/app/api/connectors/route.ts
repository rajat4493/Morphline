import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/server";
import { connectorInput, createConnector, createDemoConnector } from "@/services/connectors";
import { handle } from "../_util";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { db, ctx } = await getContext();
    if (z.object({ demo: z.literal(true) }).safeParse(body).success) return NextResponse.json({ id: (await createDemoConnector(db, ctx)).id }, { status: 201 });
    return NextResponse.json({ id: (await createConnector(db, ctx, connectorInput.parse(body))).id }, { status: 201 });
  } catch (e) { return handle(e); }
}
