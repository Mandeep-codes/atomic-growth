import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";

// Reconciles drift between drizzle-orm's expected migration hash format and
// what's actually in __drizzle_migrations.
//
// Why this exists: older drizzle-kit versions stored the migration TAG
// (e.g. "0000_perpetual_darkstar") in the hash column instead of a sha256.
// Newer drizzle-orm migrators compute sha256 of the SQL file and look for
// that exact value — so any tag-based entry is invisible to the migrator,
// which assumes the migration is unapplied and tries to run it again. The
// re-run hits `CREATE TABLE balance_entries` against an already-existing
// table and crashes startup.
//
// This function runs ONCE at boot, BEFORE drizzle's migrator. For every
// journal entry it does the following:
//   1. Compute the expected sha256 of the .sql file.
//   2. If a row with that sha256 already exists → no action.
//   3. Else if a row with hash = `<tag>` exists (legacy format) → UPDATE
//      that row to hold the sha256.
//   4. Else → leave it alone; drizzle's migrator will apply it normally.
//
// The function is idempotent and safe to run on every boot: on a clean DB
// it does nothing (no rows match either lookup), on a legacy-drift DB it
// rewrites the one bad hash, and on a fully-migrated modern DB it's a no-op.
export async function reconcileLegacyDrizzleMigrations(
  db: MySql2Database<any>,
  migrationsFolder: string
): Promise<void> {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) return;

  const tableExists = await tableExistsByName(db, "__drizzle_migrations");
  if (!tableExists) return; // First-ever boot; drizzle's migrator will create it.

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };

  let fixed = 0;
  for (const entry of journal.entries) {
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) continue;
    const sqlContent = fs.readFileSync(sqlPath, "utf8");
    const expectedHash = crypto
      .createHash("sha256")
      .update(sqlContent)
      .digest("hex");

    const [withHash] = await db.execute<{ id: number }>(
      sql.raw(
        `SELECT id FROM __drizzle_migrations WHERE hash = '${expectedHash}' LIMIT 1`
      )
    );
    if (Array.isArray(withHash) && withHash.length > 0) continue;

    const [withTag] = await db.execute<{ id: number }>(
      sql.raw(
        `SELECT id FROM __drizzle_migrations WHERE hash = ${escapeSqlString(entry.tag)} LIMIT 1`
      )
    );
    if (Array.isArray(withTag) && withTag.length > 0) {
      await db.execute(
        sql.raw(
          `UPDATE __drizzle_migrations SET hash = '${expectedHash}' WHERE id = ${(withTag[0] as { id: number }).id}`
        )
      );
      fixed += 1;
      console.log(
        `  ↻ baseline-reconciled migration ${entry.tag} (legacy tag → sha256)`
      );
    }
  }

  if (fixed > 0) {
    console.log(`📚 baseline reconciled ${fixed} legacy migration entr${fixed === 1 ? "y" : "ies"}`);
  }
}

async function tableExistsByName(
  db: MySql2Database<any>,
  name: string
): Promise<boolean> {
  const [rows] = await db.execute(
    sql.raw(`SHOW TABLES LIKE ${escapeSqlString(name)}`)
  );
  return Array.isArray(rows) && rows.length > 0;
}

function escapeSqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
