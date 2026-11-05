/* -------------------------------------------------------------------------
   Database connection
   -------------------------------------------------------------------------

   Connects mongoose when DATABASE_URL is present and reports honestly when it
   is not.

   The site has always deployed without a database, serving the static
   catalogue and refusing writes with DATABASE_NOT_CONFIGURED. That behaviour
   is deliberate and stays: if the URL is missing, or the connection fails, this
   module reports `false` and the caller keeps using the static provider. A
   storefront that can browse is better than one that half-writes.

   `connected` is only ever true after a successful ping, so no route can act
   on a connection that has not actually been established.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';
import { env } from '../config/env.js';

/* -------------------------------------------------------------------------
   Centralized MongoDB Connection Manager
   -------------------------------------------------------------------------

   Provides a robust connection lifecycle for both traditional and serverless
   environments. Key guarantees:

   - Single shared connection promise (no duplicate concurrent connections)
   - Awaits actual readiness (ping success) before resolving
   - Rejects new operations during connection failure with clear errors
   - Handles disconnect/reconnect events automatically
   - Avoids unbounded retries with exponential backoff
   - Compatible with Vercel serverless (warm/cold starts)
   - Structured logging without credential leakage
   ------------------------------------------------------------------------- */

let connectionPromise = null;
let connectionAttempt = 0;
let isShuttingDown = false;

/* Connection state derived from mongoose, not a separate flag.
   This eliminates the race between readyState and a separate flag. */
function getConnectionState() {
  const state = mongoose.connection.readyState;
  if (state === 1) return 'connected';
  if (state === 2) return 'connecting';
  if (state === 3) return 'disconnecting';
  return 'disconnected';
}

function isReady() {
  return mongoose.connection.readyState === 1;
}

function isConnected() {
  return mongoose.connection.readyState === 1;
}

/* Instance identifier for structured logging in serverless environments. */
const instanceId = process.env.VERCEL_INVOCATION_ID
  || process.env.AWS_LAMBDA_FUNCTION_NAME
  || `local-${process.pid}-${Date.now().toString(36)}`;

function logStructured(level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    instanceId,
    connectionState: getConnectionState(),
    ...details,
  };
  // Never log credentials or connection strings
  if (entry.databaseUrl) delete entry.databaseUrl;
  if (entry.password) delete entry.password;
  if (entry.secret) delete entry.secret;
  const output = JSON.stringify(entry);
  if (level === 'warn' || level === 'error') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

/* Bounded exponential backoff with jitter.
   baseMs: initial delay
   maxMs: maximum delay
   attempt: 0-based attempt number
   Returns delay in milliseconds. */
function backoffWithJitter(baseMs, maxMs, attempt) {
  const expDelay = Math.min(baseMs * 2 ** attempt, maxMs);
  const jitter = Math.random() * expDelay * 0.3; // up to 30% jitter
  return Math.floor(expDelay + jitter);
}

/* Internal connection attempt with backoff.
   Returns a promise that resolves when connected (ping succeeds) or rejects
   with a descriptive error. Does NOT cache rejection — callers must retry. */
async function attemptConnection(attempt) {
  if (!env.databaseConfigured) {
    throw new Error('DATABASE_URL not configured');
  }

  // Sanitize host for logging (no credentials)
  let sanitizedHost = 'unknown';
  try {
    const url = new URL(env.databaseUrl);
    sanitizedHost = url.hostname;
  } catch (_) { /* ignore */ }

  const connectionOptions = {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 5,
    minPoolSize: 0,
    maxIdleTimeMS: 30000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  };

  const start = Date.now();

  logStructured('info', 'db_connection_attempt_start', {
    attempt,
    host: sanitizedHost,
  });

  await mongoose.connect(env.databaseUrl, connectionOptions);
  await mongoose.connection.db.admin().ping();

  const duration = Date.now() - start;
  logStructured('info', 'db_connected', {
    attempt,
    database: mongoose.connection.name,
    durationMs: duration,
    readyState: mongoose.connection.readyState,
    host: sanitizedHost,
  });

  return true;
}

