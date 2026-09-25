// Cloud storage: PostgreSQL. The hub state (apps, connections, shared drivers and
// equipment) is one versioned JSON document; sessions and users have their own tables.
// Table names start with suite_ so the suite can share a database with another app.
import pg from 'pg';

const SCHEMA = `
create table if not exists suite_state (
  id int primary key default 1,
  version int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists suite_sessions (
  token_hash text primary key,
  user_id text,
  data jsonb not null
);
create index if not exists suite_sessions_user on suite_sessions (user_id);
create table if not exists suite_users (
  id text primary key,
  data jsonb not null
);
`;

// On Supabase, tables in the public schema are also served by its web API to anyone who
// has the project's public key (it is inside every web app). Row Level Security with no
// rules closes that door. This server connects as the owner of the tables, so it is not
// affected. On other PostgreSQL hosts these lines change nothing.
const lockTables = (tables) => `
${tables.map((t) => `alter table ${t} enable row level security;`).join('\n')}
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on ${tables.join(', ')} from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on ${tables.join(', ')} from authenticated;
  end if;
end $$;
`;

export async function createPgStore(connectionString, { ssl = false } = {}) {
  const pool = new pg.Pool({ connectionString, ssl: ssl ? { rejectUnauthorized: false } : undefined, max: 5 });
  await pool.query(SCHEMA);
  await pool.query(lockTables(['suite_state', 'suite_sessions', 'suite_users']));
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0] || null;

  return {
    kind: 'postgres',
    async getState() {
      const row = await one('select version, data from suite_state where id = 1');
      return row ? { version: row.version, data: row.data } : null;
    },
    async saveState(version, data) {
      await pool.query(
        `insert into suite_state (id, version, data, updated_at) values (1, $1, $2, now())
         on conflict (id) do update set version = excluded.version, data = excluded.data, updated_at = now()`,
        [version, JSON.stringify(data)],
      );
    },
    async getSession(hash) {
      return (await one('select data from suite_sessions where token_hash = $1', [hash]))?.data || null;
    },
    async putSession(hash, session) {
      await pool.query(
        `insert into suite_sessions (token_hash, user_id, data) values ($1, $2, $3)
         on conflict (token_hash) do update set user_id = excluded.user_id, data = excluded.data`,
        [hash, session.userId || null, JSON.stringify(session)],
      );
    },
    async deleteSession(hash) {
      await pool.query('delete from suite_sessions where token_hash = $1', [hash]);
    },
    async deleteUserSessions(userId) {
      await pool.query('delete from suite_sessions where user_id = $1', [userId]);
    },
    async listUsers() {
      return (await pool.query('select data from suite_users')).rows.map((r) => r.data);
    },
    async getUser(id) {
      return (await one('select data from suite_users where id = $1', [id]))?.data || null;
    },
    async setUser(id, user) {
      await pool.query(
        `insert into suite_users (id, data) values ($1, $2)
         on conflict (id) do update set data = excluded.data`,
        [id, JSON.stringify(user)],
      );
    },
    async deleteUser(id) {
      await pool.query('delete from suite_users where id = $1', [id]);
    },
    async close() {
      await pool.end();
    },
  };
}
