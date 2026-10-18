import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const MIGRATION_DIRECTORY = fileURLToPath(new URL("./migrations/", import.meta.url));
const MIGRATION_LOCK_ID = 7_391_024;

export async function applyMigrations(
  pool: Pool,
  directory = MIGRATION_DIRECTORY
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(directory))
      .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name))
      .sort();

    for (const name of files) {
      const alreadyApplied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = $1",
        [name]
      );
      if (alreadyApplied.rowCount) continue;

      const sql = await readFile(join(directory, name), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
        console.log(`[database] Applied migration ${name}.`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Failed to apply migration ${name}.`, { cause: error });
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    } finally {
      client.release();
    }
  }
}
