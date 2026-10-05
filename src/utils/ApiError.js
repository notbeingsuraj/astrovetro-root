/* -------------------------------------------------------------------------
   ApiError
   -------------------------------------------------------------------------

   An error that is safe to show a customer.

   The distinction this type exists to enforce: an error thrown in a controller
   is either an *expected* outcome the customer should be told about plainly
   ("that piece is out of stock", "that order is not yours"), or a genuine fault
   that must not be described in detail. Carrying `status` and `code` on the
   error means the handler never has to guess, and a route that forgets to
   check something produces a 500 rather than leaking a stack trace.

   `details` carries per-field validation messages so a form can highlight the
   offending input. It must only ever contain information the customer already
   supplied.
   ------------------------------------------------------------------------- */

export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (details) this.details = details;
    /* Marks this as a deliberate, reportable outcome rather than a crash, so
       the error handler logs it at warn level and not as a fault. */
    this.expected = true;
  }

  static badRequest(message = 'That request could not be understood.', details) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static validation(details, message = 'Please check the highlighted fields.') {
    return new ApiError(422, 'VALIDATION_FAILED', message, details);
  }

  static unauthorized(message = 'Please sign in to continue.') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'You do not have access to that.') {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'We could not find that.') {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message = 'That could not be completed.') {
    return new ApiError(409, 'CONFLICT', message);
  }

  static outOfStock(message = 'One of the pieces in your bag is no longer available in that quantity.') {
    return new ApiError(409, 'OUT_OF_STOCK', message);
  }
}

export default ApiError;
