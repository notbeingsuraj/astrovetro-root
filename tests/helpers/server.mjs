/* -------------------------------------------------------------------------
   Shared helpers for the integration tests.

   Every test file that needs a server boots its own on a dedicated port, so
   `npm test` never depends on a manually started `node server.js` and never
   talks to a port a developer happens to have open. Databases are always
   explicit: integration flows use their own database name and drop it in
   teardown, so the local working database is never touched by a test run.
   ------------------------------------------------------------------------- */

import { spawn, execFile } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolves true when something is listening on host:port. */
export function tcpUp(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (v) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * Boot `server.js` on `port` and wait until /api/status answers.
 * Returns { base, stop, logs }. Throws with the captured output if the
 * process dies or never becomes ready.
 */
export async function startServer({ port, databaseUrl = null } = {}) {
  const env = { ...process.env, PORT: String(port), NODE_ENV: 'development' };
  delete env.API_TARGET;
  delete env.AV_DISABLE_API;
  if (databaseUrl) {
    env.DATABASE_URL = databaseUrl;
    env.MONGODB_URI = databaseUrl;
  }

  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 25000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`server.js exited with code ${child.exitCode}:\n${logs.join('')}`);
    }
    try {
      const res = await fetch(`${base}/api/status`);
      if (res.ok) break;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`server.js not ready after 25s:\n${logs.join('')}`);
    }
    await sleep(150);
  }

  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 4000).unref();
    });

  return { base, logs, child, stop };
}

/** The session cookie (name=value pair) from a login response, or null. */
export function sessionCookie(res, name = 'av_token') {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const hit = all.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.split(';')[0] : null;
}

/**
 * Fetch wrapper that understands the API envelope: returns { status, json }
 * and never throws on a non-2xx, because asserting on failures is most of
 * what these tests do.
 */
export async function api(base, apiPath, { method = 'GET', body, cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  /* Browsers always send Origin (or Sec-Fetch-Site) on a credentialed
     mutation, and the CSRF middleware refuses a cookie-authenticated write
     that carries neither. Send the same thing a browser would. */
  if (!h.Origin) h.Origin = base;
  const res = await fetch(base + apiPath, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON (CSV downloads, plain errors) */
  }
  return { status: res.status, json, res };
}

/** Log in and return the session cookie string (or null on refusal). */
export async function login(base, email, password) {
  const out = await api(base, '/api/auth/login', { method: 'POST', body: { email, password } });
  if (out.status !== 200) return null;
  return sessionCookie(out.res);
}

/** Create (or promote) an admin account directly in the given database. */
export function createAdmin({ databaseUrl, email, password }) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['scripts/create-admin.mjs', email],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          MONGODB_URI: databaseUrl,
          AV_ADMIN_PASSWORD: password,
        },
        timeout: 30000,
      },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || stdout || err.message));
        else resolve(stdout);
      }
    );
  });
}

/** Drop a whole database — only ever call this with a test database name. */
export async function dropDatabase(uri) {
  if (!/test/i.test(uri)) throw new Error(`refusing to drop a non-test database: ${uri}`);
  const { default: mongoose } = await import('mongoose');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 4000 });
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
