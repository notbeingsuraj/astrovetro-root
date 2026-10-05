/* -------------------------------------------------------------------------
   asyncHandler
   -------------------------------------------------------------------------

   Express 4 does not catch a rejected promise from a route handler, so an
   async handler that throws produces a request that hangs until it times out
   instead of reaching the error middleware.

   Wrapping the handler makes every `throw` and every rejected await land in the
   error handler, which is what lets controllers be written as plain
   try/catch-free code that still produces correct status codes.
   ------------------------------------------------------------------------- */

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
