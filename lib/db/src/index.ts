import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const connectionString = process.env.DATABASE_URL;

// When DATABASE_URL points to localhost we're in local dev — no SSL needed.
// For any remote host (Replit, Neon, Supabase, etc.) enable SSL.
const isLocal =
  connectionString.includes("localhost") ||
  connectionString.includes("127.0.0.1");

export const pool = new Pool({
  connectionString,
  // Serverless: 1 connection per function instance to avoid pool exhaustion.
  // In development keep a larger pool for concurrent requests.
  max: process.env.NODE_ENV === "production" ? 1 : 10,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });

export * from "./schema";
