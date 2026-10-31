/* -------------------------------------------------------------------------
   Site content defaults
   -------------------------------------------------------------------------

   The copy the storefront already ships with. Keeping it here means a fresh
   database renders the same homepage as the static build, and the admin form
   starts from real values rather than blank fields an editor has to invent.

   These are defaults only: once the SiteContent document exists, the database
   is the source of truth. Re-seeding must never overwrite an editor's copy.
   ------------------------------------------------------------------------- */

export const HOMEPAGE_DEFAULTS = {
  heroEyebrow: 'Our approach',
  heroTitle: 'Come back to\nyourself.',
  heroIntro:
    'Objects with intention. Rituals with meaning. We make and gather a small number of things: crystals, jewellery and tarot, chosen for how they sit in a room and how they feel in the hand.',
  productsEyebrow: 'The collection',
  productsTitle: 'What we have in stock.',
  ritualsEyebrow: 'Rituals',
  ritualsTitle: 'A moment to look inward.',
  ritualsBody:
    'Readings — tarot among them — for the questions, decisions and reflections occupying your mind. Conducted online, at a time that suits you.',
  ritualsCtaLabel: 'Enter rituals',
  ritualsCtaHref: '/rituals',
  journalEyebrow: 'The journal',
  journalTitle: 'Notes from the studio.',
  announcement: '',
  announcementActive: false,
  seoTitle: 'Astro Vetro — Crystals, Tarot & Ritual Objects',
  seoDescription:
    'Crystals, tarot and ritual objects for slow mornings and small rituals. Crystals and jewellery chosen for how they sit in a room and feel in the hand.',
};

export const CONTACT_DEFAULTS = {
  email: 'hello@astrovetro.com',
  phone: '',
  address: '',
  hours: 'Monday–Friday, 10am–5pm IST',
};

export default { HOMEPAGE_DEFAULTS, CONTACT_DEFAULTS };
