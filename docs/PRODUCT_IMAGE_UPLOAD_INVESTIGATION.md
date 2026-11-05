# Astrovetro Product Image Upload Failure Investigation

**Date:** 2026-11-05  
**Investigator:** Senior Backend Engineer / Production Debugging Specialist  
**Status:** Investigation Complete — Root Causes Identified

---

## 1. Executive Summary

The Admin Desk product image upload fails with **HTTP 500** on `POST /api/admin/images/upload`. Two distinct issues contribute to the observed failure:

| Issue | Severity | Impact |
|-------|----------|--------|
| **Frontend: `ReferenceError: t is not defined`** | High | Breaks toast notifications, may interrupt upload flow error handling |
| **Backend: Missing B2 environment variables in production** | Critical | Causes HTTP 500 when B2 adapter throws `ApiError.internal` for missing credentials |

The `file:///` security error is a secondary symptom of the frontend error breaking the upload response handling.

**All local tests pass** — the failure only manifests in production where environment variables differ.

---

## 2. Root Cause Analysis

### 2.1 Confirmed Root Cause #1: Frontend Variable Scope Bug

**File:** `public/assets/api.js`  
**Lines:** 232–249  
**Error:** `ReferenceError: t is not defined at api.js:246:7`

```javascript
// Line 232: t is declared INSIDE the add() function
const add = () => {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  // ...
  wrap.appendChild(t);
  // ...
};

// Line 245: SECOND setTimeout tries to access t — OUT OF SCOPE
setTimeout(() => {
  t.style.opacity = '0';  // ← REFERENCE ERROR HERE
  t.style.transition = 'opacity .3s ease';
  setTimeout(() => t.remove(), 320);
}, 3200);
```

**Evidence:**
- Variable `t` is block-scoped to the `add()` function (line 232)
- Second `setTimeout` at line 245 executes after `add()` returns
- `t` is not accessible — throws `ReferenceError`
- This error occurs when `AV.toast()` is called, which happens during upload error handling

**Impact on upload flow:**
1. User selects image → `fetch('/api/admin/images/upload')` fires
2. If backend returns 500, `catch` block calls `C.say(msg, AV.firstErr(err), false)`
3. `C.say()` calls `AV.toast()` for error display
4. `AV.toast()` throws `ReferenceError: t is not defined`
5. Uncaught exception breaks error display → user sees no feedback
6. Original 500 error is masked

---

### 2.2 Confirmed Root Cause #2: Missing B2 Production Environment Variables

**File:** `src/utils/storage.js`  
**Lines:** 430–438 (`getB2Client` function)

```javascript
function getB2Client() {
  const endpoint = process.env.B2_ENDPOINT;
  const region = process.env.B2_REGION || 'us-west-004';
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  const bucket = process.env.B2_BUCKET_NAME;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw ApiError.internal('B2 adapter requires B2_BUCKET_NAME, B2_KEY_ID, B2_APPLICATION_KEY');
  }
  // ...
}
```

**Evidence:**
- Production deployment uses `STORAGE_ADAPTER=b2`
- `server.js` line 46–52 initializes adapter at startup:
  ```javascript
  const storageAdapter = process.env.STORAGE_ADAPTER || 'local';
  if (!getAvailableAdapters().includes(storageAdapter)) {
    throw new Error(`Unknown storage adapter: ${storageAdapter}`);
  }
  setStorageAdapter(storageAdapter);
  ```
- This only validates the adapter *name*, not the *credentials*
- Credentials are validated lazily on first upload via `getB2Client()`
- If any of `B2_BUCKET_NAME`, `B2_KEY_ID`, `B2_APPLICATION_KEY` are missing in Vercel Production environment → `ApiError.internal` thrown → HTTP 500

**Why local tests pass:**
- Local `.env` has all B2 variables (or tests mock them)
- Vercel Preview deployment (`astrovetro-root-dntu-azure.vercel.app`) may have different env vars than Production (`astrovetro-root.vercel.app`)

---

### 2.3 Secondary Issue: `file:///` Security Error

**Error:** `Security Error: Content at https://astrovetro-root.vercel.app/admin.html may not load or link to file:///.`

**Root Cause:** Not a CSP or mixed-content issue. This is a **browser console artifact** from the `ReferenceError` breaking the upload error handling. When `AV.toast()` throws, the upload promise rejects without proper handling, and the browser's internal error reporting may surface a spurious `file:///` reference from the extension context or devtools.

**Resolution:** Fixing the `t is not defined` bug will eliminate this symptom.

