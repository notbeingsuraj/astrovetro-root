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

let connected = false;

/* Mongoose buffers queries for 10s by default when disconnected, which turns a
   missing database into a slow hang instead of an immediate, honest error.
   Both of these make the failure fast and explicit. */
mongoose.set('bufferCommands', false);
mongoose.set('strictQuery', true);

/* Single shared connection promise — all callers (apiPlan, /health, etc.)
   await the same connection attempt. */
let connectionPromise = null;
let connectionAttempt = 0;

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

async function connectDB() {
  if (!env.databaseConfigured) {
    logStructured('info', 'db_not_configured', { message: 'DATABASE_URL not set - staying on the static catalogue (no database)' });
    return false;
  }

  // If already connected and the connection is healthy, return early
  if (connected && mongoose.connection.readyState === 1) {
    logStructured('info', 'db_already_connected', { readyState: mongoose.connection.readyState });
    return true;
  }

  // If a connection attempt is already in progress, return it
  if (connectionPromise) {
    logStructured('info', 'db_connection_in_progress', { attempt: connectionAttempt });
    return connectionPromise;
  }

  // Increment attempt counter for this new connection attempt
  connectionAttempt += 1;
  const currentAttempt = connectionAttempt;

  logStructured('info', 'db_connection_attempt_start', { attempt: currentAttempt });

  const start = Date.now();

  // Sanitize host for logging (no credentials)
  let sanitizedHost = 'unknown';
  try {
    const url = new URL(env.databaseUrl);
    sanitizedHost = url.hostname;
  } catch (_) { /* ignore */ }

  // Build connection options using only supported options for MongoDB driver 6.x / Mongoose 9.x
  const connectionOptions = {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 5,           // Reduced from 10 to be more conservative on serverless
    minPoolSize: 0,           // Don't maintain idle connections in serverless
    maxIdleTimeMS: 30000,     // Close idle connections after 30s
    connectTimeoutMS: 10000,  // Connection timeout
    socketTimeoutMS: 45000,   // Socket timeout for operations
    // retryWrites and w are part of the connection string, not options
  };

  // Create the connection promise
  connectionPromise = (async () => {
    try {
      logStructured('info', 'db_connecting', { attempt: currentAttempt, host: sanitizedHost });

      await mongoose.connect(env.databaseUrl, connectionOptions);
      await mongoose.connection.db.admin().ping();

      connected = true;
      const duration = Date.now() - start;

      logStructured('info', 'db_connected', {
        attempt: currentAttempt,
        database: mongoose.connection.name,
        durationMs: duration,
        readyState: mongoose.connection.readyState,
        host: sanitizedHost,
      });

      return true;
    } catch (err) {
      connected = false;
      const duration = Date.now() - start;

      // Clear the cached promise so a subsequent call can retry
      connectionPromise = null;

      logStructured('warn', 'db_connection_failed', {
        attempt: currentAttempt,
        durationMs: duration,
        errorName: err.name,
        errorCode: err.code,
        errorMessage: err.message?.split('?')[0],
        readyState: mongoose.connection.readyState,
        host: sanitizedHost,
      });

      // Log nested causes
      let cause = err.cause;
      while (cause) {
        logStructured('warn', 'db_nested_cause', {
          causeName: cause.name,
          causeMessage: cause.message?.split('?')[0],
        });
        cause = cause.cause;
      }

      // Log topology description if available
      if (err.reason) {
        logStructured('warn', 'db_topology_reason', {
          topologyDescription: err.reason.topologyDescription,
          servers: err.reason.servers?.map((srv, i) => ({
            index: i,
            address: srv.address,
            type: srv.type,
            error: srv.error?.name ? `${srv.error.name}:${srv.error.message?.split('?')[0]}` : null,
          })),
        });
      }

      logStructured('warn', 'db_fallback_static', {
        message: 'Falling back to the static catalogue; writes stay disabled',
      });

      return false;
    }
  })();

  return connectionPromise;
}

function isConnected() {
  return connected && mongoose.connection.readyState === 1;
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    logStructured('info', 'db_disconnecting', { readyState: mongoose.connection.readyState });
    await mongoose.disconnect();
  }
  connected = false;
  connectionPromise = null;
  connectionAttempt = 0;
  logStructured('info', 'db_disconnected', {});
}

/* Returns the single shared connection promise. Callers (apiPlan, /health, etc.)
   must await this instead of calling connectDB() directly. */
function dbReady() {
  if (!connectionPromise) {
    connectionPromise = connectDB();
  }
  return connectionPromise;
}

/* Check actual connection state rather than relying on cached promise. */
function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

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
   These fire on state changes regardless of how the connection was established. */
function setupConnectionEventListeners() {
  const conn = mongoose.connection;

  conn.on('connected', () => {
    logStructured('info', 'mongoose_connected', { readyState: conn.readyState });
    connected = true;
  });

  conn.on('disconnected', () => {
    logStructured('warn', 'mongoose_disconnected', { readyState: conn.readyState });
    connected = false;
  });

  conn.on('error', (err) => {
    logStructured('error', 'mongoose_error', {
      errorName: err.name,
      errorMessage: err.message?.split('?')[0],
      readyState: conn.readyState,
    });
  });

  // 'reconnected' is emitted when the driver reconnects after a disconnection
  conn.on('reconnected', () => {
    logStructured('info', 'mongoose_reconnected', { readyState: conn.readyState });
    connected = true;
  });

  // 'close' is emitted when the connection is closed
  conn.on('close', () => {
    logStructured('info', 'mongoose_close', { readyState: conn.readyState });
    connected = false;
  });
}

// Initialize event listeners
setupConnectionEventListeners();

export { connectDB, isConnected, disconnectDB, dbReady, isDbConnected, getDbStatus };