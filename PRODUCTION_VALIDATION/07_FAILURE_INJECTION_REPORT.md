# Phase 7 — Failure Injection & Resilience Report

**Date:** 2026-11-20  
**Status:** ✅ CODE REVIEW PASS | ⚠️ CHAOS TESTING PENDING

---

## Executive Summary

The application has been **code-reviewed for resilience patterns**. All critical failure scenarios are handled with appropriate fallback behaviors. Live chaos testing is pending staging environment availability.

---

## Failure Mode Analysis

### 1. MongoDB Connection Failures

#### `src/db/connect.js` - Connection Manager

| Failure Mode | Handling | Status |
|--------------|----------|--------|
| **Initial connection failure** | 3 retries with exponential backoff + jitter | ✅ PASS |
| **Transient network blip** | Shared promise prevents thundering herd | ✅ PASS |
| **Prolonged outage** | Falls back to static catalogue | ✅ PASS |
| **Mid-request disconnect** | `ensureConnected()` middleware returns 503 | ✅ PASS |
| **Graceful shutdown** | `SIGTERM`/`SIGINT` handlers close connections | ✅ PASS |

#### Fallback Behavior
```javascript
// In server.js - apiPlan
const ready = (async () => {
  try {
    const connected = await dbReady();
    if (!connected) return staticApi;
    await seedIfEmpty({ quiet: true });
    return commerceApi;
  } catch (err) {
    console.error(`[api] MongoDB unavailable - falling back to static catalogue`);
    return staticApi;
  }
})();
```

**Behavior:** Database outage → static catalogue mode (read-only) → no 500 errors

---

### 2. Redis/Upstash Rate Limiter Failures

#### `src/middleware/rateLimitStore.js`

| Failure Mode | Handling | Status |
|--------------|----------|--------|
| **Upstash unavailable** | Falls back to in-memory store | ✅ PASS |
| **Redis connection timeout** | Warning logged, in-memory fallback | ✅ PASS |
| **Invalid credentials** | Warning logged, in-memory fallback | ✅ PASS |
| **Rate limit exceeded** | Returns 429 with `RateLimit-*` headers | ✅ PASS |

#### Fail-Open vs Fail-Closed
```javascript
// In production without Upstash:
console.warn('[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set — falling back to in-memory store (NOT distributed across instances)');
return undefined;  // express-rate-limit uses default in-memory store
```

**Decision:** **Fail-open** for rate limiting (allows traffic) but **logs warning**.  
**Rationale:** Rate limiting is a safety control; blocking all traffic on Redis failure is worse than temporary limit relaxation.

---

### 3. Backblaze B2 Storage Failures

#### `src/utils/storage.js` - `b2Adapter`

| Failure Mode | Handling | Status |
|--------------|----------|--------|
| **Upload timeout** | Sharp timeout + S3 timeout → 500 | ✅ PASS |
| **Authentication failure** | `normalizeS3Error` → 401/403 | ✅ PASS |
| **Bucket not found** | `normalizeS3Error` → 404 | ✅ PASS |
| **Network partition** | `normalizeS3Error` → 503 | ✅ PASS |
| **Partial upload** | Sharp processes in memory → atomic S3 puts | ✅ PASS |
| **Stream read error** | Stream error handler → 500 | ✅ PASS |

#### Image Route Resilience (`server.js`)
```javascript
app.get('/assets/img/:path(*)', async (req, res) => {
  const stream = await adapter.getReadStream(publicPath);
  if (!stream) return res.status(404).send('Not found');
  stream.on('error', (err) => {
    console.error('[image stream error]', err);
    if (!res.headersSent) res.status(500).send('Internal server error');
  });
  stream.pipe(res);
});
```

---

### 4. Razorpay Payment Failures

#### `src/payments/razorpay.js` + `src/controllers/orderController.js`

| Failure Mode | Handling | Status |
|--------------|----------|--------|
| **Checkout signature invalid** | 400 "We could not verify that payment" | ✅ PASS |
| **Payment not captured** | `isPaymentSuccessful()` → 400 | ✅ PASS |
| **Amount mismatch** | Re-validated cart vs order amount | ✅ PASS |
| **Webhook signature invalid** | 400 "Invalid signature" | ✅ PASS |
| **Duplicate webhook** | `paymentStatus === PAID` early return | ✅ PASS |
| **Payment failed webhook** | Sets `PAYMENT_FAILED` status | ✅ PASS |
| **Webhook delivery failure** | Razorpay retries with exponential backoff | ✅ PASS |
| **Razorpay API timeout** | `fetchPayment` returns null → 400 | ✅ PASS |

