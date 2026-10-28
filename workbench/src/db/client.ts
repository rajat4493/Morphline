import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

const MIGRATIONS = path.join(process.cwd(), "drizzle");

/** In-memory (tests) or file-backed (local dev) embedded Postgres. */
export async function createEmbeddedDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const db = drizzle(new PGlite(dataDir), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

export async function createPgDb(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const db = drizzle(new Pool({ connectionString: url }), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

const g = globalThis as unknown as { __morphlineDb?: Promise<Db> };

/** DATABASE_URL -> real Postgres. Otherwise embedded Postgres persisted in .data/pglite. */
export function getDb(): Promise<Db> {
  g.__morphlineDb ??= process.env.DATABASE_URL
    ? createPgDb(process.env.DATABASE_URL)
    : createEmbeddedDb(process.env.MORPHLINE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite"));
  return g.__morphlineDb;
}
