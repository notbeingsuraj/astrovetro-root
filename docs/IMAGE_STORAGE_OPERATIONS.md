# Astrovetro Image Storage Operations Guide

**Version:** 1.0  
**Date:** 2026-11-05  
**Audience:** DevOps, Backend Engineers, On-call Engineers

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        IMAGE STORAGE ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    POST /api/admin/images/upload     ┌──────────────────┐    │
│  │  Admin   │ ────────────────────────────────────▶ │  Express Server  │    │
│  │  Desk    │   multipart/form-data (raw image)     │  (server.js)     │    │
│  └──────────┘                                        └────────┬─────────┘    │
│                                                                 │              │
│                          express.raw({ type: 'image/*',         │              │
│                          limit: '12mb' })                       ▼              │
│                                                   ┌──────────────────────┐    │
│                                                   │  Upload Controller   │    │
│                                                   │  (adminImageCtrl)    │    │
│                                                   └──────────┬───────────┘    │
│                                                              │               │
│                                              getStorageAdapter()            │
│                                                              │               │
│                              ┌───────────────────────────────┼────────────┐ │
│                              ▼                               ▼            ▼ │
│                     ┌─────────────────┐            ┌─────────────────┐    │
│                     │   Local Adapter │            │    B2 Adapter     │    │
│                     │  (local fs)     │            │  (Backblaze B2)   │    │
│                     └────────┬────────┘            └────────┬────────┘    │
│                              │                              │              │
│                              ▼                              ▼              │
│                     ┌─────────────────┐            ┌─────────────────┐    │
│                     │ public/assets/  │            │  Backblaze B2   │    │
│                     │ img/library/    │            │  Bucket         │    │
│                     └─────────────────┘            └─────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Storage Adapters

### 2.1 Local Adapter (Default)
- **Path:** `public/assets/img/library/`
- **Use Case:** Development, single-server deployments
- **Persistence:** Survives container restarts; ephemeral on Vercel serverless
- **Configuration:** None required (default)

### 2.2 B2 Adapter (Production)
- **Provider:** Backblaze B2 (S3-compatible)
- **Bucket Structure:** `products/{base}-{variant}.webp`
- **Variants Generated:** `original`, `large` (1600px), `thumb` (480px)
- **Formats:** WebP for derivatives, original format preserved
- **Public URLs:** Via `STORAGE_PUBLIC_URL` or `/assets/img/` proxy

### 2.3 S3 Adapter (Alternative)
- **Providers:** AWS S3, Cloudflare R2, MinIO
- **Bucket Structure:** `library/` prefix
- **Configuration:** Requires `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`

---

## 3. Configuration

### 3.1 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STORAGE_ADAPTER` | ✅ | `local` | `local`, `b2`, or `s3` |
| `STORAGE_PUBLIC_URL` | No | `/assets/img` | Public URL base for generated URLs |
| **B2 Only** | | | |
| `B2_BUCKET_NAME` | ✅* | - | B2 bucket name |
| `B2_KEY_ID` | ✅* | - | Application Key ID |
| `B2_APPLICATION_KEY` | ✅* | - | Application Key (secret) |
| `B2_ENDPOINT` | No | `https://s3.us-west-004.backblazeb2.com` | Region-specific endpoint |
| `B2_REGION` | No | `us-west-004` | B2 region |
| **S3 Only** | | | |
| `S3_BUCKET` | ✅* | - | S3 bucket name |
| `S3_ACCESS_KEY_ID` | ✅* | - | Access key ID |
| `S3_SECRET_ACCESS_KEY` | ✅* | - | Secret access key |
| `S3_ENDPOINT` | No | - | Custom endpoint (R2/MinIO) |
| `S3_REGION` | No | `auto` | AWS region |

*Required when `STORAGE_ADAPTER=b2` or `STORAGE_ADAPTER=s3`*

### 3.2 Startup Validation

The application validates storage configuration at startup in `setStorageAdapter()`:

