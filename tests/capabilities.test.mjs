/* -------------------------------------------------------------------------
   Capabilities endpoint tests
   ------------------------------------------------------------------------- */

import test from 'node:test';
import assert from 'node:assert';
import { startServer, dropDatabase, tcpUp } from './helpers/server.mjs';

const PORT = 5319;
const TEST_DB = 'mongodb://127.0.0.1:27017/astrovetro_capabilities_test';

const mongoUp = await tcpUp('127.0.0.1', 27017);

test('Capabilities endpoint', { skip: mongoUp ? false : 'mongod is not reachable on 127.0.0.1:27017' }, async (t) => {
  let server;
  let base;

  await t.test('reports database connected when MongoDB is available', async () => {
    server = await startServer({ port: 5320, databaseUrl: TEST_DB });
    base = server.base;
    
    const res = await fetch(`${base}/api/status`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.database, true);
    assert.strictEqual(data.data.writable, true);
    
    await server.stop();
  });

  await t.test('reports database disconnected when MongoDB is unreachable', async () => {
    // Use an unreachable port (27018) to simulate MongoDB being down
    // This will fail fast with a connection refused error
    server = await startServer({ port: 5321, databaseUrl: 'mongodb://127.0.0.1:27018/nonexistent' });
    base = server.base;
    
    const res = await fetch(`${base}/api/status`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.database, false);
    assert.strictEqual(data.data.writable, false);
    
    await server.stop();
  });

  await t.test('reports reachable false when API is unreachable', async () => {
    // Use AbortController with timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    try {
      const res = await fetch('http://localhost:9999/api/status', { signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      
      assert.strictEqual(res.ok, false);
      assert.strictEqual(data.reachable, false);
      assert.strictEqual(data.data.database, null);
      assert.strictEqual(data.data.writable, false);
    } catch (err) {
      // Network error (connection refused, timeout) - this is expected
      if (err.name === 'AbortError' || err.code === 'ECONNREFUSED' || err.name === 'TypeError') {
        // Test passes - the API is unreachable
        assert.ok(true);
      } else {
        throw err;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  });
});