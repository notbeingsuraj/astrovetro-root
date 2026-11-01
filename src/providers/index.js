/* -------------------------------------------------------------------------
   Provider selection
   -------------------------------------------------------------------------

   Decides where catalogue reads come from, so no caller ever asks.

   Static  - the default, and the reason the site deploys with no database.
   Mongo   - used automatically once DATABASE_URL is configured.

   API_TARGET (a separate, fully-featured backend) still wins when set: it
   overrides this server entirely in server.js and this module is never
   consulted. Keeping the two mechanisms distinct means adding a real backend
   later does not disturb the database-free path.
   ------------------------------------------------------------------------- */

import staticProvider from './staticProvider.js';
import dbProvider from './dbProvider.js';
import { ProviderNotConfiguredError } from './mongoProvider.js';

export { ProviderNotConfiguredError };

let cached = null;

export function getDataProvider() {
  if (cached) return cached;

  const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.MONGODB_URI);

  if (hasDatabase) {
    cached = dbProvider;
  } else {
    cached = staticProvider;
  }

  console.log(`[data] provider: ${cached.name}`);
  return cached;
}

export default { getDataProvider };