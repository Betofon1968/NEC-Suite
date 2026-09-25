import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { createFileStore } from './store/file.js';
import { createPgStore } from './store/pg.js';
import pg from 'pg';

const PASSWORD = 'owner-password-1';

// Small HTTP client that keeps its own cookies, like one browser.
function client(base) {
  let cookies = {};
  const call = async (method, url, body, { header = true, key } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(header ? { 'x-suite': '1' } : {}),
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        Cookie: Object.entries(cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; '),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (v) cookies[k] = v;
      else delete cookies[k];
    }
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : null };
  };
  return {
    get: (u, o) => call('GET', u, undefined, o),
    post: (u, b, o) => call('POST', u, b || {}, o),
    put: (u, b, o) => call('PUT', u, b || {}, o),
    del: (u) => call('DELETE', u, {}),
    forget: () => (cookies = {}),
  };
}

// An app calling the hub from its own server: no cookies, no x-suite header.
function appClient(base, key) {
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : null };
  };
  return { get: (u, h) => call('GET', u, undefined, h), put: (u, b) => call('PUT', u, b) };
}

async function startServer(store) {
  const app = await createApp({ store, ownerPassword: PASSWORD });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function suite(makeStore) {
  let dir;
  let store;
  let server;
  let base;
  let owner;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'suite-test-'));
    store = await makeStore(dir);
    ({ server, base } = await startServer(store));
    owner = client(base);
    const login = await owner.post('/api/login', { email: 'owner', password: PASSWORD });
    expect(login.status).toBe(200);
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    await store.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const connect = async (name, scopes) => {
    const r = await owner.post('/api/connections', { name, scopes });
    expect(r.status).toBe(200);
    return { id: r.body.id, key: r.body.key, app: appClient(base, r.body.key) };
  };

  it('needs a sign in and shows the default apps', async () => {
    const guest = client(base);
    expect((await guest.get('/api/overview')).status).toBe(401);
    expect((await guest.post('/api/login', { email: 'owner', password: 'wrong' })).status).toBe(401);
    const o = await owner.get('/api/overview');
    expect(o.body.apps.map((a) => a.name)).toContain('NEC Trucking Compliance');
    expect((await owner.post('/api/logout', {}, { header: false })).status).toBe(403);
  });

  it('only accepts web addresses for apps', async () => {
    const bad = await owner.post('/api/apps', { name: 'Evil', url: 'javascript:alert(1)' });
    expect(bad.status).toBe(400);
    const good = await owner.post('/api/apps', { name: 'Motive', url: 'https://app.gomotive.com', icon: '📍', color: 'green' });
    expect(good.status).toBe(200);
  });

  it('staff see only the apps given to them and no admin screens', async () => {
    const apps = (await owner.get('/api/overview')).body.apps;
    const nec = apps.find((a) => a.name === 'NEC Trucking Compliance');
    const add = await owner.post('/api/users', {
      name: 'Maria Lopez',
      email: 'maria@example.com',
      password: 'long-password-1',
      role: 'staff',
      apps: [nec.id],
    });
    expect(add.status).toBe(200);
    const maria = client(base);
    expect((await maria.post('/api/login', { email: 'maria@example.com', password: 'long-password-1' })).status).toBe(200);
    const o = await maria.get('/api/overview');
    expect(o.body.apps.map((a) => a.name)).toEqual(['NEC Trucking Compliance']);
    expect(o.body.connections).toEqual([]);
    expect((await maria.post('/api/connections', { name: 'X', scopes: ['drivers:read'] })).status).toBe(403);
    expect((await maria.get('/api/users')).status).toBe(403);
    // Turning the login off signs her out.
    await owner.put(`/api/users/${add.body.user.id}`, { active: false });
    expect((await maria.get('/api/overview')).status).toBe(401);
  });

  it('apps exchange drivers through the hub with their own keys', async () => {
    const tms = await connect('TMS Truck', ['drivers:write', 'drivers:read', 'equipment:write', 'equipment:read']);
    const nec = await connect('NEC Compliance', ['drivers:write', 'qualification:write']);
    expect(tms.key).toMatch(/^suite_[a-f0-9]{16}_/);

    expect((await appClient(base, null).get('/api/hub/v1/drivers')).status).toBe(401);
    expect((await appClient(base, `${tms.key}x`).get('/api/hub/v1/drivers')).status).toBe(401);
    expect((await tms.app.get('/api/hub/v1/me')).body.connection).toBe('TMS Truck');

    const sent = await tms.app.put('/api/hub/v1/drivers', {
      drivers: [
        { externalId: 'd1', firstName: 'Jose', lastName: 'Rivera', phone: '(973) 555 0101', licenseNumber: 'R1234 56789', birthDate: '1984-05-12' },
        { externalId: 'd2', firstName: 'Kevin', lastName: 'Brown', phone: '(973) 555 0102' },
      ],
    });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ added: 2, ignoredFields: ['birthDate', 'licenseNumber'] });

    // The compliance app may send qualification, but may not read.
    expect((await nec.app.get('/api/hub/v1/drivers')).status).toBe(403);
    const q = await nec.app.put('/api/hub/v1/drivers', {
      drivers: [{ externalId: 'E-1', name: 'Jose Rivera', phone: '9735550101', qualificationStatus: 'disqualified', medicalExpiry: '2027-01-15' }],
    });
    expect(q.body).toMatchObject({ added: 1 });

    const read = await tms.app.get('/api/hub/v1/drivers');
    expect(read.status).toBe(200);
    const jose = read.body.drivers.find((d) => d.yourId === 'd1');
    expect(jose.qualification.status).toBe('disqualified');
    expect(jose.medicalExpiry).toBe('2027-01-15');
    expect(jose.apps.sort()).toEqual(['NEC Compliance', 'TMS Truck']);
    expect(JSON.stringify(read.body)).not.toContain('R1234');

    // Nothing changed since the last read.
    const etag = read.headers.get('etag');
    expect((await tms.app.get('/api/hub/v1/drivers', { 'If-None-Match': etag })).status).toBe(304);

    // The same list again changes nothing.
    const before = (await owner.get('/api/version')).body.version;
    await nec.app.put('/api/hub/v1/drivers', {
      drivers: [{ externalId: 'E-1', name: 'Jose Rivera', phone: '9735550101', qualificationStatus: 'disqualified', medicalExpiry: '2027-01-15' }],
    });
    expect((await owner.get('/api/version')).body.version).toBe(before);

    const o = await owner.get('/api/overview');
    const row = o.body.drivers.find((d) => d.name === 'Jose Rivera');
    expect(row.alerts.map((a) => a.text)).toContain('Disqualified, may not drive');
    expect(o.body.connections.find((c) => c.name === 'TMS Truck').lastSync.drivers.added).toBe(2);
    expect(o.body.connections[0].keyHash).toBeUndefined();
  });

  it('a new key stops the old one, and turning a connection off blocks it', async () => {
    const tms = await connect('TMS Truck', ['drivers:read']);
    const rotated = await owner.post(`/api/connections/${tms.id}/key`);
    expect((await tms.app.get('/api/hub/v1/me')).status).toBe(401);
    const fresh = appClient(base, rotated.body.key);
    expect((await fresh.get('/api/hub/v1/me')).status).toBe(200);
    await owner.put(`/api/connections/${tms.id}`, { active: false });
    expect((await fresh.get('/api/hub/v1/me')).status).toBe(401);
  });

  it('removing a connection removes what it sent; join and separate by hand', async () => {
    const a = await connect('App A', ['equipment:write']);
    const b = await connect('App B', ['equipment:write']);
    await a.app.put('/api/hub/v1/equipment', { equipment: [{ externalId: '1', kind: 'truck', unit: '101' }] });
    await b.app.put('/api/hub/v1/equipment', { equipment: [{ externalId: 'x', kind: 'truck', unit: 'T-101' }] });
    let eq = (await owner.get('/api/overview')).body.equipment;
    expect(eq).toHaveLength(2);
    expect((await owner.post('/api/equipment/merge', { from: eq[1].id, into: eq[0].id })).status).toBe(200);
    eq = (await owner.get('/api/overview')).body.equipment;
    expect(eq).toHaveLength(1);
    const recordId = eq[0].sources[0].recordId;
    expect((await owner.post('/api/equipment/split', { recordId })).status).toBe(200);
    expect((await owner.get('/api/overview')).body.equipment).toHaveLength(2);
    await owner.del(`/api/connections/${b.id}`);
    expect((await owner.get('/api/overview')).body.equipment).toHaveLength(1);
  });

  it('keeps data after a restart', async () => {
    const a = await connect('App A', ['drivers:write']);
    await a.app.put('/api/hub/v1/drivers', { drivers: [{ externalId: '1', name: 'Tanya Wells' }] });
    await new Promise((r) => server.close(r));
    ({ server, base } = await startServer(store));
    owner = client(base);
    await owner.post('/api/login', { email: 'owner', password: PASSWORD });
    expect((await owner.get('/api/overview')).body.drivers.map((d) => d.name)).toEqual(['Tanya Wells']);
    expect((await appClient(base, a.key).get('/api/hub/v1/me')).status).toBe(200);
  });
}

describe('server with local folder storage', () => suite((dir) => createFileStore(dir)));

describe.skipIf(!process.env.TEST_DATABASE_URL)('server with PostgreSQL', () =>
  suite(async () => {
    // Every test starts from an empty database.
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await pool.query('drop table if exists suite_state, suite_sessions, suite_users');
    await pool.end();
    return createPgStore(process.env.TEST_DATABASE_URL);
  }),
);