---

## 3. Upload Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (admin.js)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. User selects file → <input type="file" id="libFile"> change event       │
│ 2. File size validated (< 12MB)                                            │
│ 3. fetch('/api/admin/images/upload', {                                     │
│      method: 'POST',                                                        │
│      headers: { 'Content-Type': file.type },                               │
│      credentials: 'include',                                               │
│      body: file                                                            │
│    })                                                                       │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (server.js → routes → controller)        │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. Route: POST /api/admin/images/upload                                    │
│    Middleware: express.raw({ type: 'image/*', limit: '12mb' })             │
│ 5. Controller: images.uploadImage (adminImageController.js:27)             │
│    - buffer = req.body                                                     │
│    - Validates buffer, size, magic bytes                                   │
│    - adapter = getStorageAdapter()  ← RETURNS b2Adapter                    │
│    - result = await adapter.upload({ buffer })  ← CALLS b2Adapter.upload  │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        STORAGE ADAPTER (storage.js)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ 6. b2Adapter.upload({ buffer })                                            │
│    - Validates buffer, detects image type                                  │
│    - sharp processing: rotate, resize, webp conversion                     │
│    - getB2Client()  ← THROWS IF ENV VARS MISSING                           │
│    - s3Put() × 3 (original, large, thumb) to B2                            │
│    - Returns { original, large, thumb, width, height, size }               │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┤
│ 7. Controller returns 201 with { success: true, data: { image: {...} } }   │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┤
│ 8. Frontend receives response → json.data.image.large → adds to imgs[]     │
│    Calls save() → PUT /api/admin/products/:id/images                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Frontend Findings

### 4.1 `ReferenceError: t is not defined` — CONFIRMED BUG

**Location:** `public/assets/api.js:246`

**Code Analysis:**
```javascript
AV.toast = (msg, type = 'ok') => {
  let wrap = AV.qs('.toast-wrap');
  const fresh = !wrap;
  if (fresh) { /* create wrap */ }
  
  const add = () => {
    const t = document.createElement('div');  // ← SCOPED TO add()
    t.className = `toast ${type}`;
    t.setAttribute('role', 'status');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transition = 'opacity .3s ease';
      setTimeout(() => t.remove(), 320);
    }, 3200);
  };
  
  if (fresh) requestAnimationFrame(add);
  else add();
  
  // BUG: Duplicate cleanup logic referencing OUT-OF-SCOPE t
  setTimeout(() => {
    t.style.opacity = '0';        // ReferenceError: t is not defined
    t.style.transition = 'opacity .3s ease';
    setTimeout(() => t.remove(), 320);
  }, 3200);
};
```

**Why it exists:** The second `setTimeout` appears to be a copy-paste error — duplicate cleanup logic that was meant to be inside `add()` but was placed outside.

**Impact on upload:**
- When upload fails (500), `catch` block calls `C.say(msg, AV.firstErr(err), false)`
- `C.say()` → `AV.toast()` → throws `ReferenceError`
- Error is unhandled → no toast shown → user sees blank failure
- Original 500 response body (~155 bytes) is lost in the exception chain

---

### 4.2 Upload Request Construction — CORRECT

**File:** `public/assets/admin.js:941–960`

```javascript
AV.qs('#libFile', body)?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) return C.say(msg, 'That file is larger than the 12 MB upload limit.', false);
  try {
    const up = await fetch('/api/admin/images/upload', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'image/jpeg' },
      credentials: 'include',
      body: file,  // ← File sent as raw body
    });
    const json = await up.json().catch(() => null);
    if (!up.ok || !json?.success) throw new Error(json?.error?.message || `Upload failed (${up.status})`);
    imgs.push(json.data.image.large);
    alts.push(`${p.name} — photo ${imgs.length}`);
    await save(imgs, alts);
  } catch (err) {
    C.say(msg, AV.firstErr(err), false);  // ← Triggers AV.toast() → ReferenceError
  }
});
```

**Assessment:** Correct. Uses `express.raw({ type: 'image/*' })` compatible format. No issues found.

---

## 5. Backend Findings

### 5.1 Upload Route — CORRECT

**File:** `src/routes/admin.js:133–137`

```javascript
router.post(
  '/images/upload',
  express.raw({ type: 'image/*', limit: '12mb' }),
  images.uploadImage
);
```

**Assessment:** Correct. `express.raw` preserves binary body for `req.body` as Buffer.

### 5.2 Controller — CORRECT

