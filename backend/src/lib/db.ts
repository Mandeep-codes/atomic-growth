import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";
import { env } from "./env";

const connection = mysql.createPool({
  uri: env.DATABASE_URL,
});

const globalForDb = globalThis as unknown as {
  db: typeof db | undefined;
};

export const db = drizzle(connection, { schema, mode: "default" });

if (env.NODE_ENV !== "production") globalForDb.db = db;
