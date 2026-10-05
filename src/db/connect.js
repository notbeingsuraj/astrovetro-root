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

  try {
    await mongoose.connect(env.databaseUrl, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
    });
    await mongoose.connection.db.admin().ping();
    connected = true;
    console.log(`[db] connected to MongoDB (${mongoose.connection.name})`);
    return true;
  } catch (err) {
    connected = false;
    /* The message names the cause but never the credentials, which routinely
       contain a password in the connection string. */
    console.warn(`[db] connection failed (${err.name}): ${err.message.split('?')[0]}`);
    console.warn('[db] falling back to the static catalogue; writes stay disabled');
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
