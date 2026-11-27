/* -------------------------------------------------------------------------
   Test storage adapter for image upload tests
   -------------------------------------------------------------------------
   A simple in-memory storage adapter for testing without external dependencies.
   ------------------------------------------------------------------------- */

import { randomBytes } from 'crypto';
import sharp from 'sharp';
import { ApiError } from '../src/utils/ApiError.js';
import { Readable } from 'stream';

const MAGIC = [
  { bytes: [0xff, 0xd8, 0xff], ext: 'jpg', mime: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], ext: 'png', mime: 'image/png' },
  { bytes: [0x52, 0x49, 0x46, 0x46], ext: 'webp', mime: 'image/webp' },
];

function detectImage(buffer) {
  if (buffer.length >= 12) {
    const avifSig = buffer.subarray(4, 12).toString('ascii');
    if (avifSig === 'ftypavif') {
      return { ext: 'avif', mime: 'image/avif' };
    }
  }
  for (const sig of MAGIC) {
    if (sig.bytes.every((b, i) => buffer[i] === b)) {
      if (sig.ext === 'webp' && buffer.toString('ascii', 8, 12) !== 'WEBP') continue;
      return sig;
    }
  }
  return null;
}

function generateBaseName() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 5);
  return `${timestamp}-${random}`;
}

const testStorage = new Map();

const testStorageAdapter = {
  name: 'test-storage',

  async upload({ buffer, filename }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('No image data received.');
    }
    if (buffer.length > 12 * 1024 * 1024) {
      throw new Error('Image exceeds 12MB limit.');
    }

    const sig = detectImage(buffer);
    if (!sig) throw new Error('Unrecognised image format. JPEG, PNG, WebP and AVIF are supported.');

    let meta;
    try {
      meta = await sharp(buffer).metadata();
    } catch {
      throw new Error('File could not be read as an image.');
    }
    if (!meta.width || !meta.height) throw new Error('Image has no readable dimensions.');

    const base = filename || generateBaseName();
    const ext = sig.ext === 'jpg' ? 'jpeg' : sig.ext;
    const originalName = `${base}-original.${sig.ext}`;
    const largeName = `${base}-large.webp`;
    const thumbName = `${base}-thumb.webp`;

    const prefix = 'test-library/';
    const originalKey = prefix + originalName;
    const largeKey = prefix + largeName;
    const thumbKey = prefix + thumbName;

    const large = await sharp(buffer)
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const thumb = await sharp(buffer)
      .rotate()
      .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();

    const originalContentType = `image/${sig.ext === 'jpg' ? 'jpeg' : sig.ext}`;
    
    testStorage.set(originalKey, { buffer, contentType: originalContentType, key: originalKey });
    testStorage.set(largeKey, { buffer: large, contentType: 'image/webp', key: largeKey });
    testStorage.set(thumbKey, { buffer: thumb, contentType: 'image/webp', key: thumbKey });

    const publicBase = '/assets/img';
    return {
      original: `${publicBase}/${originalKey}`,
      large: `${publicBase}/${largeKey}`,
      thumb: `${publicBase}/${thumbKey}`,
      width: meta.width,
      height: meta.height,
      size: buffer.length,
    };
  },

  async list({ assignedPaths = new Set() } = {}) {
    const prefix = 'test-library/';
    const objects = [];
    for (const [key, value] of testStorage.entries()) {
      if (key.startsWith('test-library/')) {
        const publicPath = `/assets/img/${key}`;
        const assigned = assignedPaths.has(publicPath);
        objects.push({
          path: publicPath,
          bytes: value.buffer.length,
          assigned,
        });
      }
    }

    const grouped = new Map();
    for (const file of objects) {
      const m = file.path.match(/^(.*)-(large|thumb|original)\.[a-z]+$/i);
      const key = m ? m[1] : file.path;
      if (!grouped.has(key)) grouped.set(key, { base: key, files: [], assigned: false });
      const g = grouped.get(key);
      g.files.push(file.path);
      if (file.assigned) g.assigned = true;
    }

    return [...grouped.values()];
  },

  resolve(publicPath) {
    if (!publicPath.startsWith('/assets/img/')) return null;
    const key = publicPath.replace('/assets/img/', '');
    if (testStorage.has(key)) {
      return key;
    }
    return null;
  },

  exists(publicPath) {
    const key = this.resolve(publicPath);
    return key !== null;
  },

  async delete(publicPath) {
    const key = this.resolve(publicPath);
    if (!key) return 0;

    const m = publicPath.match(/^(.*)-(large|thumb|original)\.[a-z]+$/i);
    let siblings;
    if (!m) {
      siblings = [publicPath];
    } else {
      const base = m[1];
      siblings = ['-large.webp', '-thumb.webp'].map((s) => `${base}${s}`);
    }

    let deleted = 0;
    for (const sibling of siblings) {
      const siblingKey = this.resolve(sibling);
      if (siblingKey && testStorage.has(siblingKey)) {
        testStorage.delete(siblingKey);
        deleted++;
      }
    }
    return deleted;
  },

  stat(publicPath) {
    const key = this.resolve(publicPath);
    if (!key) return null;
    const entry = testStorage.get(key);
    if (!entry) return null;
    return { size: entry.buffer.length, mtime: new Date() };
  },

  getReadStream(publicPath) {
    const key = this.resolve(publicPath);
    if (!key) return null;
    const entry = testStorage.get(key);
    if (!entry) return null;
    
    // Create a readable stream from the buffer
    const readable = new Readable();
    readable._read = () => {};
    readable.push(entry.buffer);
    readable.push(null);
    return readable;
  },

  clear() {
    testStorage.clear();
  },
};

export { testStorageAdapter };