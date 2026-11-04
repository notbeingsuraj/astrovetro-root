#!/usr/bin/env node
/* -------------------------------------------------------------------------
   Production smoke test
   -------------------------------------------------------------------------

   Verifies critical production endpoints and behaviours.
   Run against a deployed URL (Vercel, local, or staging).

   Usage:
     BASE_URL=https://astrovetro-root-dntu-azure.vercel.app \
     ADMIN_EMAIL=admin@astrovetro.com \
     ADMIN_PASSWORD=secret \
     node scripts/smoke-production.mjs

   Exits with code 0 on success, non-zero on failure.
   ------------------------------------------------------------------------- */

import 'dotenv/config';

const BASE_URL = process.env.BASE_URL || process.env.ASTROVETRO_BASE_URL || 'http://localhost:5173';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.AV_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.AV_ADMIN_PASSWORD;

const RESULTS = {
  passed: 0,
  failed: 0,
  warnings: 0,
  checks: [],
};

function logCheck(name, passed, details = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  const line = `${status}  ${name}${details ? ` — ${details}` : ''}`;
  console.log(line);
  RESULTS.checks.push({ name, passed, details });
  if (passed) RESULTS.passed++;
  else RESULTS.failed++;
}

function logWarn(name, details) {
  console.log(`⚠️  WARN  ${name} — ${details}`);
  RESULTS.warnings++;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 10000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkHealth() {
  console.log('\n=== Health Endpoint ===');
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/health`);
    const data = await res.json().catch(() => ({}));

    logCheck('Health returns 200', res.status === 200, `status=${res.status}`);
    logCheck('Health reports status ok', data.status === 'ok', `status=${data.status}`);
    logCheck('Health includes database field', 'database' in data, `database=${data.database}`);
    logCheck('Health includes mongooseReadyState', 'mongooseReadyState' in data, `readyState=${data.mongooseReadyState}`);
    logCheck('Health includes timestamp', 'timestamp' in data && !!data.timestamp);
    logCheck('Health includes uptime', 'uptime' in data && typeof data.uptime === 'number');
    logCheck('Health database is connected', data.database === 'connected', `database=${data.database}`);
    logCheck('Health readyState is 1', data.mongooseReadyState === 1, `readyState=${data.mongooseReadyState}`);

    return data.database === 'connected' && data.mongooseReadyState === 1;
  } catch (err) {
    logCheck('Health endpoint reachable', false, `error=${err.message}`);
    return false;
  }
}

async function checkApiStatus() {
  console.log('\n=== API Status Endpoint ===');
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/status`);
    const data = await res.json().catch(() => ({}));

    logCheck('API status returns 200', res.status === 200, `status=${res.status}`);
    logCheck('API status success=true', data.success === true, `success=${data.success}`);
    logCheck('API status includes data', 'data' in data);
    logCheck('API status database=true', data.data?.database === true, `database=${data.data?.database}`);
    logCheck('API status writable=true', data.data?.writable === true, `writable=${data.data?.writable}`);
    logCheck('API status includes provider', 'provider' in (data.data || {}), `provider=${data.data?.provider}`);
    logCheck('API status includes paymentsLive', 'paymentsLive' in (data.data || {}), `paymentsLive=${data.data?.paymentsLive}`);

    return data.data?.database === true && data.data?.writable === true;
  } catch (err) {
    logCheck('API status endpoint reachable', false, `error=${err.message}`);
    return false;
  }
}

