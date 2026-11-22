# WS-1 Provisioning Checklist — Phase 1.4 Production Readiness

**Canonical Repository:** `notbeingsuraj/astrovetro-root`  
**Branch:** `recovery/phase-1.4-canonical`  
**Last Updated:** 2026-11-22

---

## Status Legend
- ⬜ = NOT_STARTED
- 🔄 = IN_PROGRESS
- ✅ = COMPLETE
- ❌ = FAILED
- ⏸️ = BLOCKED
- 📝 = DOCUMENTED (not yet executed)

---

## Sequential Checklist

### Phase 1: Infrastructure Prerequisites (Day 1)

| # | Prerequisite | Action | Expected Result | Verification | Evidence | Rollback | Status |
|---|--------------|--------|-----------------|--------------|----------|----------|--------|
| 1.1 | Vercel account + org access | Request from team | Vercel account accessible | `vercel whoami` | Screenshot | N/A | ⬜ |
| 1.2 | Vercel organization ID | Dashboard → Settings → General | `team_xxxxx` recorded | Copied to secrets | `VERCEL_ORG_ID` in GitHub secrets | N/A | ⬜ |
| 1.2.1 | **Capture actual Vercel Project ID** | Dashboard → Settings → General after project creation | `prj_abc123` recorded | GitHub secret `VERCEL_PROJECT_ID` set | Screenshot of dashboard | N/A | ⬜ |
| 1.3 | DNS provider access | Request from team | DNS access confirmed | `dig staging.astrovetro.com CNAME` | DNS records | N/A | ⬜ |
| 1.4 | MongoDB Atlas account | Create org/project | Atlas access confirmed | Atlas dashboard accessible | Atlas org/project created | N/A | ⬜ |
| 1.5 | Upstash Redis account | Create staging instance | Upstash access confirmed | `curl /ping` works | Upstash dashboard accessible | N/A | ⬜ |
| 1.6 | Razorpay test account | **Apply NOW** (3-7 days) | Application submitted | Confirmation email | Application ID/email | N/A | ⬜ |
| 1.7 | GitHub Actions enabled | Verify in repo settings | Actions tab accessible | Push to test branch | Actions tab works | N/A | ✅ |
| 1.8 | GitHub Secrets permissions | Admin access to repo | Secrets writable | `gh secret list` | Secrets UI accessible | N/A | ⬜ |

---

### Phase 2: Vercel Staging Project (Day 1-2)

| # | Prerequisite | Action | Expected Result | Verification | Evidence | Rollback | Status |
|---|--------------|--------|-----------------|--------------|----------|----------|--------|
| 2.1 | Vercel CLI installed | `npm i -g vercel@latest` | CLI available | `vercel --version` | Version output | N/A | ⬜ |
| 2.2 | Vercel login | `vercel login` | Authenticated | `vercel whoami` | User/org output | N/A | ⬜ |
| 2.3 | Create staging project | `vercel init astrovetro-staging --scope=<org>` | Project created | `vercel ls --scope=astrovetro-staging` | Project listed | `vercel project rm` | ⬜ |
| 2.4 | Configure project | Framework: Other, Build: `echo "No build step"`, Output: `public`, Install: `npm ci` | Settings saved | Dashboard → Settings | Screenshot | N/A | ⬜ |
| 2.5 | **Capture actual Project ID** | Dashboard → Settings → General | `prj_abc123` recorded | GitHub secret `VERCEL_PROJECT_ID` set | Screenshot of dashboard | N/A | ⬜ |
| 2.6 | Add custom domain | `staging.astrovetro.com` | Domain added | Dashboard → Domains | Domain listed | Remove domain | ⬜ |
| 2.7 | DNS CNAME | `staging.astrovetro.com` → `cname.vercel-dns.com` | DNS propagates | `dig staging.astrovetro.com CNAME` | DNS records | Revert CNAME | ⬜ |
| 2.8 | TLS certificate | Vercel auto-provision | HTTPS works | `curl -I https://staging.astrovetro.com` | Cert details | N/A | ⬜ |
| 2.9 | Create `vercel-staging.json` | At repo root with rewrites | File committed | `git status` | File content | `git rm` | ⬜ |
| 2.10 | Deploy staging | `vercel --prod --config vercel-staging.json --token=$VERCEL_TOKEN --scope=astrovetro-staging` | Deployment live | `curl https://staging.astrovetro.com/api/health` | Health JSON | `vercel rollback` | ⬜ |
| 2.11 | Verify rewrites | `curl -I https://staging.astrovetro.com/api/health` | 200 + X-Environment: staging | Response headers | Header output | N/A | ⬜ |

---

### Phase 3: MongoDB Atlas M0 (Day 1-2)