```javascript
// B2 validation
if (name === 'b2') {
  const required = ['B2_BUCKET_NAME', 'B2_KEY_ID', 'B2_APPLICATION_KEY'];
  const missing = required.filter(v => !process.env[v]);
  if (missing.length) throw ApiError.internal(...);
}

// S3 validation
if (name === 's3') {
  const required = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const missing = required.filter(v => !process.env[v]);
  if (missing.length) throw ApiError.internal(...);
}
```

**Failure Mode:** Process exits with clear error message listing missing variables.

---

## 3. Health Checks

### 3.1 `/health` Endpoint

Returns storage health alongside database status:

```json
{
  "status": "ok",
  "timestamp": "2026-11-05T08:15:41.035Z",
  "uptime": 187085.621,
  "database": "connected",
  "storage": {
    "provider": "local",
    "configured": true,
    "available": true
  },
  "environment": "development",
  "mongooseReadyState": 1
}
```

**Storage Health Fields:**
- `provider`: Active adapter name (`local`, `b2`, `s3`)
- `configured`: Whether required credentials are present
- `available`: Whether storage is operationally reachable

### 3.2 `/api/status` Endpoint

Both static and commerce APIs report storage:

```json
{
  "success": true,
  "data": {
    "provider": "mongo",
    "database": true,
    "writable": true,
    "storage": {
      "provider": "local",
      "configured": true,
      "available": true
    }
  }
}
```

---

## 4. Upload Operation

### 4.1 Request Format

```
POST /api/admin/images/upload
Content-Type: image/* (jpeg, png, webp, avif)
Content-Length: ≤ 12 MB
Body: Raw image bytes
```

### 4.2 Response (Success)

```json
{
  "success": true,
  "data": {
    "image": {
      "original": "/assets/img/products/abc-original.png",
      "large": "/assets/img/products/abc-large.webp",
      "thumb": "/assets/img/products/abc-thumb.webp",
      "width": 1920,
      "height": 1080,
      "size": 2048576
    }
  }
}
```

### 4.3 Error Responses

| Scenario | HTTP Status | Error Code | Message |
|----------|-------------|------------|---------|
| No file | 400 | BAD_REQUEST | "No image data received" |
| Empty file | 400 | BAD_REQUEST | "No image data received" |
| > 12 MB | 400 | BAD_REQUEST | "Image exceeds 12MB limit" |
| Invalid format | 400 | BAD_REQUEST | "Unrecognised image format" |
| B2 creds missing | 500 | INTERNAL_ERROR | "B2 adapter requires..." |
| B2 access denied | 403 | FORBIDDEN | "Storage access denied" |
| B2 bucket not found | 404 | NOT_FOUND | "Storage bucket not found" |
| B2 auth failure | 401 | UNAUTHORIZED | "Storage authentication failed" |
| B2 timeout | 503 | SERVICE_UNAVAILABLE | "Storage request timed out" |
| B2 rate limited | 429 | TOO_MANY_REQUESTS | "Storage rate limit exceeded" |
| Network error | 503 | SERVICE_UNAVAILABLE | "Storage service temporarily unavailable" |

---

## 4. Error Handling

### 4.1 Error Normalization

All S3/B2 errors are normalized via `normalizeS3Error()`:

```javascript
function normalizeS3Error(err, context) {
  // Maps S3 error codes to ApiError with appropriate HTTP status
  // Never exposes credentials in error messages
  // Logs safe diagnostic info for debugging
}
```

**Supported Error Mappings:**

| S3 Error Code | HTTP Status | ApiError Type |
|---------------|-------------|---------------|
| AccessDenied | 403 | FORBIDDEN |
| InvalidAccessKeyId | 401 | UNAUTHORIZED |
| SignatureDoesNotMatch | 401 | UNAUTHORIZED |
| NoSuchBucket | 404 | NOT_FOUND |
| RequestTimeout | 503 | SERVICE_UNAVAILABLE |
| SlowDown / Throttling | 429 | TOO_MANY_REQUESTS |
| NetworkingError / Timeout | 503 | SERVICE_UNAVAILABLE |
| EntityTooLarge | 400 | BAD_REQUEST |
| NoSuchKey | 404 | NOT_FOUND |
| InvalidObjectState | 409 | CONFLICT |
| KMS errors | 500 | INTERNAL_ERROR |
| Unknown + 5xx | 503 | SERVICE_UNAVAILABLE |
| Unknown + 4xx | 400 | BAD_REQUEST |
| Unknown + other | 500 | INTERNAL_ERROR |