async function checkCapabilities() {
  console.log('\n=== Frontend Capabilities (via /api/status) ===');
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/status`);
    const data = await res.json().catch(() => ({}));

    // Simulate what AV.capabilities() does
    const caps = data.success && data.data ? {
      reachable: true,
      provider: data.data.provider || 'unknown',
      database: data.data.database || false,
      writable: data.data.writable || false,
      paymentsLive: data.data.paymentsLive || false,
    } : {
      reachable: false,
      provider: 'unknown',
      database: null,
      writable: false,
      paymentsLive: false,
    };

    logCheck('Capabilities reachable=true', caps.reachable === true);
    logCheck('Capabilities database=true', caps.database === true, `database=${caps.database}`);
    logCheck('Capabilities writable=true', caps.writable === true, `writable=${caps.writable}`);
    logCheck('Capabilities provider known', caps.provider !== 'unknown', `provider=${caps.provider}`);

    return caps.reachable && caps.database === true;
  } catch (err) {
    logCheck('Capabilities check', false, `error=${err.message}`);
    return false;
  }
}

async function checkAuthEndpoints() {
  console.log('\n=== Auth Endpoints ===');
  let allPassed = true;

  // Test /api/auth/me (should return 401 for unauthenticated)
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/auth/me`);
    const data = await res.json().catch(() => ({}));

    logCheck('GET /api/auth/me returns 401', res.status === 401, `status=${res.status}`);
    logCheck('Auth me error code=UNAUTHORIZED', data.error?.code === 'UNAUTHORIZED', `code=${data.error?.code}`);
    if (res.status !== 401) allPassed = false;
  } catch (err) {
    logCheck('Auth me endpoint reachable', false, `error=${err.message}`);
    allPassed = false;
  }

  // Small delay to avoid rate limiting
  await new Promise(r => setTimeout(r, 500));

  // Test /api/auth/login with invalid credentials (should return 401 or 429 if rate limited)
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': BASE_URL },
      body: JSON.stringify({ email: 'nonexistent@test.invalid', password: 'wrong' }),
    });
    const data = await res.json().catch(() => ({}));

    // Accept 401 (unauthorized) or 429 (rate limited) - both are valid responses
    const validLoginStatus = res.status === 401 || res.status === 429;
    logCheck('POST /api/auth/login returns 401 or 429', validLoginStatus, `status=${res.status}`);
    if (res.status === 401) {
      logCheck('Login error message generic (401)', data.error?.code === 'UNAUTHORIZED', `code=${data.error?.code}`);
    } else if (res.status === 429) {
      logCheck('Login rate limited (429)', data.error?.code === 'RATE_LIMITED', `code=${data.error?.code}`);
    }
    if (!validLoginStatus) allPassed = false;
  } catch (err) {
    logCheck('Login endpoint reachable', false, `error=${err.message}`);
    allPassed = false;
  }

  // Small delay
  await new Promise(r => setTimeout(r, 500));

  // Test /api/auth/register with invalid data (should return 400 or 422 for validation)
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': BASE_URL },
      body: JSON.stringify({ email: 'invalid', password: 'short' }),
    });
    const data = await res.json().catch(() => ({}));

    // Zod validation returns 422, express validation returns 400 - both acceptable
    const validErrorStatus = res.status === 400 || res.status === 422;
    logCheck('POST /api/auth/register returns 400/422 for bad data', validErrorStatus, `status=${res.status}`);
    if (!validErrorStatus) allPassed = false;
  } catch (err) {
    logCheck('Register endpoint reachable', false, `error=${err.message}`);
    allPassed = false;
  }

  // Test /api/auth/logout (should return 200 even without session)
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Origin': BASE_URL },
    });
    const data = await res.json().catch(() => ({}));

    logCheck('POST /api/auth/logout returns 200', res.status === 200, `status=${res.status}`);
    logCheck('Logout returns success', data.success === true, `success=${data.success}`);
    if (res.status !== 200) allPassed = false;
  } catch (err) {
    logCheck('Logout endpoint reachable', false, `error=${err.message}`);
    allPassed = false;
  }

  return allPassed;
}

async function checkStaticAssets() {
  console.log('\n=== Static Assets ===');
  let allPassed = true;

  // Test homepage
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/home.html`);
    logCheck('GET /home.html returns 200', res.status === 200, `status=${res.status}`);
    if (res.status !== 200) allPassed = false;
  } catch (err) {
    logCheck('Homepage reachable', false, `error=${err.message}`);
    allPassed = false;
  }

  // Test shop page
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/shop.html`);
    logCheck('GET /shop.html returns 200', res.status === 200, `status=${res.status}`);
    if (res.status !== 200) allPassed = false;
  } catch (err) {
    logCheck('Shop page reachable', false, `error=${err.message}`);
    allPassed = false;
  }

  // Test a known static asset (CSS) - try common paths
  let cssFound = false;
  for (const cssPath of ['/assets/css/styles.css', '/assets/css/main.css', '/styles.css', '/css/styles.css']) {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}${cssPath}`);
      if (res.status === 200) {
        cssFound = true;
        logCheck(`GET ${cssPath} returns 200`, true);
        break;
      }
    } catch (_) {
      // continue to next path
    }
  }
  if (!cssFound) {
    logCheck('GET /assets/css/styles.css returns 200', false, 'status=404 (no CSS found at common paths)');
    allPassed = false;
  }

  // Test JS bundle
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/assets/api.js`);
    logCheck('GET /assets/api.js returns 200', res.status === 200, `status=${res.status}`);
    if (res.status !== 200) allPassed = false;
  } catch (err) {
    logCheck('API JS reachable', false, `error=${err.message}`);
    allPassed = false;
  }

  return allPassed;
}