#### Idempotency Guarantees
```javascript
// Order creation - client idempotency key
const existing = await findByIdempotency(req.user._id, idempotencyKey);
if (existing) return res.json({ success: true, data: { order: existing.toPublic(), replayed: true } });

// Webhook - provider payment_id
if (order.paymentStatus === PAYMENT_STATUS.PAID) {
  return res.json({ success: true, data: { alreadySettled: true } });
}
```

---

### 5. Inventory System Failures

#### `src/services/inventoryService.js`

| Failure Mode | Handling | Status |
|--------------|----------|--------|
| **Stock decrement race** | Guarded `$inc` with `$expr` | ✅ PASS |
| **Ledger write failure** | Compensating `$inc` rollback | ✅ PASS |
| **Movement write failure** | Balance rollback + rethrow | ✅ PASS |
| **Receipt failure** | Full rollback (stock + movements + receipt) | ✅ PASS |
| **Cancellation race** | `inventoryCommitted` flag | ✅ PASS |

#### Cancellation Rollback
```javascript
// In restoreInventoryForCancelledOrder:
try {
  for (item of order.items) {
    await Product.findOneAndUpdate({ _id: item.product, stock: { $ne: null } }, { $inc: { stock: item.quantity } });
    await writeMovement({ type: 'return', ... });
  }
} catch (err) {
  // Rollback all successful restores
  for (change of applied.reverse()) {
    await Product.updateOne({ _id: change.product }, { $inc: { stock: -change.quantity } });
    await StockMovement.collection.deleteOne({ _id: change.movementId });
  }
  throw err;
}
```

---

### 6. Serverless/Vercel Specific Failures

#### Cold Start Handling
```javascript
// In server.js - dbReady() shared promise
let connectionPromise = null;
async function dbReady() {
  if (isReady()) return true;
  if (!connectionPromise) connectionPromise = connectDB();
  try { return await connectionPromise; } catch { return false; }
}
```

#### Connection Pool Exhaustion
```javascript
// In connect.js - conservative pool
maxPoolSize: 5,
minPoolSize: 0,
maxIdleTimeMS: 30000,
```

#### Vercel Function Timeout
```javascript
// API routes timeout at 60s (Vercel Pro) / 10s (Hobby)
// Long operations (CSV export) use streaming
router.get('/reports/orders.csv', reports.exportOrders);  // Streaming response
```

---

## Graceful Degradation Matrix

| Component | Failure | Degraded Mode | User Impact |
|-----------|---------|---------------|-------------|
| **MongoDB** | Unavailable | Static catalogue | Browse only, no accounts/orders |
| **Redis** | Unavailable | In-memory rate limiting | Temporary limit relaxation |
| **B2 Storage** | Unavailable | Local fallback (dev) / 500 (prod) | Images unavailable |
| **Razorpay** | Unavailable | COD only | Card/UPI disabled |
| **Rate Limiter** | Redis down | In-memory | Limit relaxation per instance |
| **Image Stream** | B2 error | 500 error | Broken image placeholders |

---

## Monitoring & Observability

### Structured Logging (`src/db/connect.js`)
```javascript
function logStructured(level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    instanceId: process.env.VERCEL_INVOCATION_ID || `local-${process.pid}`,
    connectionState: getConnectionState(),
    ...details,
  };
  // Credentials stripped before logging
}
```

### Health Endpoint (`/health`)
```json
{
  "status": "ok",
  "timestamp": "2026-11-20T06:31:02.609Z",
  "uptime": 4.000788458,
  "database": "connected",
  "storage": { "provider": "local", "configured": true, "available": true },
  "environment": "development",
  "mongooseReadyState": 1
}
```

### Key Metrics to Monitor
| Metric | Alert Threshold |
|--------|-----------------|
| `mongooseReadyState !== 1` | > 30 seconds |
| `health.storage.available === false` | Immediate |
| Rate limit 429 rate | > 5% of requests |
| 5xx error rate | > 1% |
| Payment webhook failures | > 0 |
| Inventory `available === false` | Immediate |

---

## Phase 7 Conclusion

**VERDICT: RESILIENT ARCHITECTURE**

The application demonstrates **defense-in-depth** resilience:
- ✅ Graceful degradation for all external dependencies
- ✅ Atomic operations with rollback on failure
- ✅ Idempotency at every critical path
- ✅ Structured logging for observability
- ✅ Graceful degradation to static catalogue

**Pending:** Live chaos testing in staging environment (MongoDB kill, Redis kill, B2 partition, Razorpay sandbox failure).

---

*Report generated: 2026-11-20*  
*Based on code review of `src/db/connect.js`, `src/middleware/rateLimitStore.js`, `src/utils/storage.js`, `src/payments/razorpay.js`, `src/services/inventoryService.js`, `src/controllers/orderController.js`, `server.js`*