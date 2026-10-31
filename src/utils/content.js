/* -------------------------------------------------------------------------
   Content validation helpers
   -------------------------------------------------------------------------

   Shared rules for the editorial modules (rituals, journal, site content).

   The central decision is that these fields are PLAIN TEXT. `plainText()`
   refuses angle brackets outright, so a stored value can never contain a tag
   for a public page to render — even if a future page accidentally uses
   innerHTML. The admin UI explains this in its form hints.

   `safeLink()` accepts only an internal absolute path or an https URL. That
   keeps editable CTA links from becoming javascript: URLs or protocol-relative
   redirects.
   ------------------------------------------------------------------------- */

import { z } from 'zod';

const FORBIDDEN_MARKUP = /[<>]/;

/** Trimmed plain text with an explicit length limit. */
export const plainText = (max, { required = false } = {}) => {
  let schema = z.string().trim().max(max);
  if (required) schema = schema.min(1);
  return schema.refine((v) => !FORBIDDEN_MARKUP.test(v), {
    message: 'Use plain text only — angle brackets and HTML are not allowed.',
  });
};

export const optionalLink = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === '' || /^\/(?!\/)/.test(v) || /^https:\/\/[^\s]+$/i.test(v), {
    message: 'Links must be an internal path (/shop) or an https URL.',
  });

export const slugify = (s) =>
  String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Trim strings, drop blanks and duplicates while preserving order. */
export const cleanList = (items = []) => {
  const out = [];
  for (const item of items) {
    const value = String(item ?? '').trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
};

/** True when a string looks like an ObjectId, without throwing on bad input. */
export const isObjectId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ''));

/* PATCH safety.
   A create schema gives every optional field a default, which is what makes
   creation forgiving. Parsing a PATCH with `.partial()` of that same schema
   still injects those defaults, so `{ status: 'active' }` would quietly blank
   the SEO copy, ritual materials, article body — every field the caller did not
   mention. `pickSubmitted` keeps only the keys that were actually present in
   the request, so an update changes exactly what it says it changes. */
export const pickSubmitted = (parsed, raw) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, value] of Object.entries(parsed || {})) {
    if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = value;
  }
  return out;
};

/* Ritual copy is wellbeing content, not medicine. These patterns refuse the
   claims that turn a practice into a promise: a cure, a treatment, a diagnosis,
   or a guaranteed outcome. The list is deliberately narrow — it targets claims,
   not words like "calm" or "grounding", so ordinary ritual language still
   passes. Checked at the controller boundary, before anything is stored. */
const PROHIBITED_CLAIMS = [
  /\b(cures?|heals?|healing)\b/i,
  /\b(treats?|treating)\b/i,
  /\bdiagnos\w*\b/i,
  /\bprescrib\w*\b/i,
  /\bguarantee(d|s)?\b/i,
  /\bclinically (proven|tested)\b/i,
  /\bmedical(ly)? (treat\w*|condition|advice|diagnosis)\b/i,
  /\bprevents? (cancer|disease|illness|infection)\b/i,
  /\breplaces? (medical|treatment|medication|therapy)\b/i,
  /\bFDA[-\s]approved\b/i,
];

/** Returns the first prohibited medical/outcome claim in a string, or null. */
export const findProhibitedClaim = (text) => {
  const value = String(text || '');
  for (const pattern of PROHIBITED_CLAIMS) {
    const match = value.match(pattern);
    if (match) return match[0];
  }
  return null;
};

export const statusEnum = z.enum(['draft', 'active', 'archived']);