async function checkAdminAuth() {
  console.log('\n=== Admin Authentication ===');

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    logWarn('Admin credentials not provided', 'Set ADMIN_EMAIL and ADMIN_PASSWORD to test admin login');
    return true; // Not a failure, just skipped
  }

  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': BASE_URL },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    const data = await res.json().catch(() => ({}));

    logCheck('Admin login returns 200', res.status === 200, `status=${res.status}`);
    logCheck('Admin login success=true', data.success === true, `success=${data.success}`);
    logCheck('Admin login returns user', data.data?.user?.role === 'admin', `role=${data.data?.user?.role}`);
    logCheck('Admin login sets cookie', res.headers.has('set-cookie'), 'set-cookie header present');

    if (res.status !== 200 || data.data?.user?.role !== 'admin') {
      return false;
    }

    // Test authenticated admin endpoint
    const cookie = res.headers.get('set-cookie')?.split(';')[0];
    if (cookie) {
      const adminRes = await fetchWithTimeout(`${BASE_URL}/api/admin/dashboard`, {
        headers: { 'Cookie': cookie, 'Origin': BASE_URL },
      });
      const adminData = await adminRes.json().catch(() => ({}));

      logCheck('Admin dashboard accessible with session', adminRes.status === 200, `status=${adminRes.status}`);
      logCheck('Admin dashboard returns data', adminData.success === true, `success=${adminData.success}`);

      return adminRes.status === 200;
    }

    return true;
  } catch (err) {
    logCheck('Admin login reachable', false, `error=${err.message}`);
    return false;
  }
}

async function checkStorageHealth() {
  console.log('\n=== Storage Health (if applicable) ===');
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/status`);
    const data = await res.json().catch(() => ({}));

    // Check if storage adapter is configured
    const provider = data.data?.provider;
    logCheck('Storage provider reported', !!provider, `provider=${provider}`);

    // If B2 or S3, we can't easily test without credentials
    // Just verify the endpoint doesn't crash
    if (provider === 'b2' || provider === 's3') {
      logWarn('Cloud storage detected', `Provider is ${provider}. Full upload test requires manual verification.`);
    }

    return true;
  } catch (err) {
    logCheck('Storage health check', false, `error=${err.message}`);
    return false;
  }
}

async function checkCorsAndSecurity() {
  console.log('\n=== CORS & Security Headers ===');
  let allPassed = true;

  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/status`, {
      headers: { 'Origin': BASE_URL },
    });

    // Check CORS headers
    const acao = res.headers.get('access-control-allow-origin');
    const acac = res.headers.get('access-control-allow-credentials');

    logCheck('CORS allows configured origin', acao === BASE_URL || acao === '*', `ACAO=${acao}`);
    logCheck('CORS allows credentials', acac === 'true', `ACAC=${acac}`);

    // Check security headers (helmet)
    const csp = res.headers.get('content-security-policy');
    logCheck('CSP header present', !!csp, csp ? 'present' : 'missing');

    const hsts = res.headers.get('strict-transport-security');
    // HSTS only in production
    if (BASE_URL.startsWith('https://')) {
      logCheck('HSTS header present (HTTPS)', !!hsts, hsts ? 'present' : 'missing');
    }

    const xfo = res.headers.get('x-frame-options');
    logCheck('X-Frame-Options header', !!xfo, `XFO=${xfo}`);

    const ctOptions = res.headers.get('x-content-type-options');
    logCheck('X-Content-Type-Options header', ctOptions === 'nosniff', `nosniff=${ctOptions}`);

    return allPassed;
  } catch (err) {
    logCheck('CORS/Security check', false, `error=${err.message}`);
    return false;
  }
}

