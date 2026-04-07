import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import dotenv from 'dotenv';

const MIGRATIONS_FOLDER = 'src/lib/db/migrations';

type SqlClient = postgres.Sql;

async function ensureMigrationsTable(sql: SqlClient) {
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;
}

async function getMigrationRowCount(sql: SqlClient): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text as count
    FROM drizzle.__drizzle_migrations
  `;
  const parsed = Number.parseInt(rows[0]?.count ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getExistingMigrationHashes(sql: SqlClient): Promise<Set<string>> {
  const rows = await sql<{ hash: string }[]>`
    SELECT hash
    FROM drizzle.__drizzle_migrations
  `;
  return new Set(rows.map((row) => row.hash).filter(Boolean));
}

async function hasInitializedSchema(sql: SqlClient): Promise<boolean> {
  const rows = await sql<
    { applications: string | null; candidates: string | null; jobs: string | null; organizations: string | null; automationRuns: string | null; auditLogs: string | null }[]
  >`
    SELECT
      to_regclass('public.applications')::text as applications,
      to_regclass('public.candidates')::text as candidates,
      to_regclass('public.jobs')::text as jobs,
      to_regclass('public.organizations')::text as organizations,
      to_regclass('public.automation_runs')::text as automationRuns,
      to_regclass('public.audit_logs')::text as auditLogs
  `;

  const row = rows[0];
  const presentCount = [
    row?.applications,
    row?.candidates,
    row?.jobs,
    row?.organizations,
    row?.automationRuns,
    row?.auditLogs,
  ].filter(Boolean).length;

  // Require a strong signal that this DB has already been initialized.
  return presentCount >= 4;
}

async function baselineMissingMigrations(sql: SqlClient) {
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });

  if (migrations.length === 0) {
    return;
  }

  const existing = await getExistingMigrationHashes(sql);
  const missing = migrations.filter((entry) => !existing.has(entry.hash));

  if (missing.length === 0) {
    return;
  }

  await sql.begin(async (tx) => {
    for (const entry of missing) {
      await tx`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${entry.hash}, ${entry.folderMillis})
      `;
    }
  });
}

const runMigrate = async () => {
  dotenv.config({ path: '.env.local' });

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined');
  }

  const connection = postgres(process.env.DATABASE_URL, { max: 1 });

  const db = drizzle(connection);

  console.log('⏳ Running migrations...');

  // If the database already has tables (e.g. a reused docker volume) but the
  // Drizzle migration history is empty, `migrate()` will attempt to re-create
  // tables and fail with "relation already exists". In that case, baseline the
  // migration history from meta/_journal.json so future migrations can apply.
  await ensureMigrationsTable(connection);
  const [existingMigrationCount, isInitialized] = await Promise.all([
    getMigrationRowCount(connection),
    hasInitializedSchema(connection),
  ]);

  const journal = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });

  if (isInitialized && existingMigrationCount < journal.length) {
    console.log(
      `ℹ️  Detected initialized schema with ${existingMigrationCount}/${journal.length} migration entries; baselining missing migrations...`,
    );
    await baselineMissingMigrations(connection);
  }

  const start = Date.now();

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  const end = Date.now();

  console.log('✅ Migrations completed in', end - start, 'ms');

  process.exit(0);
};

runMigrate().catch((err) => {
  console.error('❌ Migration failed');
  console.error(err);
  process.exit(1);
});