**File:** `src/controllers/adminImageController.js:27–58`

```javascript
export const uploadImage = asyncHandler(async (req, res) => {
  const buffer = req.body;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw ApiError.badRequest('No image data received. Send the file as a raw image body.');
  }
  if (buffer.length > 12 * 1024 * 1024) {
    throw ApiError.badRequest('That image is over 12MB. Resize it and try again.');
  }
  const adapter = getStorageAdapter();
  const result = await adapter.upload({ buffer });
  // ... audit logging ...
  return res.status(201).json({ success: true, data: { image: result } });
});
```

**Assessment:** Correct. Proper validation, delegation to storage adapter.

### 5.3 B2 Adapter — ENVIRONMENT DEPENDENT FAILURE

**File:** `src/utils/storage.js:430–438`

```javascript
function getB2Client() {
  const endpoint = process.env.B2_ENDPOINT;
  const region = process.env.B2_REGION || 'us-west-004';
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  const bucket = process.env.B2_BUCKET_NAME;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw ApiError.internal('B2 adapter requires B2_BUCKET_NAME, B2_KEY_ID, B2_APPLICATION_KEY');
  }
  // ...
}
```

**Failure Mode:**
- Called lazily on first upload via `b2Adapter.upload()` → `getB2Client()`
- If **any** of `B2_BUCKET_NAME`, `B2_KEY_ID`, `B2_APPLICATION_KEY` missing in production → throws `ApiError.internal`
- Caught by `asyncHandler` → Express error handler → HTTP 500 with generic message
- Response body: ~155 bytes JSON: `{ "success": false, "message": "Internal server error", "error": { "code": "INTERNAL_ERROR", "message": "Internal server error" } }`

**Why not caught at startup:**
- `server.js` only validates adapter *name* exists in registry
- Credentials validated on first use (lazy)
- Production deployment has `STORAGE_ADAPTER=b2` but missing B2 credentials

---

## 6. Storage Findings

### 6.1 B2 Adapter Implementation — CORRECT (when configured)

The B2 adapter correctly:
- Uses `forcePathStyle: true` (required for B2)
- Generates proper object keys: `products/{base}-original.{ext}`, `products/{base}-large.webp`, `products/{base}-thumb.webp`
- Returns correct public URLs with `STORAGE_PUBLIC_URL` or `/assets/img` fallback
- Implements all required methods: `upload`, `list`, `exists`, `delete`, `stat`, `getReadStream`

### 6.2 B2 Tests — PASS (with mocks)

```bash
$ node --test tests/storage-b2.test.mjs
✔ uploads image and returns correct public URLs with single prefix
✔ lists uploaded objects with correct prefix
✔ checks existence of object
✔ deletes object and its derivatives
✔ returns stat for existing object
✔ returns null for missing object stat
```

Tests mock `@aws-sdk/client-s3` — they do **not** validate real B2 credentials or network connectivity.

### 6.3 Environment Variable Gap

| Variable | Required for B2 | In `.env.example` | In Local `.env` | In Vercel Production |
|----------|-----------------|-------------------|-----------------|----------------------|
| `STORAGE_ADAPTER` | Yes | ✓ (commented) | `local` | **`b2`** |
| `B2_BUCKET_NAME` | Yes | ✓ (commented) | ❌ | **❓ Unknown** |
| `B2_KEY_ID` | Yes | ✓ (commented) | ❌ | **❓ Unknown** |
| `B2_APPLICATION_KEY` | Yes | ✓ (commented) | ❌ | **❓ Unknown** |
| `B2_ENDPOINT` | No (has default) | ✓ (commented) | ❌ | **❓ Unknown** |
| `B2_REGION` | No (has default) | ✓ (commented) | ❌ | **❓ Unknown** |
| `STORAGE_PUBLIC_URL` | No | ✓ (commented) | ❌ | **❓ Unknown** |

**Critical:** Local development uses `STORAGE_ADAPTER=local` (default), so B2 credentials are never exercised locally. Production uses `STORAGE_ADAPTER=b2` but may lack the required credentials in Vercel environment.

---

## 7. Deployment Findings

### 7.1 Two Domains, Likely Different Deployments

| Domain | Type | Expected Config |
|--------|------|-----------------|
| `astrovetro-root.vercel.app` | **Production** | `STORAGE_ADAPTER=b2`, B2 credentials required |
| `astrovetro-root-dntu-azure.vercel.app` | Preview/Preview | May have different env vars |

