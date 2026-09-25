// Local storage: JSON files in a folder. Used for development and for running on one
// computer. Writes go to a temp file first so a crash never leaves a half written file.
import fs from 'node:fs/promises';
import path from 'node:path';

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value));
  await fs.rename(tmp, file);
}

export async function createFileStore(dir) {
  await fs.mkdir(dir, { recursive: true });
  const statePath = path.join(dir, 'state.json');
  const sessionsPath = path.join(dir, 'sessions.json');
  const usersPath = path.join(dir, 'users.json');
  const sessions = await readJson(sessionsPath, {});
  const users = await readJson(usersPath, {});

  return {
    kind: 'file',
    async getState() {
      return readJson(statePath, null);
    },
    async saveState(version, data) {
      await writeJson(statePath, { version, data });
    },
    async getSession(hash) {
      return sessions[hash] || null;
    },
    async putSession(hash, session) {
      sessions[hash] = session;
      await writeJson(sessionsPath, sessions);
    },
    async deleteSession(hash) {
      delete sessions[hash];
      await writeJson(sessionsPath, sessions);
    },
    async deleteUserSessions(userId) {
      for (const [k, v] of Object.entries(sessions)) if (v.userId === userId) delete sessions[k];
      await writeJson(sessionsPath, sessions);
    },
    async listUsers() {
      return Object.values(users);
    },
    async getUser(id) {
      return users[id] || null;
    },
    async setUser(id, user) {
      users[id] = user;
      await writeJson(usersPath, users);
    },
    async deleteUser(id) {
      delete users[id];
      await writeJson(usersPath, users);
    },
    async close() {},
  };
}
