/* -------------------------------------------------------------------------
   Error handler
   -------------------------------------------------------------------------

   The single place an error becomes an HTTP response.

   Its most important job is deciding what the customer is allowed to see. A
   Zod validation message, an ApiError message and a mongoose validation message
   are all written for us and safe to pass on. A driver error, a bug or a failed
   assertion is not: those are logged in full on the server and answered with a
   flat "something went wrong", because a raw stack trace in a JSON body tells
   an attacker the framework, the driver version and the file layout.

   Mongoose and Zod errors are translated here rather than in each controller,
   so no handler can forget.
   ------------------------------------------------------------------------- */

import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { ProviderNotConfiguredError } from '../providers/index.js';

/* Mongoose duplicate-key: the unique index did its job. Callers that expect a
   duplicate to be harmless (wishlist "add", idempotent checkout) catch this
   specifically rather than treating it as a generic failure. */
export const DUPLICATE_KEY = 11000;

export function notFoundHandler(req, res) {
  return res.status(404).json({
    success: false,
    message: 'That endpoint does not exist.',
    error: {
      code: 'NOT_FOUND',
      message: `"${req.method} ${req.originalUrl.split('?')[0]}" is not an Astro Vetro endpoint.`,
    },
  });
}

export function errorHandler(err, _req, res, _next) {
  /* ── deliberate, customer-facing ── */
  if (err instanceof ApiError) {
    if (!err.expected) console.warn('[api]', err.code, err.message);
    return res.status(err.status).json({
      success: false,
      message: err.message,
      error: err.details
        ? { code: err.code, message: err.message, details: err.details }
        : { code: err.code, message: err.message },
    });
  }

  /* ── validation ── */
  if (err instanceof ZodError) {
    const details = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      if (!details[key]) details[key] = issue.message;
    }
    return res.status(422).json({
      success: false,
      message: 'Please check the highlighted fields.',
      error: { code: 'VALIDATION_FAILED', message: 'Please check the highlighted fields.', details },
    });
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const details = {};
    for (const [field, issue] of Object.entries(err.errors)) {
      details[field] = issue.message;
    }
    return res.status(422).json({
      success: false,
      message: 'Please check the highlighted fields.',
      error: { code: 'VALIDATION_FAILED', message: 'Please check the highlighted fields.', details },
    });
  }

  /* A malformed ObjectId is a client mistake, not a missing document. Without
     this it surfaces as a CastError and a 500, which would tell the customer to
     retry something that will never work. */
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({
      success: false,
      message: 'That identifier is not valid.',
      error: { code: 'INVALID_ID', message: `"${err.path}" is not a valid identifier.` },
    });
  }

  if (err?.code === DUPLICATE_KEY) {
    return res.status(409).json({
      success: false,
      message: 'That already exists.',
      error: { code: 'DUPLICATE', message: 'A record with those details already exists.' },
    });
  }

  /* ── the database-free deployment mode ── */
  if (err instanceof ProviderNotConfiguredError || err?.code === 'DATABASE_NOT_CONFIGURED') {
    return res.status(503).json({
      success: false,
      message: err.message,
      error: { code: 'DATABASE_NOT_CONFIGURED', message: err.message },
    });
  }

  /* Body parser failures: malformed JSON, oversized payload. */
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      message: 'That request could not be read.',
      error: { code: 'BAD_JSON', message: 'That request could not be read.' },
    });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'That request was too large.',
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'That request was too large.' },
    });
  }

  /* ── everything else is ours, and stays here ── */
  console.error('[api] unhandled error:', err);
  return res.status(500).json({
    success: false,
    message: 'Something went wrong. Please try again.',
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
  });
}