| # | Prerequisite | Action | Expected Result | Verification | Evidence | Rollback | Status |
|---|--------------|--------|-----------------|--------------|----------|----------|--------|
| 3.1 | Create Atlas project | `astrovetro-staging` | Project created | Atlas dashboard | Screenshot | N/A | ⬜ |
| 3.2 | Create M0 cluster | Standalone, AWS us-east-1 | Cluster running | Atlas dashboard | Cluster status | Delete cluster | ⬜ |
| 3.3 | Configure IP allowlist | Add Vercel outbound IPs ONLY | Connection works | `mongosh` from Vercel | IP list screenshot | Remove IPs | ⬜ |
| 3.3.1 | **NO 0.0.0.0/0** | Verify allowlist | No unrestricted access | Atlas Network Access tab | IP list | N/A | ⬜ |
| 3.4 | Create DB user | `staging-user` / readWrite on `astrovetro_staging` | Auth works | `mongosh` auth | Credentials in 1Password | Delete user | ⬜ |
| 3.5 | Get connection string | SRV URI | `MONGODB_URI_STAGING` secret set | `npm run seed` | URI in secrets | Rotate password | ⬜ |
| 3.6 | Verify indexes | Check required indexes exist | Indexes present | `mongosh` → `db.products.getIndexes()` | Index list | N/A | ⬜ |
| 3.7 | Run seed | `MONGODB_URI=<staging-uri> npm run seed` | Data seeded | `mongosh` → `db.products.count()` | Count output | `db.dropDatabase()` | ⬜ |

---

### Phase 4: Upstash Redis (Day 1-2)

| # | Prerequisite | Action | Expected Result | Verification | Evidence | Rollback | Status |
|---|--------------|--------|-----------------|--------------|----------|----------|--------|
| 4.1 | Create Upstash account | console.upstash.com | Account created | Dashboard accessible | Screenshot | N/A | ⬜ |
| 4.2 | Create staging DB | Name: `astrovetro-staging`, Free tier | DB running | Dashboard | Instance details | Delete DB | ⬜ |
| 4.3 | Get credentials | Copy REST URL + Token | Secrets documented | `curl /ping` returns PONG | Credentials in 1Password | Revoke token | ⬜ |
| 4.5 | Add to Vercel env vars | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Secrets set | Vercel dashboard → Env vars | Secrets list | Remove env vars | ⬜ |

---

### Phase 5: DNS and TLS (Day 1-2)

| # | Prerequisite | Action | Expected Result | Verification | Evidence | Rollback | Status |
|---|--------------|--------|-----------------|--------------|----------|----------|--------|
| 5.1 | CNAME record | `staging.astrovetro.com` → `cname.vercel-dns.com` | DNS resolves | `dig staging.astrovetro.com CNAME` | DNS output | Revert CNAME | ⬜ |
| 5.2 | TXT verification | Vercel-provided TXT | Domain verified | Vercel dashboard → verified | DNS records | Revert TXT | ⬜ |
| 5.3 | SSL certificate | Vercel auto-provision | HTTPS works | `curl -I https://staging.astrovetro.com` | Cert details | N/A | ⬜ |
| 5.4 | HTTPS verification | `curl -I https://staging.astrovetro.com/api/health` | 200 + valid cert | Response headers | Cert details | N/A | ⬜ |

---

### Phase 6: Staging Deployment (Day 2-3)

