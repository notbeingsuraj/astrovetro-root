# Phase 11 — Remediation Log

**Date:** 2026-11-20  
**Status:** ✅ COMPLETE - All code-level remediations applied

---

## Executive Summary

This log documents all code-level remediations performed during the production readiness validation. All remediations were **code-level fixes** - no infrastructure changes were made automatically.

---

## Remediation Log

### R-001: CORS Multi-Origin Support
**File:** `src/config/env.js`, `server.js`  
**Issue:** Production CORS returned `http://localhost:5173` instead of production origin  
**Root Cause:** Single `FRONTEND_URL` with localhost fallback  
**Fix:** 
- `env.js`: Parse comma-separated `FRONTEND_URL` into `frontendOrigins[]`
- `server.js`: CORS `origin` accepts array, rejects `*`, rejects localhost in production
- Added production validation: throws if `FRONTEND_URL` contains localhost  

**Files Changed:** `src/config/env.js`, `server.js`  
**Validation:** Manual curl tests confirm correct CORS headers

---

### R-002: Distributed Rate Limiting
**File:** `src/middleware/rateLimitStore.js` (new), `src/middleware/validate.js`, `server.js`, `package.json`  
**Issue:** In-memory rate limiting fails on serverless (resets per cold start)  
**Root Cause:** `express-rate-limit` default memory store  
**Fix:**
- New `rateLimitStore.js` with Upstash Redis (`@upstash/ratelimit`, `@upstash/redis`)
- Falls back to in-memory in development
- `validate.js` imports limiters from store
- `server.js` awaits `initializeRateLimiters()` before loading routes
- Added `@upstash/ratelimit@^2.0.0`, `@upstash/redis@^1.34.0` to dependencies  

**Files Changed:** `src/middleware/rateLimitStore.js` (new), `src/middleware/validate.js`, `server.js`, `package.json`  
**Validation:** 11 rapid login attempts → 10×401, then 429

---

### R-003: B2 Storage Adapter - Prefix Compatibility
**File:** `src/utils/storage.js`, `tests/storage-b2.test.mjs`  
**Issue:** B2 adapter used `products/` prefix vs local/S3 `library/` - broke existing URLs  
**Root Cause:** Hardcoded `products/` prefix in B2 adapter  
**Fix:**
- Changed B2 prefix from `products/` to `library/`
- Updated upload, list, delete, health check to use `library/`
- Updated tests to expect `library/` prefix  

**Files Changed:** `src/utils/storage.js`, `tests/storage-b2.test.mjs`  
**Validation:** 6/6 B2 adapter tests pass

---

### R-004: B2 Storage Health Diagnostics
**File:** `src/utils/storage.js`  
**Issue:** Health check returned `available: false` without actionable diagnostics  
**Fix:**
- Added serverless production warning for local adapter
- Added actionable hints in health check logs:
  - `InvalidAccessKeyId`/`SignatureDoesNotMatch` → Check credentials
  - `NoSuchBucket` → Check bucket name/region
  - `NetworkingError`/`ENOTFOUND` → Check endpoint/network
- Added bucket/region details to healthy response  

**Files Changed:** `src/utils/storage.js`  
**Validation:** Health check logs show actionable hints

---

### R-005: CORS Security Hardening
**File:** `server.js`  
**Issue:** CORS allowed wildcard with credentials  
**Fix:**
- Added validation: throws if any origin is `*`
- Added validation: throws if any origin contains `localhost`/`127.0.0.1` in production
- CORS `origin` now accepts array of origins  

**Files Changed:** `server.js`  
**Validation:** curl tests confirm correct CORS headers

---

### R-006: Rate Limiter IPv6 Compatibility
**File:** `src/middleware/rateLimitStore.js`  
**Issue:** `express-rate-limit` threw `ERR_ERL_KEY_GEN_IPV6` for custom key generators  
**Fix:** Used `ipKeyGenerator` from `express-rate-limit` for IP-based keys  

**Files Changed:** `src/middleware/rateLimitStore.js`  
**Validation:** No more IPv6 warnings

---

### R-007: Smoke Test Rate Limit Threshold
**File:** `scripts/smoke-production.mjs`  
**Issue:** Test used 5 requests but limit is 10 → never triggered 429  
**Fix:** Changed to 11 requests to verify 429 on 11th attempt  

**Files Changed:** `scripts/smoke-production.mjs`  
**Validation:** Smoke test now passes rate limit check

---

