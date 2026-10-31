/* -------------------------------------------------------------------------
   SiteContent
   -------------------------------------------------------------------------

   Editable copy for fixed storefront placements, stored as named keys rather
   than as a free-form document. Every field is a known string with a length
   limit; none is HTML and none is a code path.

   Why structured fields instead of one JSON blob: a blob lets an editor save a
   key the pages do not read, or a type the pages cannot render, and the failure
   only appears on the live site. Here the schema is the contract.

   `key` is unique so a placement cannot silently fork into two documents.
   Links are validated at the controller boundary (internal path or https URL);
   image fields are validated as local media-library paths.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';
import { HOMEPAGE_DEFAULTS, CONTACT_DEFAULTS } from '../data/siteContent.js';

const homepageSchema = new mongoose.Schema(
  {
    heroEyebrow: { type: String, default: '', maxlength: 80 },
    heroTitle: { type: String, default: '', maxlength: 160 },
    heroIntro: { type: String, default: '', maxlength: 1200 },
    productsEyebrow: { type: String, default: '', maxlength: 80 },
    productsTitle: { type: String, default: '', maxlength: 160 },
    ritualsEyebrow: { type: String, default: '', maxlength: 80 },
    ritualsTitle: { type: String, default: '', maxlength: 160 },
    ritualsBody: { type: String, default: '', maxlength: 1200 },
    ritualsCtaLabel: { type: String, default: '', maxlength: 60 },
    ritualsCtaHref: { type: String, default: '', maxlength: 300 },
    journalEyebrow: { type: String, default: '', maxlength: 80 },
    journalTitle: { type: String, default: '', maxlength: 160 },
    announcement: { type: String, default: '', maxlength: 200 },
    announcementActive: { type: Boolean, default: false },
    seoTitle: { type: String, default: '', maxlength: 70 },
    seoDescription: { type: String, default: '', maxlength: 170 },
  },
  { _id: false }
);

const contactSchema = new mongoose.Schema(
  {
    email: { type: String, default: '', maxlength: 160 },
    phone: { type: String, default: '', maxlength: 40 },
    address: { type: String, default: '', maxlength: 300 },
    hours: { type: String, default: '', maxlength: 160 },
  },
  { _id: false }
);

const siteContentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    homepage: { type: homepageSchema, default: () => ({ ...HOMEPAGE_DEFAULTS }) },
    contact: { type: contactSchema, default: () => ({ ...CONTACT_DEFAULTS }) },
  },
  { timestamps: true }
);

siteContentSchema.methods.toPublic = function toPublic() {
  return {
    key: this.key,
    homepage: this.homepage.toObject ? this.homepage.toObject() : this.homepage,
    contact: this.contact?.toObject ? this.contact.toObject() : this.contact,
    updatedAt: this.updatedAt,
  };
};

siteContentSchema.methods.toAdmin = function toAdmin() {
  return this.toPublic();
};

export const SiteContent = mongoose.model('SiteContent', siteContentSchema);
export default SiteContent;
