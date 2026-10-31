/* -------------------------------------------------------------------------
   Storage provider abstraction
   -------------------------------------------------------------------------

   A thin interface so the image controller does not depend on the local
   filesystem directly. This allows swapping to S3-compatible, Cloudflare R2,
   Supabase Storage, or any other backend without rewriting the controller.

   The local adapter keeps the existing behaviour (public/assets/img/) so
   development and single-server production deployments work unchanged.

   No provider is mandatory — the local adapter is the default and requires
   no external credentials.
   ------------------------------------------------------------------------- */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { randomBytes } from 'crypto';

const PUBLIC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const IMG_ROOT = path.join(PUBLIC_ROOT, 'assets', 'img');
const LIBRARY_DIR = path.join(IMG_ROOT, 'library');

/* Magic numbers we accept. The content-type header alone proves nothing —
   it is whatever the client claims. */
const MAGIC = [
  { bytes: [0xff, 0xd8, 0xff], ext: 'jpg', mime: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], ext: 'png', mime: 'image/png' },
  { bytes: [0x52, 0x49, 0x46, 0x46], ext: 'webp', mime: 'image/webp' },
];

function detectImage(buffer) {
  for (const sig of MAGIC) {
    if (sig.bytes.every((b, i) => buffer[i] === b)) {
      if (sig.ext === 'webp' && buffer.toString('ascii', 8, 12) !== 'WEBP') continue;
      return sig;
    }
  }
  return null;
}

/* Ensure a directory exists. */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/* Generate a unique base name for a new upload. */
function generateBaseName() {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(3).toString('hex');
  return `${timestamp}-${random}`;
}

/* ──────────────────────────────────────────────────────────────────────────
   Local storage adapter — the default, zero-configuration implementation.
   ------------------------------------------------------------------------ */
