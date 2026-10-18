import { Pool } from "pg";
import dotenv from "dotenv";
import { applyMigrations } from "./migrations.js";

dotenv.config({ path: process.env.ENV_FILE ?? "./src/.env" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL must be set before running database migrations.");
}

const pool = new Pool({ connectionString });
try {
  await applyMigrations(pool);
} finally {
  await pool.end();
}
