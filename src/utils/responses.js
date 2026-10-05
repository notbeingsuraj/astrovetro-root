/* -------------------------------------------------------------------------
   Response helpers
   -------------------------------------------------------------------------

   The API envelope is fixed and matches what src/api/staticApi.js already
   returns, so the browser client reads every response the same way whether it
   was answered by the static catalogue or by the database:

       success: { success: true,  data, meta }
       failure: { success: false, message, error: { code, message, details? } }

   Nothing else in the project is allowed to hand-roll a different shape, which
   is why every controller response goes through one of these three functions.
   ------------------------------------------------------------------------- */

export const ok = (res, data, meta = {}) => res.json({ success: true, data, meta });

export const created = (res, data, meta = {}) => res.status(201).json({ success: true, data, meta });

export const fail = (res, status, code, message, details) =>
  res.status(status).json({
    success: false,
    message,
    error: details ? { code, message, details } : { code, message },
  });

/* Pagination metadata in one place, so list endpoints cannot disagree about
   the field names the client reads. */
export const pageMeta = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  pages: Math.max(1, Math.ceil(total / limit)),
  hasMore: page * limit < total,
});
