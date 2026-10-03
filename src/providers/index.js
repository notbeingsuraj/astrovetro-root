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
import mongoProvider, { ProviderNotConfiguredError } from './mongoProvider.js';

export { ProviderNotConfiguredError };

let cached = null;

export function getDataProvider() {
  if (cached) return cached;

  const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.MONGODB_URI);

  if (hasDatabase) {
    /* Set, but not wired up yet. Serve the static catalogue rather than
       pretending the connection succeeded, and let the logs tell the truth
       about which provider is actually answering. */
    console.warn(
      '[data] DATABASE_URL is set but the Mongo provider is not implemented yet; ' +
        'serving the static catalogue. See src/providers/mongoProvider.js.'
    );
    cached = staticProvider;
  } else {
    cached = staticProvider;
  }

  console.log(`[data] provider: ${cached.name}`);
  return cached;
}

export default { getDataProvider };