async function checkImageProxy() {
  console.log('\n=== Image Proxy Route ===');
  try {
    // Request a non-existent image - should return 404, not 500
    const res = await fetchWithTimeout(`${BASE_URL}/assets/img/nonexistent.jpg`);

    logCheck('Image proxy returns 404 for missing', res.status === 404, `status=${res.status}`);
    logCheck('Image proxy does not return 500', res.status !== 500, `status=${res.status}`);

    return res.status === 404;
  } catch (err) {
    logCheck('Image proxy reachable', false, `error=${err.message}`);
    return false;
  }
}

async function checkRateLimiting() {
  console.log('\n=== Rate Limiting (basic) ===');
  try {
    // Make several rapid requests to auth endpoint
    const promises = Array(5).fill(null).map(() =>
      fetchWithTimeout(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': BASE_URL },
        body: JSON.stringify({ email: 'test@test.invalid', password: 'wrong' }),
      })
    );

    const responses = await Promise.all(promises);
    const statuses = responses.map(r => r.status);

    // Rate limiter should kick in and return 429 for some requests
    // This is correct behavior - we verify rate limiting EXISTS
    const rateLimited = statuses.some(s => s === 429);
    logCheck('Login rate limiting active (returns 429)', rateLimited, `statuses=[${statuses.join(',')}]`);

    // All responses should be either 401 (unauthorized) or 429 (rate limited)
    const allValid = statuses.every(s => s === 401 || s === 429);
    logCheck('Login returns only 401 or 429', allValid, `statuses=[${statuses.join(',')}]`);

    return rateLimited && allValid;
  } catch (err) {
    logCheck('Rate limit check', false, `error=${err.message}`);
    return false;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Astrovetro Production Smoke Test                        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\nTarget: ${BASE_URL}`);
  console.log(`Started: ${new Date().toISOString()}`);

  const checks = [
    { name: 'Health', fn: checkHealth, required: true },
    { name: 'API Status', fn: checkApiStatus, required: true },
    { name: 'Capabilities', fn: checkCapabilities, required: true },
    { name: 'Auth Endpoints', fn: checkAuthEndpoints, required: true },
    { name: 'Static Assets', fn: checkStaticAssets, required: true },
    { name: 'Admin Auth', fn: checkAdminAuth, required: false },
    { name: 'Storage', fn: checkStorageHealth, required: false },
    { name: 'CORS & Security', fn: checkCorsAndSecurity, required: true },
    { name: 'Image Proxy', fn: checkImageProxy, required: true },
    { name: 'Rate Limiting', fn: checkRateLimiting, required: false },
  ];

  let allRequiredPassed = true;

  for (const check of checks) {
    const passed = await check.fn();
    if (check.required && !passed) {
      allRequiredPassed = false;
    }
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`Passed:   ${RESULTS.passed}`);
  console.log(`Failed:   ${RESULTS.failed}`);
  console.log(`Warnings: ${RESULTS.warnings}`);
  console.log(`Total:    ${RESULTS.passed + RESULTS.failed}`);

  if (RESULTS.failed > 0) {
    console.log('\n❌ FAILED CHECKS:');
    RESULTS.checks
      .filter(c => !c.passed)
      .forEach(c => console.log(`  - ${c.name}: ${c.details}`));
  }

  if (RESULTS.warnings > 0) {
    console.log('\n⚠️  WARNINGS (manual verification needed):');
    // Warnings are logged inline
  }

  console.log(`\nCompleted: ${new Date().toISOString()}`);

  // Exit codes:
  // 0 = all required checks passed
  // 1 = required check failed
  // 2 = only optional checks failed/warnings
  if (!allRequiredPassed) {
    console.log('\n🔴 RESULT: REQUIRED CHECKS FAILED');
    process.exit(1);
  } else if (RESULTS.failed > 0) {
    console.log('\n🟡 RESULT: OPTIONAL CHECKS FAILED (required checks passed)');
    process.exit(2);
  } else {
    console.log('\n🟢 RESULT: ALL CHECKS PASSED');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('\n💥 SMOKE TEST CRASHED:', err);
  process.exit(1);
});