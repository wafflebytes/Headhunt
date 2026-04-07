import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const dbClientPropertyName = `__prevent-name-collision__db`;
type GlobalThisWithDbClient = typeof globalThis & {
  [dbClientPropertyName]: any;
};

function createDbClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not defined');
  }

  if (process.env.NODE_ENV === 'production') {
    const client = postgres(databaseUrl);
    return drizzle(client);
  }

  const newGlobalThis = globalThis as GlobalThisWithDbClient;
  if (!newGlobalThis[dbClientPropertyName]) {
    const client = postgres(databaseUrl);
    newGlobalThis[dbClientPropertyName] = drizzle(client);
  }
  return newGlobalThis[dbClientPropertyName];
}

function getDbClient() {
  return createDbClient();
}

// Lazily resolves the DB client so missing DATABASE_URL doesn't crash unrelated routes at import-time.
// Accessing any property on `db` will still throw a clear error.
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    const real = getDbClient() as any;
    const value = real[prop as any];
    return typeof value === 'function' ? value.bind(real) : value;
  },
});