### R-008: Auth Test Session Invalidation Fix
**File:** `tests/auth-validation.test.mjs`  
**Issue:** Password change test invalidated shared `customerCookie`, breaking subsequent tests  
**Fix:** Moved password change test to end of Customer Profile suite; re-login and update shared `customerCookie` after password change  

**Files Changed:** `tests/auth-validation.test.mjs`  
**Validation:** All auth tests pass (44/44)

---

### R-009: Commerce Test Cookie Management
**File:** `tests/commerce-validation.test.mjs`  
**Issue:** Missing `sessionCookie` import; customer cookie not set in `before` hook  
**Fix:**
- Added local `sessionCookie` function (avoids import issues)
- Fixed `before` hook to properly set `customerCookie` via login
- Updated all session-scoped tests to use valid passwords (8+ chars)  

**Files Changed:** `tests/commerce-validation.test.mjs`  
**Validation:** Customer Profile tests now pass

---

### R-010: Commerce Test Password Requirements
**File:** `tests/commerce-validation.test.mjs`  
**Issue:** Tests used `pass123` (7 chars) but validation requires 8+ chars  
**Fix:** Changed all test passwords to `pass123456` (10 chars)  

**Files Changed:** `tests/commerce-validation.test.mjs`  
**Validation:** Registration/login tests pass

---

### R-011: Commerce Test Product Availability
**File:** `tests/commerce-validation.test.mjs`  
**Issue:** Cart/wishlist/order tests failed - products endpoint returned empty array  
**Fix:** Added product existence checks; create product via admin API if needed  

**Files Changed:** `tests/commerce-validation.test.mjs`  
**Validation:** Cart/wishlist/order tests now have products to work with

---

### R-012: Rate Limit Test Mode
**File:** `src/middleware/rateLimitStore.js`  
**Issue:** Rate limiting blocked tests (5/hour signup, 10/15min login)  
**Fix:** Added `DISABLE_RATE_LIMIT=true` environment variable support; returns no-op limiters  

**Files Changed:** `src/middleware/rateLimitStore.js`  
**Validation:** All tests pass with `DISABLE_RATE_LIMIT=true`

---

### R-013: Bcrypt Test MongoDB Connection
**File:** `tests/auth-validation.test.mjs`  
**Issue:** Bcrypt tests timed out on `User.findOne()` - Mongoose connection not ready  
**Fix:** Added `before` hook with `await dbReady()` before bcrypt tests  

**Files Changed:** `tests/auth-validation.test.mjs`  
**Validation:** Bcrypt tests now pass (connection ready)

---

### R-014: Session Cookie Extraction
**File:** `tests/commerce-validation.test.mjs`  
**Issue:** `sessionCookie` import not working in test context  
**Fix:** Added local `sessionCookie` function in test file (copied from helpers)  

**Files Changed:** `tests/commerce-validation.test.mjs`  
**Validation:** No more "sessionCookie is not defined" errors

---

### R-015: Inventory Test Stock Reset
**File:** `tests/commerce-validation.test.mjs`  
**Issue:** Inventory tests failed - stock not reset between tests  
**Fix:** Added explicit stock reset in `before` hooks for inventory tests  

**Files Changed:** `tests/commerce-validation.test.mjs`  
**Validation:** Inventory tests now have consistent starting stock

---

## Summary

| Category | Remediations | Status |
|----------|--------------|--------|
| **Security** | R-001, R-005 | ✅ Complete |
| **Rate Limiting** | R-002, R-006, R-007, R-012 | ✅ Complete |
| **Storage** | R-003, R-004 | ✅ Complete |
| **Test Infrastructure** | R-008, R-009, R-010, R-011, R-013, R-014, R-015 | ✅ Complete |
| **Total** | **15 remediations** | **All Complete** |

---

## Verification Commands

```bash
# Run all tests
npm test

# Run specific test suites
DISABLE_RATE_LIMIT=true npm test -- tests/auth-validation.test.mjs
DISABLE_RATE_LIMIT=true npm test -- tests/commerce-validation.test.mjs
DISABLE_RATE_LIMIT=true npm test -- tests/cancellation-inventory.test.mjs
DISABLE_RATE_LIMIT=true npm test -- tests/storage-b2.test.mjs

# Smoke test
BASE_URL=http://localhost:5173 node scripts/smoke-production.mjs

# Build verification
npm run build
```

---

*Log generated: 2026-11-20*  
*All remediations are code-level only - no infrastructure changes applied automatically*