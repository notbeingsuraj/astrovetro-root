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

export async function connectDB() {
  if (!env.databaseConfigured) {
    console.log('[db] DATABASE_URL not set - staying on the static catalogue (no database)');
    return false;
  }

  if (connected) return true;

  console.time('[db] connection attempt');
  const start = Date.now();
  try {
    // Log sanitized host for diagnostics (no credentials)
    let sanitizedHost = 'unknown';
    try {
      const url = new URL(env.databaseUrl);
      sanitizedHost = url.hostname;
    } catch (_) { /* ignore */ }
    console.log(`[db] attempting connection to ${sanitizedHost}`);

    await mongoose.connect(env.databaseUrl, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
    });
    await mongoose.connection.db.admin().ping();
    connected = true;
    const duration = Date.now() - start;
    console.log(`[db] connected to MongoDB (${mongoose.connection.name}) in ${duration}ms, readyState=${mongoose.connection.readyState}`);
    console.timeEnd('[db] connection attempt');
    return true;
  } catch (err) {
    connected = false;
    const duration = Date.now() - start;
    console.warn(`[db] connection failed after ${duration}ms (${err.name}): ${err.message.split('?')[0]}`);
    if (err.code) console.warn(`[db] error code: ${err.code}`);
    if (err.reason) {
      console.warn('[db] reason:', err.reason);
      if (err.reason.topologyDescription) {
        console.warn('[db] topologyDescription:', JSON.stringify(err.reason.topologyDescription));
      }
      if (err.reason.servers) {
        err.reason.servers.forEach((srv, i) => {
          console.warn(`[db] server[${i}] ${srv.address} type=${srv.type} error=${srv.error?.name}:${srv.error?.message?.split('?')[0]}`);
        });
      }
    }
    // Nested causes
    let cause = err.cause;
    while (cause) {
      console.warn('[db] nested cause:', cause.name, cause.message?.split('?')[0]);
      cause = cause.cause;
    }
    // Mongoose readyState
    console.warn(`[db] mongoose readyState after failure: ${mongoose.connection.readyState}`);
    console.warn('[db] falling back to the static catalogue; writes stay disabled');
    console.timeEnd('[db] connection attempt');
    return false;
  }
}

export function isConnected() {
  return connected && mongoose.connection.readyState === 1;
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  connected = false;
}

export default { connectDB, isConnected, disconnectDB };