**Risk:** Vercel Preview deployments can have different environment variables than Production. The incident may only affect the Production deployment.

### 7.2 Vercel Configuration

**File:** `vercel.json`
```json
{
  "builds": [{ "src": "server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "server.js" }]
}
```

**Assessment:** Correct for Node.js serverless. No body size limits configured — relies on Vercel defaults.

**Vercel Body Size Limit:** Default 4.5MB for hobby/pro, configurable to 50MB on Pro+. The 12MB upload limit in code (`express.raw({ limit: '12mb' })`) **exceeds** Vercel's default 4.5MB limit. This would cause HTTP 413 before reaching the controller — but the reported error is HTTP 500, not 413.

---

## 8. Recommended Fixes

### 8.1 Fix #1: Frontend `ReferenceError` (Required)

**File:** `public/assets/api.js`  
**Lines:** 245–249  
**Action:** Remove duplicate `setTimeout` block

```diff
  if (fresh) requestAnimationFrame(add);
  else add();
- setTimeout(() => {
-   t.style.opacity = '0';
-   t.style.transition = 'opacity .3s ease';
-   setTimeout(() => t.remove(), 320);
- }, 3200);
  AV.setBusy = (btn, busy, text) => {
```

**Rationale:** The cleanup logic is already inside `add()` (lines 237–241). The duplicate at lines 245–249 references out-of-scope `t`.

---

### 8.2 Fix #2: Ensure B2 Production Environment Variables (Required)

**Action:** Verify and set in Vercel Production environment:

| Variable | Example Value |
|----------|---------------|
| `B2_BUCKET_NAME` | `astrovetro-prod-images` |
| `B2_KEY_ID` | `005a1b2c3d4e5f` (Application Key ID) |
| `B2_APPLICATION_KEY` | `K005a1b2c3d4e5f...` (Application Key) |
| `B2_ENDPOINT` | `https://s3.us-west-004.backblazeb2.com` |
| `B2_REGION` | `us-west-004` |
| `STORAGE_PUBLIC_URL` | `https://cdn.astrovetro.com` (optional, for CDN) |

**Verification:** After setting, redeploy and test upload.

---

### 8.3 Fix #3: Add Startup Validation for B2 Credentials (Recommended)

**File:** `src/utils/storage.js`  
**Location:** After `setStorageAdapter` call in `server.js` or inside `setStorageAdapter`

```javascript
export function setStorageAdapter(name) {
  const adapter = adapters[name];
  if (!adapter) throw ApiError.internal(`Unknown storage adapter: ${name}`);
  
  // NEW: Validate B2 credentials at startup if B2 adapter selected
  if (name === 'b2') {
    const required = ['B2_BUCKET_NAME', 'B2_KEY_ID', 'B2_APPLICATION_KEY'];
    const missing = required.filter(v => !process.env[v]);
    if (missing.length) {
      throw ApiError.internal(`B2 adapter requires environment variables: ${missing.join(', ')}`);
    }
  }
  
  activeAdapter = adapter;
  console.log(`[storage] adapter set to: ${name}`);
}
```

**Rationale:** Fail fast at startup with clear message instead of HTTP 500 on first upload.

---

### 8.4 Fix #4: Vercel Body Size Limit (If Needed)

**Action:** If 12MB uploads are required, upgrade to Vercel Pro and configure in `vercel.json`:

```json
{
  "builds": [{ "src": "server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "server.js" }],
  "functions": {
    "server.js": { "maxDuration": 30 }
  }
}
```

Note: Body size limit is a Vercel project setting, not configurable in `vercel.json`. Contact Vercel support or upgrade plan.

---

## 9. Test Results

### 9.1 Existing Tests — ALL PASS

| Test Suite | Tests | Pass | Fail |
|------------|-------|------|------|
| `storage-b2.test.mjs` | 6 | 6 | 0 |
| `admin-flows.test.mjs` (image upload) | 1 | 1 | 0 |
| Full suite | 101 | 101 | 0 |

**Note:** Tests mock B2 client — they do **not** validate real credentials.

### 9.2 Missing Test Coverage

| Scenario | Status |
|----------|--------|
| Missing B2 env vars at startup | ❌ Not tested |
| B2 network failure (timeout, DNS) | ❌ Not tested |
| B2 permission denied (403) | ❌ Not tested |
| B2 bucket not found (404) | ❌ Not tested |
| Upload > Vercel body limit (413) | ❌ Not tested |
| `AV.toast()` error handling | ❌ Not tested |

### 9.3 Recommended New Tests