### 4.2 Logging

All errors are logged with safe diagnostic info (no credentials):

```json
{
  "errorCode": "AccessDenied",
  "statusCode": 403,
  "context": "upload",
  "requestId": "abc123",
  "message": "Access denied for user?access_key=REDACTED"
}
```

---

## 5. Upload Flow

```
1. Admin selects file in browser
        │
        ▼
2. Client validates size (< 12 MB)
        │
        ▼
3. POST /api/admin/images/upload (raw image bytes)
        │
        ▼
4. Express: express.raw({ type: 'image/*', limit: '12mb' })
        │
        ▼
5. Controller: uploadImage()
        │  ├─ Validates buffer, size, magic bytes
        │  ├─ adapter = getStorageAdapter()
        │  └─ result = await adapter.upload({ buffer })
        │
        ▼
6. b2Adapter.upload() / localAdapter.upload()
        │  ├─ Validates buffer, detects image type (magic bytes)
        │  ├─ sharp: rotate, resize, webp conversion
        │  ├─ getB2Client() / local fs
        │  ├─ Upload 3 variants (original, large, thumb)
        │  └─ Returns { original, large, thumb, width, height, size }
        │
        ▼
7. Controller returns 201 with image URLs
        │
        ▼
8. Frontend: adds URL to imgs[], calls save()
        │
        ▼
9. PUT /api/admin/products/:id/images
        │
        ▼
10. setProductImages(): validates files exist, updates Product.images[]
```

---

## 6. Operations

### 6.1 Deployment Checklist

- [ ] Set `STORAGE_ADAPTER=b2` in Vercel Production
- [ ] Set `B2_BUCKET_NAME`, `B2_KEY_ID`, `B2_APPLICATION_KEY` in Vercel
- [ ] Set `B2_ENDPOINT` and `B2_REGION` (recommended)
- [ ] Optional: Set `STORAGE_PUBLIC_URL` for CDN
- [ ] Verify Vercel body size limit ≥ 12 MB (or reduce client limit)
- [ ] Deploy and verify startup log: `[storage] adapter set to: b2`

### 6.2 Post-Deploy Verification

```bash
# 1. Health check
curl https://astrovetro-root.vercel.app/health
# → storage.provider: "b2", configured: true, available: true

# 2. API status
curl https://astrovetro-root.vercel.app/api/status
# → storage.provider: "b2", configured: true, available: true

# 3. Manual Admin test
# Open https://astrovetro-root.vercel.app/admin.html
# Create product → Upload image → Verify image appears
# Check browser console: NO "ReferenceError: t is not defined"
```

### 6.3 Monitoring

**Key Metrics to Watch:**
- `/health` endpoint: `storage.available` should be `true`
- Function logs: `[storage] adapter set to: b2` at startup
- Upload latency: `< 2s` for 12 MB image
- Error rate: B2 errors should return structured codes (403, 404, 401) not 500

### 6.4 Troubleshooting

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| HTTP 500 on upload | Missing B2 creds | Check Vercel env vars |
| HTTP 403 on upload | Invalid B2 key | Verify B2_KEY_ID/APPLICATION_KEY |
| HTTP 404 on upload | Wrong bucket name | Verify B2_BUCKET_NAME |
| HTTP 401 on upload | Invalid key/secret | Regenerate B2 application key |
| HTTP 413 on upload | Vercel body limit | Reduce limit or upgrade Vercel |
| Images not loading | Wrong STORAGE_PUBLIC_URL | Check CDN config |
| Images lost after deploy | Using local on Vercel | Set STORAGE_ADAPTER=b2 |

### 6.5 Credential Rotation

