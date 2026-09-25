import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createLimiter, hashSecret, newToken, parseCookies, sameSecret, tokenHash, verifySecret } from './auth.js';
import { HubError, SCOPES, driverView, emptyHub, equipmentView, mergeGroups, splitRecord, syncRecords, viewForApp } from '../src/lib/hub.js';
import { APP_COLORS, DEFAULT_APPS, cleanUrl } from '../src/lib/apps.js';

const COOKIE = 'suite_session';
const SESSION_DAYS = 30;
const MIN_PASSWORD = 10;
const ROLES = ['admin', 'staff'];
const COLLECTIONS = ['drivers', 'equipment'];
const MAX_ACTIVITY = 200;
// The built in account that signs in with SUITE_PASSWORD. It is always an admin, so the
// company can never be locked out of its own suite.
const OWNER = { id: 'owner', name: 'Owner', email: 'owner', role: 'admin', owner: true, active: true, apps: null };

const uid = () => crypto.randomBytes(8).toString('hex');
const KEY_PATTERN = /^suite_([a-f0-9]{16})_([A-Za-z0-9_-]{40,})$/;

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  active: u.active !== false,
  // null means every app on the home screen.
  apps: Array.isArray(u.apps) ? u.apps : null,
  owner: !!u.owner,
  createdAt: u.createdAt || null,
  lastLoginAt: u.lastLoginAt || null,
});

const publicConnection = (c, contact) => ({
  id: c.id,
  name: c.name,
  appId: c.appId || null,
  scopes: c.scopes,
  active: c.active !== false,
  keyHint: c.keyHint,
  createdAt: c.createdAt,
  createdBy: c.createdBy,
  keyCreatedAt: c.keyCreatedAt,
  lastSync: c.lastSync || {},
  lastContactAt: contact || c.lastContactAt || null,
});

function isValidState(data) {
  return !!data && ['apps', 'connections', 'drivers', 'equipment'].every((k) => Array.isArray(data[k]));
}