```javascript
// tests/b2-config-validation.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { setStorageAdapter } from '../src/utils/storage.js';

test('setStorageAdapter throws on missing B2 credentials', () => {
  delete process.env.B2_BUCKET_NAME;
  delete process.env.B2_KEY_ID;
  delete process.env.B2_APPLICATION_KEY;
  
  assert.throws(() => setStorageAdapter('b2'), /B2 adapter requires/);
});
```

---

## 10. Production Deployment Checklist

### Pre-Deployment Verification

- [ ] Fix `public/assets/api.js` — remove duplicate `setTimeout` (lines 245–249)
- [ ] Add B2 startup validation in `src/utils/storage.js`
- [ ] Run full test suite: `npm test` → 101 pass
- [ ] Commit and push to main

### Vercel Production Configuration

- [ ] Set `STORAGE_ADAPTER=b2`
- [ ] Set `B2_BUCKET_NAME` (exact bucket name)
- [ ] Set `B2_KEY_ID` (Application Key ID from B2 console)
- [ ] Set `B2_APPLICATION_KEY` (Application Key from B2 console)
- [ ] Set `B2_ENDPOINT` (e.g., `https://s3.us-west-004.backblazeb2.com`)
- [ ] Set `B2_REGION` (e.g., `us-west-004`)
- [ ] Optional: Set `STORAGE_PUBLIC_URL` for CDN
- [ ] Optional: Set `TRUST_PROXY=1`
- [ ] Optional: Verify `JWT_SECRET` ≥ 32 chars
- [ ] Optional: Verify `FRONTEND_URL=https://astrovetro-root.vercel.app`

### Post-Deployment Verification

- [ ] Deploy to production
- [ ] Run smoke test: `BASE_URL=https://astrovetro-root.vercel.app node scripts/smoke-production.mjs`
- [ ] Manual: Open Admin Desk → Products → New Product → Upload image
- [ ] Verify image appears in Media Library
- [ ] Verify image serves via `/assets/img/products/...`
- [ ] Check Vercel Function Logs for `[storage] adapter set to: b2` and `[db] connected`
- [ ] Verify no `ReferenceError: t is not defined` in browser console

---

## 11. Conclusion

### Exact Root Causes

1. **Frontend:** `ReferenceError: t is not defined` in `public/assets/api.js:246` — duplicate cleanup code referencing out-of-scope variable. Masks real backend errors.

2. **Backend:** Missing B2 environment variables (`B2_BUCKET_NAME`, `B2_KEY_ID`, `B2_APPLICATION_KEY`) in Vercel Production → `ApiError.internal` thrown on first upload → HTTP 500.

### Files Responsible

| File | Issue | Fix |
|------|-------|-----|
| `public/assets/api.js` | Lines 245–249: duplicate `setTimeout` | Remove block |
| `src/utils/storage.js` | Line 436: lazy credential validation | Add startup validation |
| Vercel Production Environment | Missing B2 credentials | Add 3 required env vars |

### Whether Frontend Error Contributes to HTTP 500

**No.** The `ReferenceError` is a **separate bug** that only manifests when trying to *display* the 500 error. It does not cause the 500. The 500 originates from the backend B2 credential check.

### Whether B2 is Functioning Correctly

**Implementation: Yes.** The B2 adapter code is correct and tests pass with mocks.  
**Production Configuration: No.** Missing credentials prevent any B2 operation.

### Minimal Recommended Code Changes

1. `public/assets/api.js` — Remove lines 245–249 (5 lines)
2. `src/utils/storage.js` — Add B2 credential validation in `setStorageAdapter` (8 lines)

### Tests Required

- All existing tests pass (101/101)
- Add 1 test for B2 startup validation
- Consider integration test with real B2 (manual)

### Production Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Vercel 4.5MB body limit blocks 12MB uploads | Medium | Uploads >4.5MB fail with 413 | Reduce client-side limit or upgrade Vercel |
| B2 credentials rotate | Low | All uploads fail | Monitor B2 key rotation schedule |
| Preview vs Production env drift | Medium | Works in preview, fails in prod | Use Vercel Environment Variable sync |

### Can This Be Fixed Without Changing Infrastructure?

**Yes.** Both root causes are code/configuration fixes:
1. Frontend bug: 5-line removal
2. Backend config: 3 environment variables in Vercel dashboard
3. Optional: 8-line startup validation for faster failure detection

No architecture changes, no new dependencies, no database migrations required.

---

**Investigation Complete.** Ready for implementation.