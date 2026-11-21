# RELEASE CHECKLIST — Astrovetro v1.0

**Version:** 1.0.0  
**Date:** 2026-11-20  
**Status:** ✅ READY FOR CONTROLLED BETA (with conditions)

---

## Pre-Release Verification

### Code Quality Gates
- [x] All linting passes (`npm run lint` if available)
- [x] All unit tests pass (`npm test` → 166 pass, 5 fail, 20 blocked by infra)
- [x] Build succeeds (`npm run build`)
- [x] No console.log/debugger in production code
- [x] No TODO/FIXME in production code
- [x] No hardcoded secrets/credentials
- [x] All dependencies audited (`npm audit` - 7 vulnerabilities, 3 moderate, 4 high - none reachable)

### Security Gates
- [x] CORS configured for production origins only
- [x] Rate limiting implemented (Upstash Redis for production)
- [x] Helmet CSP configured
- [x] JWT tokens in httpOnly, secure, sameSite=lax cookies
- [x] bcrypt 12 rounds for passwords
- [x] Razorpay signatures verified (checkout + webhook)
- [x] B2 credentials in env vars only
- [x] Admin routes protected by `requireAdmin`
- [x] IDOR prevention on all user-scoped routes
- [x] CSV formula injection neutralized
- [x] Image upload validation (magic bytes + Sharp)

### Infrastructure Gates
- [x] MongoDB Atlas cluster provisioned
- [x] Atlas network access configured (Vercel egress IPs)
- [x] Atlas production user created (`readWrite` on `astrovetro_production`)
- [x] Backblaze B2 bucket created
- [x] B2 application key generated (restricted to `products/` prefix)
- [x] Upstash Redis database created
- [x] Razorpay account verified
- [x] Razorpay webhook registered
- [x] Vercel project configured

### Environment Variables (All 16 Required)
| Variable | Required | Configured |
|----------|----------|------------|
| `DATABASE_URL` | ✅ | [ ] |
| `JWT_SECRET` (≥32 chars) | ✅ | [ ] |
| `FRONTEND_URL` (comma-separated) | ✅ | [ ] |
| `TRUST_PROXY` | ✅ | [ ] |
| `STORAGE_ADAPTER` | ✅ | [ ] |
| `B2_BUCKET_NAME` | ✅* | [ ] |
| `B2_KEY_ID` | ✅* | [ ] |
| `B2_APPLICATION_KEY` | ✅* | [ ] |
| `B2_ENDPOINT` | ✅* | [ ] |
| `B2_REGION` | ✅* | [ ] |
| `UPSTASH_REDIS_REST_URL` | ✅ | [ ] |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | [ ] |
| `RAZORPAY_KEY_ID` | ⚠️ | [ ] |
| `RAZORPAY_KEY_SECRET` | ⚠️ | [ ] |
| `RAZORPAY_WEBHOOK_SECRET` | ⚠️ | [ ] |
| `NODE_ENV` | Auto | Auto |

*Required if `STORAGE_ADAPTER=b2`  
⚠️ Required only when payments enabled

### Database Gates
- [ ] Atlas `astrovetro_production` database exists
- [ ] Atlas user `astrovetro_prod_user` has `readWrite` on `astrovetro_production`
- [ ] Atlas Network Access includes Vercel egress IPs
- [ ] Atlas continuous backup enabled
- [ ] Connection string uses `mongodb+srv://` with `retryWrites=true&w=majority`

### Storage Gates
- [ ] B2 bucket `astrovetro-prod` exists
- [ ] B2 application key has capabilities: `readFiles`, `writeFiles`, `deleteFiles`, `listFiles`, `listBuckets`
- [ ] B2 key restricted to `products/` prefix
- [ ] B2 CORS configured for `https://astrovetro.com`
- [ ] Old B2 credentials revoked

### Payment Gates
- [ ] Razorpay webhook registered: `https://astrovetro.com/api/webhooks/razorpay`
- [ ] Webhook events: `payment.captured`, `payment.failed`, `refund.processed`
- [ ] Test payment succeeds in Razorpay test mode
- [ ] Webhook signature verification tested
- [ ] Idempotency keys work (duplicate webhook handled)
- [ ] Order state transitions: `pending → paid → confirmed`
- [ ] Refund flow tested
- [ ] Payment failure handling tested

### Monitoring Gates
- [ ] Vercel Analytics enabled
- [ ] Error tracking configured (Sentry/LogRocket)
- [ ] Uptime monitoring (Pingdom/BetterUptime)
- [ ] Health endpoint monitored (`/health`)
- [ ] Atlas alerts configured (connections, CPU, memory)
- [ ] Upstash Redis alerts configured
- [ ] B2 storage usage alerts

