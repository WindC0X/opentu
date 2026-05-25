import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    prepare: false,
  });
  const db = drizzle(client, { schema });
  return { client, db };
}