| # | Prerequisite | Action | Expected Result | Verification | Evidence | Rollback | Status |
|---|--------------|--------|-----------------|--------------|----------|----------|--------|
| 6.1 | Add all env vars to Vercel | Dashboard → Settings → Env vars | All secrets set | `vercel env ls --scope=astrovetro-staging` | Env var list | `vercel env rm` | ⬜ |
| 6.2 | Deploy to staging | `vercel --prod --config vercel-staging.json --token=$VERCEL_TOKEN --scope=astrovetro-staging` | Deployment live | Deployment URL accessible | Deployment URL | `vercel rollback` | ⬜ |
| 6.3 | Health check | `curl https://staging.astrovetro.com/api/health` | 200 + JSON | Response JSON | Health output | N/A | ⬜ |
| 6.4 | Verify rewrites | `curl -I https://staging.astrovetro.com/api/health` | 200 + X-Environment: staging | Response headers | Header output | N/A | ⬜ |
| 6.5 | Verify same-origin /api | Browser dev tools → Network | /api/* same origin | Screenshot | N/A | ⬜ |

---

### Phase 7: CI/CD Pipeline (Day 3-5)

| # | Prerequisite | Action | Expected Result | Verification | Evidence | Rollback | Status |
|---|--------------|--------|-----------------|--------------|----------|----------|--------|
| 7.1 | Create `.github/workflows/ci-cd.yml` | Jobs: test → lint → build → deploy-staging → smoke → e2e | Workflow file committed | `git status` | File content | `git rm` | ⬜ |
| 7.2 | Add GitHub secrets | All staging secrets added | Secrets accessible | `gh secret list` | Secrets list | Remove secrets | ⬜ |
| 7.2.1 | `VERCEL_TOKEN` | Vercel token | Added | `gh secret list` | Secret listed | Remove | ⬜ |
| 7.2.2 | `VERCEL_ORG_ID` | Vercel org ID | Added | `gh secret list` | Secret listed | Remove | ⬜ |
| 7.2.3 | `VERCEL_PROJECT_ID` | **Actual Project ID** | Added | `gh secret list` | Secret listed | Remove | ⬜ |
| 7.2.4 | `MONGODB_URI_STAGING` | Atlas connection string | Added | `gh secret list` | Secret listed | Remove | ⬜ |
| 7.2.5 | `UPSTASH_REDIS_REST_URL` | Upstash URL | Added | `gh secret list` | Secret listed | Remove | ⬜ |
| 7.2.6 | `UPSTASH_REDIS_REST_TOKEN` | Upstash token | Added | `gh secret list` | Secret listed | Remove | ⬜ |
| 7.3 | Push to test branch | `git push origin test-branch` | Pipeline triggered | GitHub Actions tab | Run logs | Revert push | ⬜ |
| 7.4 | Verify job order | test → lint → build → deploy-staging → smoke → e2e | Correct order | Actions UI | Screenshot | N/A | ⬜ |
| 7.6 | Verify pre-deploy guard | Push with wrong Project ID | Deploy fails | Actions UI | Error message | Fix ID | ⬜ |
| 7.7 | Verify e2e against staging | `PLAYWRIGHT_BASE_URL=https://staging.astrovetro.com` | Tests run against deployed | Actions UI | Test results | N/A | ⬜ |

---

### Phase 8: Middleware Implementation (Day 4-6)

| # | Prerequisite | Action | Expected Result | Verification | Evidence | Rollback | Status |
|---|--------------|--------|-----------------|--------------|----------|----------|--------|
| 8.1 | Create `src/middleware/requestDrain.js` | Per-request finalized guard | File exists | `cat src/middleware/requestDrain.js` | File content | `git rm` | ⬜ |
| 8.2 | Unit tests `tests/unit/requestDrain.test.mjs` | 7 tests pass | `npm test` | Test output | Test results | `git rm` | ⬜ |
| 8.3 | Create `src/middleware/csrf.js` | Double-submit cookie | File exists | `cat src/middleware/csrf.js` | File content | `git rm` | ⬜ |
| 8.3 | Unit tests `tests/unit/csrf.test.mjs` | Tests pass | `npm test` | Test output | Test results | `git rm` | ⬜ |
| 8.4 | Create `src/middleware/auditLog.js` | Best-effort logging | File exists | `cat src/middleware/auditLog.js` | File content | `git rm` | ⬜ |
| 8.5 | Enhance `src/services/auditService.js` | Add `recordAudit`/`auditBestEffort` | File enhanced | `cat src/services/auditService.js` | File content | `git checkout` | ⬜ |
| 8.6 | Unit tests `tests/unit/auditLog.test.mjs` | Tests pass | `npm test` | Test output | Test results | `git rm` | ⬜ |
| 8.7 | Integrate in `server.js` | Import + middleware chain + health endpoint | Middleware active | `curl /health` | Health JSON | `git checkout` | ⬜ |
| 8.7.1 | Health endpoint shows timeout budget | `{ timeoutBudget: { functionTimeoutMs: 10000, drainTimeoutMs: 8000 } }` | `curl /health` | `jq .timeoutBudget` | Health output | `git checkout` | ⬜ |
| 8.8 | Integration tests `tests/integration/graceful-shutdown.test.mjs` | Serverless timeout model tests pass | `npm test` | Test output | Test results | `git rm` | ⬜ |
| 8.9 | Staging health tests `tests/integration/staging-health.test.mjs` | Tests pass against staging | `npm test` | Test output | Test results | `git rm` | ⬜ |

---

### Phase 9: Playwright E2E (Day 5-8)

| # | Prerequisite | Action | Expected Result | Verification | Evidence | Rollback | Status |
|---|--------------|--------|-----------------|--------------|----------|----------|--------|
| 9.1 | Install Playwright | `npm install -D @playwright/test` | Installed | `npx playwright --version` | Version | `npm uninstall` | ⬜ |
| 9.2 | Install browsers | `npx playwright install chromium` | Installed | `ls ~/.cache/ms-playwright/` | Dir exists | N/A | ⬜ |
| 9.3 | Create `tests/playwright.config.ts` | Config valid | `npx playwright test --list` | Test list | Config file | `git rm` | ⬜ |
| 9.4 | Inspect staging HTML | Visit `https://staging.astrovetro.com/shop` | Selectors documented | `cat tests/e2e/selectors.md` | Selectors doc | N/A | ⬜ |
| 9.5 | Create `tests/e2e/selectors.md` | Documented selectors | File exists | `cat tests/e2e/selectors.md` | Selectors | `git rm` | ⬜ |
| 9.6 | Create `tests/e2e/cart.spec.ts` | SV-007 test with inspected selectors | Test passes | `npm run test:e2e:ci` | Test output | `git rm` | ⬜ |
| 9.6.1 | Test data cleanup | `beforeEach`/`afterEach` cleanup | No orphan data | Check staging DB | Clean state | N/A | ⬜ |

---

### Phase 10: Staging Verification Execution (Day 9-11)

| # | SV | Description | Verification Method | Evidence Required | Status |
|---|----|-------------|---------------------|-------------------|--------|
| 10.1 | SV-001 | Reverse-proxy cookie behavior | Playwright login → verify cookie → API call | Screenshots + curl output | ⬜ |
| 10.2 | SV-002 | Browser CSP enforcement | Playwright: page.goto() → check headers → console | Screenshots + header output | ⬜ |
| 10.3 | SV-003 | 100 parallel orders | Node script + DB verification | Script output + mongosh | ⬜ |
| 10.4 | SV-004 | 15-min lock expiry | 5 failed logins → wait → successful login | curl output + mongosh | ⬜ |
| 10.5 | SV-005 | Admin unlock endpoint | Admin unlock → user login succeeds, audit logged | curl + mongosh | ⬜ |
| 10.6 | SV-006 | Serverless timeout budget | Vercel logs show 10s compliance, health shows budget | Vercel logs + health JSON | ⬜ |
| 10.7 | SV-007 | E2E cart-clear flow | Playwright test passes in CI | CI artifacts + test output | ⬜ |
| 10.8 | SV-008 | CSRF origin allowlist | Playwright checkout from staging → valid, localhost → 403 | Test output + curl | ⬜ |

---

### Phase 11: Documentation & Sign-off (Day 12-13)

| # | Prerequisite | Action | Expected Result | Verification | Evidence | Status |
|---|--------------|--------|-----------------|--------------|----------|--------|
| 11.1 | Create `RUNBOOK.md` | All sections complete | File exists | `cat RUNBOOK.md` | File content | ⬜ |
| 11.2 | Update `STATE.md` | M2 completion | Phase 1.4 = ✅ Complete | `cat .planning/STATE.md` | File content | ⬜ |
| 11.3 | Update `ROADMAP.md` | Milestone tracking | M2 = Complete, Phase 2.0 = 📋 Planned | `cat .planning/ROADMAP.md` | File content | ⬜ |
| 11.4 | Create `01-04-SUMMARY.md` | M2 completion summary | File exists | `cat .planning/phases/01-4-production-readiness/01-04-SUMMARY.md` | File content | ⬜ |
| 11.5 | Update Phase 2.0 status | 🔒 Blocked → 📋 Planned | `cat .planning/STATE.md` | File content | ⬜ |

---

## Status Summary

| Category | Total | Complete | In Progress | Not Started | Blocked |
|----------|-------|----------|-------------|-------------|---------|
| Prerequisites | 8 | 1 | 0 | 7 | 0 |
| Vercel Project | 11 | 0 | 0 | 11 | 0 |
| MongoDB Atlas | 7 | 0 | 0 | 7 | 0 |
| Upstash Redis | 5 | 0 | 0 | 5 | 0 |
| DNS/TLS | 4 | 0 | 0 | 4 | 0 |
| Staging Deploy | 5 | 0 | 0 | 5 | 0 |
| CI/CD Pipeline | 10 | 0 | 0 | 10 | 0 |
| Middleware | 9 | 0 | 0 | 9 | 0 |
| Playwright E2E | 7 | 0 | 0 | 7 | 0 |
| SV Verification | 8 | 0 | 0 | 8 | 0 |
| Documentation | 5 | 0 | 0 | 5 | 0 |
| **TOTAL** | **94** | **1** | **0** | **93** | **0** |

---

## Final Approval Gate

**WS-1 Documentation Complete:** ✅  
**Ready for Architect Approval:** ⬜  
**Ready for Provisioning Execution:** ⬜ (pending approval + credentials)

### Approval Required:
- [ ] Architect: Serverless timeout model (10s function, 8s drain)
- [ ] Architect: Atlas M0 confirmed sufficient
- [ ] Team: Vercel/Atlas/Upstash/DNS credentials provided
- [ ] Team: Razorpay test account applied (start NOW)

---

**Checklist Status:** Documentation Complete — Awaiting Architect Approval  
**Next Action:** Present to architect for serverless timeout model approval, then begin WS-1 Task 1 execution with credentials.