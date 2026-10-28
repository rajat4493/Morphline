/** Seeds the demo tenant: creates the simulated connector and runs a full import.
 *  Stop the dev server first when using the embedded database (single-process file lock). */
import { getDb } from "../src/db/client";
import { createDemoConnector } from "../src/services/connectors";
import { runImport } from "../src/services/import";
import { resolveTenant } from "../src/lib/tenant";

const db = await getDb();
const ctx = await resolveTenant(db);
const connector = await createDemoConnector(db, ctx);
const r = await runImport(db, ctx, connector.id);
console.log(`import ${r.status}`, r.counts, r.errors);
process.exit(r.status === "failed" ? 1 : 0);
