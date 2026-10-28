import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/server";
import { getConnectorRow, setSelectedFolders } from "@/services/connectors";
import { bad, handle } from "../../../_util";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const { folderSourceIds } = z.object({ folderSourceIds: z.array(z.string().max(64)).max(1000) }).parse(await req.json());
    const { db, ctx } = await getContext();
    if (!(await getConnectorRow(db, ctx, params.id))) return bad("Connector not found", 404);
    await setSelectedFolders(db, ctx, params.id, folderSourceIds);
    return NextResponse.json({ ok: true });
  } catch (e) { return handle(e); }
}
