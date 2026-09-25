// Starts the suite server. Settings come from environment variables:
//   PORT              port to listen on (default 3002)
//   DATABASE_URL      PostgreSQL connection string; without it data is kept in DATA_DIR
//   DATABASE_SSL      "true" when the database requires SSL (automatic for Supabase)
//   DATA_DIR          folder for local data (default ./data)
//   SUITE_PASSWORD    password of the owner login (required in production)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createFileStore } from './store/file.js';
import { createPgStore } from './store/pg.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3002;

let ownerPassword = process.env.SUITE_PASSWORD;
if (!ownerPassword || ownerPassword.length < 8) {
  if (production) {
    console.error('Set SUITE_PASSWORD (at least 8 characters) before starting in production.');
    process.exit(1);
  }
  ownerPassword = ownerPassword || 'suite123';
  console.warn(`Owner password for local use: ${ownerPassword}  (set SUITE_PASSWORD to change it)`);
}

const store = process.env.DATABASE_URL
  ? await createPgStore(process.env.DATABASE_URL, {
      ssl: process.env.DATABASE_SSL === 'true' || /supabase\.(co|com)\b/.test(process.env.DATABASE_URL),
    })
  : await createFileStore(path.resolve(root, process.env.DATA_DIR || 'data'));

const app = await createApp({
  store,
  ownerPassword,
  secureCookies: production && process.env.COOKIE_SECURE !== 'false',
  distDir: path.join(root, 'dist'),
  log: (err) => console.error(err),
});

const server = app.listen(port, () => {
  console.log(`NEC Suite server on http://localhost:${port} using ${store.kind} storage`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => store.close().finally(() => process.exit(0)));
  });
}
