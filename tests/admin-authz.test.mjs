/* Authorization is enforced on the server, so these checks never touch the
   frontend: an unauthenticated caller and an authenticated customer must both
   be refused by every admin route, before any handler runs.

   The server is booted by the test itself on its own port — no manually
   running `node server.js` is required for `npm test` to pass. */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { startServer, api, login, sessionCookie, tcpUp } from './helpers/server.mjs';

const PORT = 5311;

const mongoUp = await tcpUp('127.0.0.1', 27017);

describe('admin authorization', { skip: mongoUp ? false : 'mongod is not reachable on 127.0.0.1:27017' }, () => {
  let server;
  let cookie;

  before(async () => {
    server = await startServer({ port: PORT });
    /* Customer session: registered through the real endpoint, so it carries
       the role a normal sign-up produces. */
    const email = `authz-customer-${Date.now()}@example.com`;
    const reg = await api(server.base, '/api/auth/register', {
      method: 'POST',
      body: { name: 'Authz Customer', email, password: 'customer-pass-123' },
    });
    assert.strictEqual(reg.status, 201, `register failed: ${JSON.stringify(reg.json)}`);
    cookie = sessionCookie(reg.res);
    assert.ok(cookie, 'register should issue a session cookie');
  });

  after(async () => {
    await server?.stop();
  });

  it('refuses an unauthenticated admin request with 401', async () => {
    const out = await api(server.base, '/api/admin/dashboard');
    assert.strictEqual(out.status, 401);
    assert.strictEqual(out.json.success, false);
    assert.ok(!JSON.stringify(out.json).includes('byStatus'), 'no admin data may leak');
  });

  it('refuses unauthenticated writes with 401', async () => {
    const out = await api(server.base, '/api/admin/products', {
      method: 'POST',
      body: { name: 'Nope', category: 'ring', price: 1 },
    });
    assert.strictEqual(out.status, 401);
    assert.strictEqual(out.json.success, false);
  });

  it('refuses an authenticated customer with 403', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/admin/dashboard', undefined],
      ['GET', '/api/admin/products', undefined],
      ['GET', '/api/admin/inventory/table', undefined],
      ['POST', '/api/admin/products', { name: 'Nope', category: 'ring', price: 1 }],
    ]) {
      const out = await api(server.base, path, { method, body, cookie });
      assert.strictEqual(out.status, 403, `${method} ${path} must be 403 for a customer`);
      assert.strictEqual(out.json.success, false);
    }
  });

  it('accepts the admin session for the same routes', async () => {
    const adminCookie = await login(server.base, 'admin@astrovetro.com', 'astrovetro-dev-2026');
    assert.ok(adminCookie, 'admin login failed — is the admin account seeded on this machine?');
    const out = await api(server.base, '/api/admin/dashboard', { cookie: adminCookie });
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.json.success, true);
    assert.ok('total' in out.json.data, 'dashboard must return real metrics');
  });

  it('rejects a wrong password without issuing a session', async () => {
    const out = await api(server.base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@astrovetro.com', password: 'wrong-password-here' },
    });
    assert.strictEqual(out.status, 401);
    assert.ok(!sessionCookie(out.res), 'a refused login must not set a cookie');
  });
});
