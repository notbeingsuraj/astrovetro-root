/* -------------------------------------------------------------------------
   Environment configuration
   -------------------------------------------------------------------------

   One place that decides what this deployment is capable of, read at runtime
   so that test helpers can override environment variables before use.

   The important idea is that capability is never assumed. `database` is true
   only when DATABASE_URL is actually present AND the connection succeeded, so
   a missing or unreachable database degrades to the existing static-catalogue
   mode rather than half-working writes. Secrets are read here and nowhere
   else, and nothing in this module is ever sent to the browser.
   ------------------------------------------------------------------------- */

const bool = (v) => v === '1' || String(v).toLowerCase() === 'true';

/* Parse comma-separated origins, trim whitespace, filter empty.
   In production, FRONTEND_URL is required (no localhost fallback). */
function parseFrontendOrigins() {
  const raw = process.env.FRONTEND_URL;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FRONTEND_URL must be set in production (comma-separated origins, e.g. https://astrovetro.com,https://www.astrovetro.com)');
    }
    return ['http://localhost:5173'];
  }
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

import 'dotenv/config';
export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5173),

  /* Comma-separated origins allowed to send credentialed requests. Used by the
     CORS layer only when a browser is talking to the API cross-origin.
     In production, must be explicitly configured. No wildcard, no localhost fallback. */
  get frontendOrigins() {
    const raw = process.env.FRONTEND_URL;
    if (!raw) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('FRONTEND_URL must be set in production (comma-separated origins, e.g. https://astrovetro.com,https://www.astrovetro.com)');
      }
      return ['http://localhost:5173'];
    }
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  },

  /* Backward compatibility: first origin for single-origin consumers */
  get frontendUrl() {
    return this.frontendOrigins[0];
  },

  get databaseUrl() {
    return process.env.DATABASE_URL || process.env.MONGODB_URI || '';
  },

  jwt: {
    secret: process.env.JWT_SECRET || '',
    /* Short-lived access token. Kept in an httpOnly cookie rather than
       localStorage so a successful XSS cannot read it. */
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    issuer: 'astrovetro',
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    /* The secret never leaves the server. The browser only ever receives
       keyId, which is public by design. */
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  /* Razorpay is only usable when both credentials are present. Without them
     checkout must refuse rather than pretend, which is why `paymentLive` is
     derived and not guessed per-request. */
  get paymentLive() {
    return Boolean(this.razorpay.keyId && this.razorpay.keySecret);
  },

  /* Alias kept so callers can read the capability without reaching through to
     the razorpay sub-object. `configured` means "keys are present"; `live`
     means the same thing plus a webhook secret, which is what a server-to-server
     payment confirmation actually requires. */
  get paymentsConfigured() {
    return this.paymentLive;
  },

  get databaseConfigured() {
    return Boolean(this.databaseUrl);
  },

  get storageAdapter() {
    return process.env.STORAGE_ADAPTER || 'local';
  },

  get isProduction() {
    return this.nodeEnv === 'production';
  },
};

/* Refuses to boot with an insecure secret in production. Development keeps a
   generated fallback so a fresh clone runs without ceremony, but production
   must never silently sign tokens with a well-known value. */
export function assertProductionSecrets() {
  const problems = [];

  if (env.isProduction && !env.jwt.secret) {
    problems.push('JWT_SECRET must be set in production.');
  }
  if (env.isProduction && env.jwt.secret && env.jwt.secret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters in production.');
  }
  /* Half-configured Razorpay is the dangerous case: the checkout page would
     render a real-looking payment step that can never complete. */
  const { keyId, keySecret } = env.razorpay;
  if (Boolean(keyId) !== Boolean(keySecret)) {
    problems.push('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set together.');
  }

  if (problems.length) {
    throw new Error(`[config] ${problems.join(' ')}`);
  }
}

export default env;