async function connectDB() {
  if (!env.databaseConfigured) {
    logStructured('info', 'db_not_configured', {
      message: 'DATABASE_URL not set - staying on the static catalogue (no database)',
    });
    return false;
  }

  // If already connected and healthy, return immediately
  if (isReady()) {
    logStructured('info', 'db_already_connected', { readyState: mongoose.connection.readyState });
    return true;
  }

  // If a connection attempt is already in progress, return it
  if (connectionPromise) {
    logStructured('info', 'db_connection_in_progress', { attempt: connectionAttempt });
    return connectionPromise;
  }

  // Start new connection attempt with retry logic
  connectionAttempt += 1;
  const currentAttempt = connectionAttempt;

  // Create the connection promise with retry logic
  connectionPromise = (async () => {
    const maxAttempts = 3;
    const baseDelayMs = 1000;
    const maxDelayMs = 10000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (isShuttingDown) {
        logStructured('warn', 'db_shutdown_during_connect');
        return false;
      }

      if (attempt > 1) {
        const delay = backoffWithJitter(baseDelayMs, 5000, attempt - 1);
        logStructured('info', 'db_retry_delay', { attempt, delayMs: delay });
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        await attemptConnection(currentAttempt);
        logStructured('info', 'db_connected', { attempt: currentAttempt });
        return true;
      } catch (err) {
        const isLastAttempt = attempt === maxAttempts;

        logStructured('warn', 'db_connection_attempt_failed', {
          attempt,
          maxAttempts,
          errorName: err.name,
          errorCode: err.code,
          errorMessage: err.message?.split('?')[0],
          willRetry: !isLastAttempt,
        });

        if (isLastAttempt) {
          // Log nested causes
          let cause = err.cause;
          while (cause) {
            logStructured('warn', 'db_nested_cause', {
              causeName: cause.name,
              causeMessage: cause.message?.split('?')[0],
            });
            cause = cause.cause;
          }

          if (err.reason) {
            logStructured('warn', 'db_topology_reason', {
              topologyDescription: err.reason.topologyDescription,
              servers: Array.isArray(err.reason.servers) ? err.reason.servers.map((srv, i) => ({
                index: i,
                address: srv.address,
                type: srv.type,
                error: srv.error?.name ? `${srv.error.name}:${srv.error.message?.split('?')[0]}` : null,
              })) : [],
            });
          }

          // Clear promise so next call retries
          connectionPromise = null;
          return false;
        }

        // Brief delay before retry
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // Should not reach here
    return false;
  })();

  try {
    return await connectionPromise;
  } catch (err) {
    // Promise rejected - already cleared in catch block above
    throw err;
  }
}

/* Returns true only when mongoose reports readyState === 1 (connected). */
function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

/* Returns a promise that resolves when connected, or rejects with a clear error.
   Callers MUST await this before executing database operations. */
async function ensureConnected() {
  if (isReady()) return true;
  if (!connectionPromise) {
    connectionPromise = connectDB();
  }
  try {
    return await connectionPromise;
  } catch (err) {
    // Connection failed - promise already cleared
    throw new Error(`Database unavailable: ${err.message}`);
  }
}

/* Returns a promise that resolves when the current connection attempt settles.
   Does not throw on failure - returns false instead. Used by callers that
   need to gracefully degrade (e.g., apiPlan fallback). */
async function dbReady() {
  if (isReady()) return true;
  if (!connectionPromise) {
    connectionPromise = connectDB();
  }
  try {
    return await connectionPromise;
  } catch {
    return false;
  }
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    logStructured('info', 'db_disconnecting', { readyState: mongoose.connection.readyState });
    await mongoose.disconnect();
  }
  connectionPromise = null;
  connectionAttempt = 0;
  logStructured('info', 'db_disconnected', {});
}

/* Graceful shutdown flag for serverless */
function setShuttingDown() {
  isShuttingDown = true;
}

/* Returns a human-readable connection status string. */
function getDbStatus() {
  const state = mongoose.connection.readyState;
  switch (state) {
    case 0: return 'disconnected';
    case 1: return 'connected';
    case 2: return 'connecting';
    case 3: return 'disconnecting';
    default: return 'unknown';
  }
}

/* Attach mongoose connection event listeners for observability.
   These update no flags — state is always derived from readyState. */
function setupConnectionEventListeners() {
  const conn = mongoose.connection;

  conn.on('connected', () => {
    logStructured('info', 'mongoose_connected', { readyState: conn.readyState });
  });

  conn.on('disconnected', () => {
    logStructured('warn', 'mongoose_disconnected', { readyState: conn.readyState });
  });

  conn.on('error', (err) => {
    logStructured('error', 'mongoose_error', {
      errorName: err.name,
      errorMessage: err.message?.split('?')[0],
      readyState: mongoose.connection.readyState,
    });
  });

  conn.on('reconnected', () => {
    logStructured('info', 'mongoose_reconnected', { readyState: mongoose.connection.readyState });
  });

  conn.on('close', () => {
    logStructured('info', 'mongoose_close', { readyState: mongoose.connection.readyState });
  });
}

// Initialize event listeners
setupConnectionEventListeners();

// Configure mongoose
mongoose.set('bufferCommands', false);
mongoose.set('strictQuery', true);

export {
  connectDB,
  ensureConnected,
  dbReady,
  isConnected,
  isDbConnected,
  disconnectDB,
  getDbStatus,
  setShuttingDown,
};