const localAdapter = {
  name: 'local',

  /* Upload raw image bytes, generate derivatives, return public paths. */
  async upload({ buffer, filename }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('No image data received.');
    }
    if (buffer.length > 12 * 1024 * 1024) {
      throw new Error('Image exceeds 12MB limit.');
    }

    const sig = detectImage(buffer);
    if (!sig) throw new Error('Unrecognised image format. JPEG, PNG and WebP are supported.');

    let meta;
    try {
      meta = await sharp(buffer).metadata();
    } catch {
      throw new Error('File could not be read as an image.');
    }
    if (!meta.width || !meta.height) throw new Error('Image has no readable dimensions.');

    ensureDir(LIBRARY_DIR);

    const base = filename || generateBaseName();
    const originalName = `${base}-original.${sig.ext}`;
    const largeName = `${base}-large.webp`;
    const thumbName = `${base}-thumb.webp`;

    const originalPath = path.join(LIBRARY_DIR, originalName);
    const largePath = path.join(LIBRARY_DIR, largeName);
    const thumbPath = path.join(LIBRARY_DIR, thumbName);

    fs.writeFileSync(originalPath, buffer);

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

    fs.writeFileSync(largePath, large);
    fs.writeFileSync(thumbPath, thumb);

    return {
      original: `/assets/img/library/${originalName}`,
      large: `/assets/img/library/${largeName}`,
      thumb: `/assets/img/library/${thumbName}`,
      width: meta.width,
      height: meta.height,
      size: buffer.length,
    };
  },

  /* List all images under assets/img, grouped by photograph (base name). */
  async list({ assignedPaths = new Set() } = {}) {
    const scan = (dir, prefix) => {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f))
        .map((f) => {
          const publicPath = `/assets/img/${prefix}/${f}`;
          const stat = fs.statSync(path.join(dir, f));
          return {
            path: publicPath,
            bytes: stat.size,
            assigned: assignedPaths.has(publicPath),
          };
        });
    };

    const library = scan(LIBRARY_DIR, 'library');

    /* Group derivatives by base name so the UI shows one entry per photo. */
    const grouped = new Map();
    for (const file of library) {
      const m = file.path.match(/^(.*)-(large|thumb|original)\.[a-z]+$/i);
      const key = m ? m[1] : file.path;
      if (!grouped.has(key)) grouped.set(key, { base: key, files: [], assigned: false });
      const g = grouped.get(key);
      g.files.push(file.path);
      if (file.assigned) g.assigned = true;
    }

    return [...grouped.values()];
  },

  /* Resolve a public path to an absolute file path, ensuring it stays in IMG_ROOT. */
  resolve(publicPath) {
    if (typeof publicPath !== 'string' || !publicPath.startsWith('/assets/img/')) return null;
    const abs = path.resolve(PUBLIC_ROOT, `.${publicPath}`);
    if (!abs.startsWith(IMG_ROOT + path.sep)) return null;
    return abs;
  },

  /* Check if a file exists. */
  exists(publicPath) {
    const abs = this.resolve(publicPath);
    return abs ? fs.existsSync(abs) : false;
  },

  /* Delete a file and its derivative siblings. Returns count of deleted files. */
  async delete(publicPath) {
    const abs = this.resolve(publicPath);
    if (!abs || !fs.existsSync(abs)) return 0;

    const m = publicPath.match(/^(.*)-(large|thumb|original)\.[a-z]+$/i);
    let siblings;
    if (!m) {
      siblings = [publicPath];
    } else {
      const base = m[1];
      siblings = ['-large.webp', '-thumb.webp'].map((s) => `${base}${s}`);
      if (base.startsWith('/assets/img/library/')) {
        const baseName = path.basename(base);
        const original = fs.existsSync(LIBRARY_DIR)
          ? fs.readdirSync(LIBRARY_DIR).find((f) => f.startsWith(`${baseName}-original.`))
          : null;
        if (original) siblings.push(`/assets/img/library/${original}`);
      }
    }

    let deleted = 0;
    for (const sibling of siblings) {
      const siblingAbs = this.resolve(sibling);
      if (siblingAbs && fs.existsSync(siblingAbs)) {
        fs.unlinkSync(siblingAbs);
        deleted++;
      }
    }
    return deleted;
  },

  /* Get file stats (size, etc.) for a public path. */
  stat(publicPath) {
    const abs = this.resolve(publicPath);
    if (!abs || !fs.existsSync(abs)) return null;
    const stat = fs.statSync(abs);
    return { size: stat.size, mtime: stat.mtime };
  },
};

/* ──────────────────────────────────────────────────────────────────────────
   S3-compatible storage adapter (Cloudflare R2, AWS S3, MinIO, etc.)
   ------------------------------------------------------------------------ */
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function getS3Client() {
  const endpoint = process.env.S3_ENDPOINT; // optional for R2/MinIO
  const region = process.env.S3_REGION || 'auto';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const bucket = process.env.S3_BUCKET;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('S3 adapter requires S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
  }
  const client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: !!endpoint, // needed for R2/MinIO
  });
  return { client, bucket };
}

/* Helper to derive S3 key from public path like /assets/img/library/xxx-large.webp */
function publicPathToKey(publicPath) {
  if (!publicPath.startsWith('/assets/img/')) return null;
  return publicPath.replace('/assets/img/', '');
}

/* Upload helper: put buffer to S3 with content-type. */
async function s3Put({ client, bucket, key, buffer, contentType }) {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
}

/* ──────────────────────────────────────────────────────────────────────────
   S3-compatible storage adapter
   ------------------------------------------------------------------------ */