1. Generate new B2 Application Key in B2 Console
2. Update `B2_KEY_ID` and `B2_APPLICATION_KEY` in Vercel
3. Redeploy (or wait for Vercel to pick up env changes)
4. Verify upload works
5. Delete old B2 Application Key

---

## 7. Troubleshooting Reference

### 7.1 Common Errors

| Error Message | Cause | Resolution |
|---------------|-------|------------|
| `B2 adapter requires B2_BUCKET_NAME...` | Missing env vars | Set all 3 B2 vars in Vercel |
| `Unknown storage adapter: b2` | Typo in STORAGE_ADAPTER | Set `STORAGE_ADAPTER=b2` |
| `S3 adapter requires S3_BUCKET...` | Using s3 without creds | Set S3 vars or change adapter |
| `Image exceeds 12MB limit` | File too large | Resize or increase limit |
| `Unrecognised image format` | Invalid file | Use JPEG/PNG/WebP/AVIF |

### 7.2 Debugging Commands

```bash
# Check storage config locally
STORAGE_ADAPTER=b2 B2_BUCKET_NAME=test B2_KEY_ID=test B2_APPLICATION_KEY=test \
  node -e "import('./src/utils/storage.js').then(m => m.setStorageAdapter('b2'))"

# Test health endpoint
curl http://localhost:5173/health | jq .storage

# Test upload locally
curl -X POST http://localhost:5173/api/admin/images/upload \
  -H "Content-Type: image/png" -H "Cookie: <admin_cookie>" \
  --data-binary @test.png | jq .
```

---

## 8. Security

### 8.1 Credential Handling
- Credentials never logged (stripped from error messages)
- Never exposed in client-side code
- Stored only in Vercel environment variables
- Rotated via B2 Console → Vercel env vars

### 8.2 Access Control
- Upload requires admin authentication (`requireAdmin` middleware)
- Image serving: public read access via `/assets/img/:path(*)`
- Delete requires admin auth + no active references

### 8.3 Data Integrity
- Magic bytes validation (not Content-Type header)
- Size limit enforced at Express middleware + controller
- Original format preserved; derivatives in WebP

---

## 9. Capacity Planning

| Metric | Value |
|--------|-------|
| Max upload size | 12 MB |
| Variants per upload | 3 (original, large, thumb) |
| Large variant max | 1600px |
| Thumb variant max | 480px |
| Format | WebP (derivatives), original (source) |
| Quality | 82 (large), 75 (thumb) |

### Storage Estimates
| Original Size | Variants Total | Monthly (100 uploads/day) |
|---------------|----------------|---------------------------|
| 5 MB | ~8 MB | ~24 GB |
| 10 MB | ~15 MB | ~45 GB |

---

## 10. Rollback Procedure

If B2 issues occur post-deploy:

1. **Immediate:** Set `STORAGE_ADAPTER=local` in Vercel → redeploy
2. **Verify:** Site works with local storage (images in `public/assets/img/`)
3. **Debug:** Fix B2 credentials/config
3. **Restore:** Set `STORAGE_ADAPTER=b2` → redeploy

---

## 11. Appendix

### 11.1 Key Files

| File | Purpose |
|------|---------|
| `src/utils/storage.js` | Adapter abstraction, health check, error normalization |
| `src/controllers/adminImageController.js` | Upload, list, delete, product image ops |
| `src/routes/admin.js` | Admin routes including `/images/upload` |
| `server.js` | Health endpoint, storage initialization |
| `public/assets/api.js` | Frontend upload logic, toast notifications |
| `public/assets/admin.js` | Admin UI image management |

### 11.2 Key Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `setStorageAdapter()` | `storage.js` | Initialize adapter, validate creds |
| `checkStorageHealth()` | `storage.js` | Health check for `/health` |
| `normalizeS3Error()` | `storage.js` | Convert S3 errors to ApiError |
| `b2Adapter.upload()` | `storage.js` | Upload to B2, generate variants |
| `localAdapter.upload()` | `storage.js` | Upload to local filesystem |
| `getStorageAdapter()` | `storage.js` | Get active adapter instance |

---

*Document Version 1.0 — Generated 2026-11-05*  
*For internal use by Astrovetro engineering team*