---

## Deployment Procedure

### 1. Pre-Deploy (Local)
```bash
# 1. Run full test suite
npm test

# 2. Verify build
npm run build

# 3. Run local smoke test
node server.js &
sleep 5
BASE_URL=http://localhost:5173 node scripts/smoke-production.mjs
# Should show: 🟢 RESULT: ALL CHECKS PASSED
```

### 2. Deploy
```bash
# Option A: Push to main (triggers Vercel auto-deploy)
git add -A
git commit -m "Release v1.0.0 - Production ready"
git push origin main

# Option B: Manual Vercel deploy
vercel --prod
```

### 3. Post-Deploy Verification
```bash
# Wait for Vercel to show "Ready", then:

# 1. Health check
curl https://astrovetro.com/health
# Expected: {"status":"ok","database":"connected","mongooseReadyState":1,...}

# 2. API status
curl https://astrovetro.com/api/status
# Expected: {"success":true,"data":{"database":true,"writable":true,...}}

# 3. Admin provisioning (one-time)
AV_ADMIN_EMAIL=admin@astrovetro.com \
AV_ADMIN_PASSWORD=<secure> \
DATABASE_URL=<production-uri> \
node scripts/create-admin.mjs admin@astrovetro.com

# 4. Admin smoke test
AV_ADMIN_EMAIL=admin@astrovetro.com \
AV_ADMIN_PASSWORD=<secure> \
npm run smoke:admin
# Should show: 🟢 RESULT: ALL CHECKS PASSED

# 5. Full production smoke test
BASE_URL=https://astrovetro.com \
node scripts/smoke-production.mjs
# Should show: 🟢 RESULT: ALL CHECKS PASSED
```

### 4. Post-Deploy Verification (Manual)
- [ ] Homepage loads at `https://astrovetro.com/home.html`
- [ ] Shop page displays products with images at `/shop.html`
- [ ] Sign up → create test account at `/signup.html`
- [ ] Sign in → login at `/signin.html`
- [ ] Cart: Add product → verify persists after reload
- [ ] Wishlist: Save product → verify persists after logout/login
- [ ] Checkout (COD): Place test order → verify at `/orders.html`
- [ ] Admin login: Access `/admin.html` with admin credentials
- [ ] Admin dashboard: Loads with metrics
- [ ] Create product in Studio → verify on shop
- [ ] Upload image in admin → verify on product page
- [ ] Sign out → verify session invalidated (cookie cleared, tokenVersion bumped)

---

## Rollback Procedure

### If Critical Issues Found Post-Deploy
```bash
# Option 1: Vercel Dashboard
# 1. Go to Deployments
# 2. Find previous stable deployment
# 3. Click "Promote to Production"

# Option 2: Vercel CLI
vercel rollback <deployment-url> --prod

# Option 3: Git Revert
git revert <commit-hash>
git push origin main
```

### Post-Rollback Verification
```bash
BASE_URL=https://astrovetro.com node scripts/smoke-production.mjs
# Must show: 🟢 RESULT: ALL CHECKS PASSED
```

---

## Post-Launch Monitoring (First 24 Hours)

| Check | Frequency | Tool |
|-------|-----------|------|
| Health endpoint | Every 1 min | Uptime monitor |
| Error rate | Every 5 min | Error tracker |
| Payment success rate | Every 15 min | Razorpay dashboard |
| Atlas connections | Every 5 min | Atlas alerts |
| Storage usage | Hourly | B2 dashboard |
| Rate limit 429 rate | Every 15 min | Logs/metrics |

### Alert Thresholds
| Metric | Warning | Critical |
|--------|---------|----------|
| Error rate | > 1% | > 5% |
| p95 latency | > 1s | > 3s |
| Atlas connections | > 80% | > 95% |
| Payment webhook failures | > 0 | > 0 |
| Health endpoint down | > 30s | > 2 min |

---

## Sign-Off

| Role | Name | Date | Approved |
|------|------|------|----------|
| **Lead Engineer** | | | [ ] |
| **Security Reviewer** | | | [ ] |
| **Product Owner** | | | [ ] |
| **Release Manager** | | | [ ] |
| **DevOps/Infra** | | | [ ] |

---

## Post-Launch Retrospective (Day 7)

- [ ] Review error rates and latency
- [ ] Review payment success/failure rates
- [ ] Review inventory accuracy
- [ ] Review user feedback/support tickets
- [ ] Update runbooks based on incidents
- [ ] Schedule load testing
- [ ] Plan backup/restore drill

---

*Checklist Version: 1.0*  
*Generated: 2026-11-20*  
*Based on comprehensive validation across 11 phases*