const s3Adapter = {
  name: 's3',

  async upload({ buffer, filename }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('No image data received.');
    }
    if (buffer.length > 12 * 1024 * 1024) {
      throw new Error('Image exceeds 12MB limit.');
    }

    const sig = detectImage(buffer);
    if (!sig) throw new Error('Unrecognised image format. JPEG, PNG and WebP are supported.');

    let meta;
    try {
      meta = await sharp(buffer).metadata();
    } catch {
      throw new Error('File could not be read as an image.');
    }
    if (!meta.width || !meta.height) throw new Error('Image has no readable dimensions.');

    const { client, bucket } = getS3Client();
    const base = filename || generateBaseName();
    const originalName = `${base}-original.${sig.ext}`;
    const largeName = `${base}-large.webp`;
    const thumbName = `${base}-thumb.webp`;

    const prefix = 'library/';
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

    await Promise.all([
      s3Put({ client, bucket, key: originalKey, buffer, contentType: `image/${sig.ext === 'jpg' ? 'jpeg' : sig.ext}` }),
      s3Put({ client, bucket, key: largeKey, buffer: large, contentType: 'image/webp' }),
      s3Put({ client, bucket, key: thumbKey, buffer: thumb, contentType: 'image/webp' }),
    ]);

    const publicBase = process.env.STORAGE_PUBLIC_URL || `/assets/img`;
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
    const { client, bucket } = getS3Client();
    const prefix = 'library/';
    const resp = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    const objects = resp.Contents || [];

    const grouped = new Map();
    for (const obj of objects) {
      const key = obj.Key; // e.g., library/abc-large.webp
      const publicPath = `/assets/img/${key}`;
      const assigned = assignedPaths.has(publicPath);
      const m = key.match(/^library\/(.*)-(large|thumb|original)\.[a-z]+$/i);
      const baseKey = m ? `library/${m[1]}` : key;
      if (!grouped.has(baseKey)) grouped.set(baseKey, { base: `/assets/img/${baseKey}`, files: [], assigned: false });
      const g = grouped.get(baseKey);
      g.files.push(publicPath);
      if (assigned) g.assigned = true;
    }
    return [...grouped.values()];
  },

  resolve(publicPath) {
    const key = publicPathToKey(publicPath);
    return key ? { bucket: process.env.S3_BUCKET, key } : null;
  },

  async exists(publicPath) {
    const { client, bucket } = getS3Client();
    const key = publicPathToKey(publicPath);
    if (!key) return false;
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (e) {
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false;
      throw e;
    }
  },

  async delete(publicPath) {
    const { client, bucket } = getS3Client();
    const key = publicPathToKey(publicPath);
    if (!key) return 0;

    const m = key.match(/^library\/(.*)-(large|thumb|original)\.[a-z]+$/i);
    let siblings;
    if (!m) {
      siblings = [key];
    } else {
      const base = `library/${m[1]}`;
      siblings = ['-large.webp', '-thumb.webp'].map((s) => `${base}${s}`);
      // original may have various extensions; try to find by listing prefix
      const listResp = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: base + '-original.' }));
      if (listResp.Contents?.length) {
        siblings.push(listResp.Contents[0].Key);
      }
    }

    let deleted = 0;
    for (const sibling of siblings) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: sibling }));
        deleted++;
      } catch (e) {
        if (e.name !== 'NotFound' && e.$metadata?.httpStatusCode !== 404) throw e;
      }
    }
    return deleted;
  },

  async stat(publicPath) {
    const { client, bucket } = getS3Client();
    const key = publicPathToKey(publicPath);
    if (!key) return null;
    try {
      const resp = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { size: resp.ContentLength, mtime: resp.LastModified };
    } catch (e) {
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  },
};

/* ──────────────────────────────────────────────────────────────────────────
   Provider registry and selection.
   ------------------------------------------------------------------------ */
const adapters = {
  local: localAdapter,
  s3: s3Adapter,
  // Future adapters can be added here:
  // r2: r2Adapter,
  // supabase: supabaseAdapter,
};

let activeAdapter = localAdapter;

export function setStorageAdapter(name) {
  const adapter = adapters[name];
  if (!adapter) throw new Error(`Unknown storage adapter: ${name}`);
  activeAdapter = adapter;
  console.log(`[storage] adapter set to: ${name}`);
}

export function getStorageAdapter() {
  return activeAdapter;
}

export function getAvailableAdapters() {
  return Object.keys(adapters);
}

/* Re-export the local adapter for direct use if needed. */
export { localAdapter };