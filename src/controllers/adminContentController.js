/* -------------------------------------------------------------------------
   Admin site-content controller
   -------------------------------------------------------------------------

   Named placements (currently `homepage`) edited through a fixed schema. Every
   value is plain text; links are restricted to internal paths or https URLs.
   The public read is served by the provider, so the storefront never depends on
   an admin endpoint.

   Saving creates the document on first use, seeded from the defaults in
   src/data/siteContent.js. There is exactly one document per key.
   ------------------------------------------------------------------------- */

import { z } from 'zod';
import { SiteContent } from '../models/SiteContent.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../services/auditService.js';
import { plainText, optionalLink, pickSubmitted } from '../utils/content.js';
import { HOMEPAGE_DEFAULTS, CONTACT_DEFAULTS } from '../data/siteContent.js';

const KEYS = new Set(['homepage']);

const homepageSchema = z.object({
  heroEyebrow: plainText(80).default(''),
  heroTitle: plainText(160).default(''),
  heroIntro: plainText(1200).default(''),
  productsEyebrow: plainText(80).default(''),
  productsTitle: plainText(160).default(''),
  ritualsEyebrow: plainText(80).default(''),
  ritualsTitle: plainText(160).default(''),
  ritualsBody: plainText(1200).default(''),
  ritualsCtaLabel: plainText(60).default(''),
  ritualsCtaHref: optionalLink.default(''),
  journalEyebrow: plainText(80).default(''),
  journalTitle: plainText(160).default(''),
  announcement: plainText(200).default(''),
  announcementActive: z.boolean().default(false),
  seoTitle: plainText(70).default(''),
  seoDescription: plainText(170).default(''),
});

const contactSchema = z.object({
  email: z.union([z.literal(''), z.string().trim().email().max(160)]).default(''),
  phone: plainText(40).default(''),
  address: plainText(300).default(''),
  hours: plainText(160).default(''),
});

const bodySchema = z.object({
  homepage: homepageSchema.optional(),
  contact: contactSchema.optional(),
});

function assertKey(key) {
  if (!KEYS.has(key)) throw ApiError.notFound('There is no editable content at that key.');
  return key;
}

async function ensure(key) {
  let doc = await SiteContent.findOne({ key });
  if (!doc) {
    doc = await SiteContent.create({
      key,
      homepage: { ...HOMEPAGE_DEFAULTS },
      contact: { ...CONTACT_DEFAULTS },
    });
  }
  return doc;
}

export const listContent = asyncHandler(async (_req, res) => {
  const keys = [...KEYS];
  const docs = await SiteContent.find({ key: { $in: keys } });
  const byKey = new Map(docs.map((d) => [d.key, d]));
  return res.json({
    success: true,
    data: {
      items: keys.map((key) =>
        byKey.get(key)?.toPublic() ?? { key, homepage: HOMEPAGE_DEFAULTS, contact: CONTACT_DEFAULTS }
      ),
    },
  });
});

export const getContent = asyncHandler(async (req, res) => {
  const key = assertKey(req.params.key);
  const doc = await ensure(key);
  return res.json({ success: true, data: { content: doc.toAdmin() } });
});

export const updateContent = asyncHandler(async (req, res) => {
  const key = assertKey(req.params.key);
  const body = bodySchema.parse(req.body);
  const doc = await ensure(key);

  if (body.homepage && req.body.homepage) {
    for (const [field, value] of Object.entries(pickSubmitted(body.homepage, req.body.homepage))) {
      doc.homepage[field] = value;
    }
  }
  if (body.contact && req.body.contact) {
    for (const [field, value] of Object.entries(pickSubmitted(body.contact, req.body.contact))) {
      doc.contact[field] = value;
    }
  }
  await doc.save();

  await recordAudit({
    actor: req.user,
    action: 'content.update',
    entity: { type: 'content', id: key, label: key },
    summary: `Updated ${key} content`,
  });
  return res.json({ success: true, data: { content: doc.toAdmin() } });
});