export async function createApp({ store, ownerPassword, secureCookies = false, distDir = null, log = () => {} }) {
  if (!ownerPassword) throw new Error('An owner password is required.');
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  let current = await store.getState();
  if (current && !isValidState(current.data)) throw new Error('Saved data could not be read.');
  if (!current) {
    const data = emptyHub();
    data.apps = DEFAULT_APPS.map((a, i) => ({ ...a, id: uid(), order: i, active: true }));
    current = { version: 1, data };
    await store.saveState(current.version, current.data);
  }

  // Changes run one at a time and are saved before the next one starts.
  let chain = Promise.resolve();
  const serialize = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
  const commit = async (data) => {
    current = { version: current.version + 1, data };
    await store.saveState(current.version, current.data);
    return current;
  };
  const withActivity = (data, by, text) => ({
    ...data,
    activity: [{ ts: new Date().toISOString(), by, text }, ...(data.activity || [])].slice(0, MAX_ACTIVITY),
  });
  // Runs a change; a HubError becomes a 400 answer with its message.
  const change = (res, fn) =>
    serialize(async () => {
      try {
        const next = await fn(current.data);
        if (next) await commit(next);
        return true;
      } catch (err) {
        if (err instanceof HubError) {
          res.status(400).json({ error: err.message });
          return false;
        }
        throw err;
      }
    });

  // Last time each app called the hub; kept in memory so a read does not rewrite the data.
  const contact = new Map();
  const names = () => Object.fromEntries(current.data.connections.map((c) => [c.id, c.name]));

  const passwordMark = crypto.createHash('sha256').update(`suite-owner:${ownerPassword}`).digest('hex').slice(0, 16);
  const loginLimiter = createLimiter({ max: 8, windowMs: 15 * 60 * 1000 });
  const keyLimiter = createLimiter({ max: 20, windowMs: 15 * 60 * 1000 });
  const dummyHash = hashSecret(newToken());

  const cookieOptions = (days) =>
    [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${days * 86400}`, secureCookies ? 'Secure' : ''].filter(Boolean).join('; ');
  const setCookie = (res, value) => res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; ${cookieOptions(SESSION_DAYS)}`);
  const clearCookie = (res) => res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies ? '; Secure' : ''}`);

  async function readSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const hash = tokenHash(token);
    const session = await store.getSession(hash);
    if (!session) return null;
    if (Date.parse(session.expiresAt) < Date.now()) {
      await store.deleteSession(hash);
      return null;
    }
    return { ...session, hash };
  }

  async function startSession(res, data) {
    const token = newToken();
    const session = { ...data, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString() };
    await store.putSession(tokenHash(token), session);
    setCookie(res, token);
  }

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'DENY');
    next();
  });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  /* ---------- Hub API for the connected apps ---------- */

  // Apps call the hub from their own server (never from a browser) with their key in the
  // Authorization header. Browsers do not send that header on their own, so these
  // endpoints need no cookie or form protection, and no other web address may call them.
  const hub = express.Router();
  hub.use(express.json({ limit: '8mb' }));
  hub.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const requireKey = (scope) =>
    wrap(async (req, res, next) => {
      if (keyLimiter.blocked(`key:${req.ip}`)) return res.status(429).json({ error: 'Too many attempts with a wrong key. Wait 15 minutes.' });
      const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
      const parts = m && KEY_PATTERN.exec(m[1]);
      const conn = parts && current.data.connections.find((c) => c.id === parts[1]);
      const ok =
        !!conn &&
        crypto.timingSafeEqual(Buffer.from(tokenHash(parts[2]), 'hex'), Buffer.from(conn.keyHash || tokenHash(''), 'hex')) &&
        conn.active !== false;
      if (!ok) {
        keyLimiter.fail(`key:${req.ip}`);
        return res.status(401).json({ error: 'The key is not valid or the connection is turned off.' });
      }
      if (scope && !conn.scopes.includes(scope))
        return res.status(403).json({ error: `This connection is not allowed to ${SCOPES[scope].toLowerCase()}.` });
      contact.set(conn.id, new Date().toISOString());
      req.connection = conn;
      next();
    });

  hub.get('/me', requireKey(null), (req, res) => {
    res.json({ connection: req.connection.name, scopes: req.connection.scopes, version: current.version });
  });

  for (const collection of COLLECTIONS) {
    hub.put(
      `/${collection}`,
      requireKey(`${collection}:write`),
      wrap(async (req, res) => {
        const conn = req.connection;
        let summary = null;
        const done = await change(res, (data) => {
          const connNow = data.connections.find((c) => c.id === conn.id);
          if (!connNow) throw new HubError('This connection was removed.');
          const result = syncRecords(data, connNow, collection, req.body?.[collection], { newId: uid });
          summary = result.summary;
          const lastSync = { at: new Date().toISOString(), ...summary };
          const changed = summary.added + summary.updated + summary.removed > 0;
          // Only a real change is saved; an app that sends the same list again leaves the data as it was.
          if (!changed && connNow.lastSync?.[collection]) return null;
          let next = {
            ...result.state,
            connections: result.state.connections.map((c) => (c.id === conn.id ? { ...c, lastSync: { ...c.lastSync, [collection]: lastSync } } : c)),
          };
          if (changed) {
            const what = collection === 'drivers' ? 'drivers' : 'trucks and trailers';
            next = withActivity(next, conn.name, `Sent ${what}: ${summary.added} new, ${summary.updated} changed, ${summary.removed} removed`);
          }
          return next;
        });
        if (done) res.json({ ok: true, version: current.version, ...summary });
      }),
    );

    hub.get(`/${collection}`, requireKey(`${collection}:read`), (req, res) => {
      const etag = `"${current.version}"`;
      res.set('ETag', etag);
      if (req.get('if-none-match') === etag) return res.status(304).end();
      const view = collection === 'drivers' ? driverView(current.data, { names: names() }) : equipmentView(current.data, { names: names() });
      res.json({ version: current.version, [collection]: viewForApp(view, req.connection.id, { all: req.query.all === '1' }) });
    });
  }

  hub.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api/hub/v1', hub);

  /* ---------- NEC Suite screens ---------- */

  app.use('/api', express.json({ limit: '1mb' }));
  // Browsers only send this custom header from our own pages, which blocks cross site form posts.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.get('x-suite') !== '1') return res.status(403).json({ error: 'Request blocked.' });
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.post(
    '/api/login',
    wrap(async (req, res) => {
      const email = String(req.body?.email ?? '')
        .trim()
        .toLowerCase();
      const password = String(req.body?.password || '');
      const keys = [`login:${req.ip}`, `user:${email}`];
      if (keys.some((k) => loginLimiter.blocked(k))) return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes and try again.' });
      let session = null;
      let user = null;
      if (email === 'owner') {
        if (sameSecret(password, ownerPassword)) session = { mark: passwordMark };
      } else {
        user = (await store.listUsers()).find((u) => u.email === email) || null;
        const ok = verifySecret(password, user ? user.passwordHash : dummyHash);
        if (ok && user.active !== false) session = { userId: user.id, userVersion: user.version };
      }
      if (!session) {
        keys.forEach((k) => loginLimiter.fail(k));
        return res.status(401).json({ error: 'Email or password is not correct.' });
      }
      keys.forEach((k) => loginLimiter.reset(k));
      if (user) await store.setUser(user.id, { ...user, lastLoginAt: new Date().toISOString() });
      await startSession(res, session);
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/logout',
    wrap(async (req, res) => {
      const s = await readSession(req);
      if (s) await store.deleteSession(s.hash);
      clearCookie(res);
      res.json({ ok: true });
    }),
  );

  // The signed in person, or null. A user is signed out everywhere when their password,
  // email or role changes or they are turned off; the owner when SUITE_PASSWORD changes.
  async function signedIn(req) {
    const s = await readSession(req);
    if (!s) return null;
    if (!s.userId) return s.mark === passwordMark ? { user: OWNER, session: s } : null;
    const u = await store.getUser(s.userId);
    if (!u || u.active === false || u.version !== s.userVersion) {
      await store.deleteSession(s.hash);
      return null;
    }
    return { user: publicUser(u), session: s };
  }

  const requireUser = wrap(async (req, res, next) => {
    const found = await signedIn(req);
    if (!found) return res.status(401).json({ error: 'Please sign in.' });
    req.user = found.user;
    next();
  });

  const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can do this.' });
    next();
  };

  const visibleApps = (user) =>
    current.data.apps
      .filter((a) => user.role === 'admin' || (a.active !== false && (user.apps === null || user.apps.includes(a.id))))
      .sort((a, b) => a.order - b.order);

  app.get('/api/me', requireUser, (req, res) => res.json({ user: req.user }));
  app.get('/api/version', requireUser, (req, res) => res.json({ version: current.version }));

  app.get('/api/overview', requireUser, (req, res) => {
    const admin = req.user.role === 'admin';
    const n = names();
    res.json({
      version: current.version,
      apps: visibleApps(req.user),
      drivers: driverView(current.data, { names: n }),
      equipment: equipmentView(current.data, { names: n }),
      connections: admin ? current.data.connections.map((c) => publicConnection(c, contact.get(c.id))) : [],
      activity: admin ? (current.data.activity || []).slice(0, 50) : [],
      scopes: SCOPES,
    });
  });

  /* ---------- Apps on the home screen (admin) ---------- */

  function checkApp(body, existing) {
    const name = String(body?.name ?? existing?.name ?? '').trim();
    const description = String(body?.description ?? existing?.description ?? '').trim();
    const url = cleanUrl(body?.url ?? existing?.url ?? '');
    const icon = String(body?.icon ?? existing?.icon ?? '').trim() || '▦';
    const color = String(body?.color ?? existing?.color ?? 'blue');
    if (!name) return { error: 'Name is required.' };
    if (name.length > 60) return { error: 'The name is too long.' };
    if (description.length > 160) return { error: 'The description is too long.' };
    if (url === null) return { error: 'The address must start with https:// (for example https://pbnewmans.com).' };
    if ([...icon].length > 4) return { error: 'Use one emoji or up to 4 letters for the icon.' };
    if (!APP_COLORS.includes(color)) return { error: 'Choose a color from the list.' };
    const active = body?.active === undefined ? existing?.active !== false : body.active !== false;
    return { name, description, url, icon, color, active };
  }

  app.post(
    '/api/apps',
    requireUser,
    requireAdmin,
    wrap(async (req, res) => {
      const v = checkApp(req.body, null);
      if (v.error) return res.status(400).json({ error: v.error });
      const done = await change(res, (data) => {
        const order = Math.max(-1, ...data.apps.map((a) => a.order)) + 1;
        return withActivity({ ...data, apps: [...data.apps, { ...v, id: uid(), order }] }, req.user.name, `Added the app ${v.name}`);
      });
      if (done) res.json({ ok: true });
    }),
  );

  app.put(
    '/api/apps/:id',
    requireUser,
    requireAdmin,
    wrap(async (req, res) => {
      const existing = current.data.apps.find((a) => a.id === req.params.id);
      if (!existing) return res.status(404).json({ error: 'App not found.' });
      const v = checkApp(req.body, existing);
      if (v.error) return res.status(400).json({ error: v.error });
      const done = await change(res, (data) => ({ ...data, apps: data.apps.map((a) => (a.id === existing.id ? { ...a, ...v } : a)) }));
      if (done) res.json({ ok: true });
    }),
  );

  app.post(
    '/api/apps/:id/move',
    requireUser,
    requireAdmin,
    wrap(async (req, res) => {
      const done = await change(res, (data) => {
        const list = [...data.apps].sort((a, b) => a.order - b.order);
        const i = list.findIndex((a) => a.id === req.params.id);
        const j = i + (req.body?.dir === 'up' ? -1 : 1);
        if (i < 0 || j < 0 || j >= list.length) return null;
        [list[i], list[j]] = [list[j], list[i]];
        return { ...data, apps: list.map((a, order) => ({ ...a, order })) };
      });
      if (done) res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/apps/:id',
    requireUser,
    requireAdmin,
    wrap(async (req, res) => {
      const existing = current.data.apps.find((a) => a.id === req.params.id);
      if (!existing) return res.status(404).json({ error: 'App not found.' });
      const done = await change(res, (data) =>
        withActivity(
          {
            ...data,
            apps: data.apps.filter((a) => a.id !== existing.id),
            connections: data.connections.map((c) => (c.appId === existing.id ? { ...c, appId: null } : c)),
          },
          req.user.name,
          `Removed the app ${existing.name}`,
        ),
      );
      if (done) res.json({ ok: true });
    }),
  );

  /* ---------- Connections: which apps may exchange data (admin) ---------- */

  function checkConnection(body, existing, data) {
    const name = String(body?.name ?? existing?.name ?? '').trim();
    const scopes = Array.isArray(body?.scopes) ? [...new Set(body.scopes.map(String))] : existing?.scopes || [];
    const appId = body?.appId === undefined ? existing?.appId || null : body.appId || null;
    if (!name) return { error: 'Name is required.' };
    if (name.length > 60) return { error: 'The name is too long.' };
    if (!scopes.length) return { error: 'Choose at least one thing this app may do.' };
    if (scopes.some((s) => !Object.hasOwn(SCOPES, s))) return { error: 'Unknown permission.' };
    if (scopes.includes('qualification:write') && !scopes.includes('drivers:write')) {
      return { error: 'Sending driver qualification also needs "Send its drivers".' };
    }
    if (appId && !data.apps.some((a) => a.id === appId)) return { error: 'App not found.' };
    const clash = data.connections.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== existing?.id);
    if (clash) return { error: `A connection named ${name} already exists.` };
    const active = body?.active === undefined ? existing?.active !== false : body.active !== false;
    return { name, scopes, appId, active };
  }

  // The key is shown once. Only its hash is kept, so it cannot be read back later.
  const newKey = (id) => {
    const secret = newToken();
    return {
      key: `suite_${id}_${secret}`,
      keyHash: tokenHash(secret),
      keyHint: `suite_${id}_…${secret.slice(-4)}`,
      keyCreatedAt: new Date().toISOString(),
    };
  };

  app.post(
    '/api/connections',
    requireUser,
    requireAdmin,
    wrap(async (req, res) => {
      let key = null;
      let id = null;
      const done = await change(res, (data) => {
        const v = checkConnection(req.body, null, data);
        if (v.error) throw new HubError(v.error);
        id = uid();
        const k = newKey(id);
        key = k.key;
        const conn = {
          id,
          ...v,
          keyHash: k.keyHash,
          keyHint: k.keyHint,
          keyCreatedAt: k.keyCreatedAt,
          createdAt: k.keyCreatedAt,
          createdBy: req.user.name,
          lastSync: {},
        };
        return withActivity({ ...data, connections: [...data.connections, conn] }, req.user.name, `Connected ${v.name}`);
      });
      if (done) res.json({ ok: true, id, key });
    }),
  );

  app.put(
    '/api/connections/:id',
    requireUser,
    requireAdmin,
    wrap(async (req, res) => {
      const done = await change(res, (data) => {
        const existing = data.connections.find((c) => c.id === req.params.id);
        if (!existing) throw new HubError('Connection not found.');
        const v = checkConnection(req.body, existing, data);
        if (v.error) throw new HubError(v.error);
        return { ...data, connections: data.connections.map((c) => (c.id === existing.id ? { ...c, ...v } : c)) };
      });
      if (done) res.json({ ok: true });
    }),
  );

  // A new key replaces the old one at once; the app must be given the new key.
  app.post(
    '/api/connections/:id/key',
    requireUser,
    requireAdmin,
    wrap(async (req, res) => {
      let key = null;
      const done = await change(res, (data) => {
        const existing = data.connections.find((c) => c.id === req.params.id);
        if (!existing) throw new HubError('Connection not found.');
        const k = newKey(existing.id);
        key = k.key;
        return withActivity(
          {
            ...data,
            connections: data.connections.map((c) =>
              c.id === existing.id ? { ...c, keyHash: k.keyHash, keyHint: k.keyHint, keyCreatedAt: k.keyCreatedAt } : c,
            ),
          },
          req.user.name,
          `Made a new key for ${existing.name}`,
        );
      });
      if (done) res.json({ ok: true, key });
    }),
  );

  // Removing a connection also removes every driver and unit that app sent.
  app.delete(
    '/api/connections/:id',
    requireUser,
    requireAdmin,
    wrap(async (req, res) => {
      const done = await change(res, (data) => {
        const existing = data.connections.find((c) => c.id === req.params.id);
        if (!existing) throw new HubError('Connection not found.');
        return withActivity(
          {
            ...data,
            connections: data.connections.filter((c) => c.id !== existing.id),
            drivers: data.drivers.filter((r) => r.source !== existing.id),
            equipment: data.equipment.filter((r) => r.source !== existing.id),
          },
          req.user.name,
          `Removed the connection ${existing.name} and the records it sent`,
        );
      });
      if (done) res.json({ ok: true });
    }),
  );

  /* ---------- Fixing matches between apps (admin) ---------- */

  for (const collection of COLLECTIONS) {
    app.post(
      `/api/${collection}/merge`,
      requireUser,
      requireAdmin,
      wrap(async (req, res) => {
        const done = await change(res, (data) =>
          withActivity(
            mergeGroups(data, collection, String(req.body?.from || ''), String(req.body?.into || '')),
            req.user.name,
            `Joined two ${collection} records`,
          ),
        );
        if (done) res.json({ ok: true });
      }),
    );
    app.post(
      `/api/${collection}/split`,
      requireUser,
      requireAdmin,
      wrap(async (req, res) => {
        const done = await change(res, (data) =>
          withActivity(splitRecord(data, collection, String(req.body?.recordId || ''), uid()), req.user.name, `Separated a ${collection} record`),
        );
        if (done) res.json({ ok: true });
      }),
    );
  }

  /* ---------- Users (admin) ---------- */

  async function checkUser(body, existing) {
    const name = String(body?.name ?? existing?.name ?? '').trim();
    const email = String(body?.email ?? existing?.email ?? '')
      .trim()
      .toLowerCase();
    const role = String(body?.role ?? existing?.role ?? 'staff');
    const password = body?.password ? String(body.password) : '';
    const apps =
      body?.apps === undefined ? (existing?.apps ?? null) : body.apps === null ? null : Array.isArray(body.apps) ? body.apps.map(String) : undefined;
    if (!name) return { error: 'Name is required.' };
    if (name.length > 80) return { error: 'The name is too long.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return { error: 'Enter a valid email address.' };
    if (!ROLES.includes(role)) return { error: 'Choose Admin or Staff.' };
    if (apps === undefined || (apps && apps.some((id) => !current.data.apps.some((a) => a.id === id))))
      return { error: 'Choose apps from the list.' };
    if (!existing && !password) return { error: 'Set a password for the new user.' };
    if (password && password.length < MIN_PASSWORD) return { error: `The password must be at least ${MIN_PASSWORD} characters.` };
    const clash = (await store.listUsers()).find((u) => u.email === email && u.id !== existing?.id);
    if (clash) return { error: `${email} is already used by ${clash.name}.` };
    const active = body?.active === undefined ? existing?.active !== false : body.active !== false;
    return { name, email, role, password, active, apps };
  }

  app.get(
    '/api/users',
    requireUser,
    requireAdmin,
    wrap(async (req, res) => {
      const users = (await store.listUsers()).map(publicUser).sort((a, b) => a.name.localeCompare(b.name));
      res.json({ users });
    }),
  );

  app.post(
    '/api/users',
    requireUser,
    requireAdmin,
    wrap(async (req, res) => {
      const v = await checkUser(req.body, null);
      if (v.error) return res.status(400).json({ error: v.error });
      const now = new Date().toISOString();
      const user = {
        id: uid(),
        name: v.name,
        email: v.email,
        role: v.role,
        active: v.active,
        apps: v.apps,
        passwordHash: hashSecret(v.password),
        version: 1,
        createdAt: now,
        createdBy: req.user.name,
      };
      await store.setUser(user.id, user);
      res.json({ user: publicUser(user) });
    }),
  );

  app.put(
    '/api/users/:id',
    requireUser,
    requireAdmin,
    wrap(async (req, res) => {
      const existing = await store.getUser(req.params.id);
      if (!existing) return res.status(404).json({ error: 'User not found.' });
      const v = await checkUser(req.body, existing);
      if (v.error) return res.status(400).json({ error: v.error });
      if (existing.id === req.user.id && (!v.active || v.role !== 'admin')) {
        return res.status(400).json({ error: 'You cannot turn off or remove admin from your own account.' });
      }
      const signOut = !!v.password || v.role !== existing.role || !v.active || v.email !== existing.email;
      const user = {
        ...existing,
        name: v.name,
        email: v.email,
        role: v.role,
        active: v.active,
        apps: v.apps,
        ...(v.password ? { passwordHash: hashSecret(v.password) } : {}),
        version: existing.version + (signOut ? 1 : 0),
        updatedAt: new Date().toISOString(),
      };
      await store.setUser(user.id, user);
      if (signOut) await store.deleteUserSessions(user.id);
      res.json({ user: publicUser(user) });
    }),
  );

  app.delete(
    '/api/users/:id',
    requireUser,
    requireAdmin,
    wrap(async (req, res) => {
      if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
      await store.deleteUser(req.params.id);
      await store.deleteUserSessions(req.params.id);
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/password',
    requireUser,
    wrap(async (req, res) => {
      if (req.user.owner) return res.status(400).json({ error: 'The owner password is the SUITE_PASSWORD setting on the server. Change it there.' });
      const user = await store.getUser(req.user.id);
      const next = String(req.body?.next || '');
      if (!verifySecret(String(req.body?.current || ''), user.passwordHash))
        return res.status(400).json({ error: 'Your current password is not correct.' });
      if (next.length < MIN_PASSWORD) return res.status(400).json({ error: `The new password must be at least ${MIN_PASSWORD} characters.` });
      const updated = { ...user, passwordHash: hashSecret(next), version: user.version + 1, updatedAt: new Date().toISOString() };
      await store.setUser(user.id, updated);
      await store.deleteUserSessions(user.id);
      await startSession(res, { userId: user.id, userVersion: updated.version });
      res.json({ ok: true });
    }),
  );

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  /* ---------- Web pages ---------- */

  if (distDir && fs.existsSync(path.join(distDir, 'index.html'))) {
    app.use(
      express.static(distDir, {
        index: 'index.html',
        setHeaders: (res, file) => {
          if (file.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
          else res.set('Cache-Control', 'no-cache');
        },
      }),
    );
  }

  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Too much data in one request.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
    log(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}
