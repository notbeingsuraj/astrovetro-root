/* -------------------------------------------------------------------------
   Media path validation
   -------------------------------------------------------------------------

   One implementation of "is this a local image path the server is allowed to
   publish?" shared by product, ritual, blog and site-content controllers.

   The rule is deliberately narrow: a path must start with /assets/img/ and,
   once resolved, must still be inside public/assets/img. That blocks absolute
   filesystem paths, traversal (../../etc/passwd), external URLs and protocol
   handlers. Existence is checked separately so a field can be left empty.

   Nothing here trusts the caller. A path is data supplied over HTTP, even when
   the admin UI only ever offers files from the library.
   ------------------------------------------------------------------------- */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ApiError } from './ApiError.js';

const PUBLIC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const IMG_ROOT = path.join(PUBLIC_ROOT, 'assets', 'img');

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Resolve a public image path to an absolute path inside public/assets/img, or null. */
export function safeResolveImage(publicPath) {
  if (typeof publicPath !== 'string' || !publicPath.startsWith('/assets/img/')) return null;
  /* Decoded traversal (%2e%2e) reaches Express already decoded, but a literal
     backslash or null byte is still worth refusing outright. */
  if (publicPath.includes('\\') || publicPath.includes('\0')) return null;
  const abs = path.resolve(PUBLIC_ROOT, `.${publicPath}`);
  if (!abs.startsWith(IMG_ROOT + path.sep)) return null;
  return abs;
}

/** True when the path is local, inside the image root, and the file exists. */
export function imageExists(publicPath) {
  const abs = safeResolveImage(publicPath);
  return Boolean(abs && fs.existsSync(abs) && fs.statSync(abs).isFile());
}

/**
 * Validate an optional single image path.
 * Empty / null / undefined are valid and return ''. A non-empty path must be a
 * local /assets/img file that actually exists.
 */
export function assertOptionalImage(value, field = 'image') {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw ApiError.badRequest(`${field} must be an image path.`);
  if (!imageExists(value)) {
    throw ApiError.badRequest(`${field} must be a file from the media library.`);
  }
  return value;
}

/** Validate a list of image paths; duplicates are removed and order is kept. */
export function assertImageList(values = [], field = 'images', max = 24) {
  if (!Array.isArray(values)) throw ApiError.badRequest(`${field} must be a list.`);
  if (values.length > max) throw ApiError.badRequest(`At most ${max} images are allowed.`);
  const out = [];
  for (const value of values) {
    if (typeof value !== 'string' || !imageExists(value)) {
      throw ApiError.badRequest(`${field} contains a file that is not in the media library.`);
    }
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

export { PUBLIC_ROOT, IMG_ROOT };
