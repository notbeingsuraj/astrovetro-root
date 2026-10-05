/* -------------------------------------------------------------------------
   User
   -------------------------------------------------------------------------

   One account per email address, lowercased on the way in so "A@x.com" and
   "a@x.com" cannot become two accounts.

   The password hash is never selected by default (`select: false`), which means
   a stray `User.findOne(...)` cannot accidentally serialise it into an API
   response. Code that genuinely needs it must ask for it explicitly.

   `role` is what separates a customer from an administrator. It is set here and
   nowhere else that a browser can reach — never from a request body — so a
   customer cannot promote themselves by posting `role: "admin"`.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    role: { type: String, enum: ['customer', 'admin'], default: 'customer' },

    /* Set when the customer changes their email. Changing an address is a
       security-relevant action, so the account is held until the new address is
       confirmed rather than being switched silently. */
    pendingEmail: { type: String, lowercase: true, trim: true, default: '' },
    emailVerified: { type: Boolean, default: false },

    lastLoginAt: { type: Date, default: null },

    /* Incremented on sign-out. A JWT cannot be revoked on its own, so the
       token carries the version it was issued under and a mismatch invalidates
       it. This is what makes signing out actually revoke a copied cookie
       instead of merely deleting the local one. */
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/* Hashing lives on the model so no route can forget it. `pre('save')` only
   fires when the hash actually changed, so updating a name does not
   needlessly re-hash and invalidate nothing else. */
/* Declared with no argument and called with `next()`. Mongoose inspects
   fn.length to choose between the callback and promise styles: a zero-arity
   function is treated as a promise hook, and a `next` parameter would be
   `undefined` inside it. Declared `async function ()` and invoked explicitly. */
userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('passwordHash')) return;
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
});

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  /* Compares against the stored hash, tolerating a missing one so a legacy or
     partially-migrated row fails as "wrong password" instead of throwing. */
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(plain, this.passwordHash);
};

/* A real bcrypt hash of a value nobody can supply. Verifying against it when no
   account matched makes the "unknown email" path do the same work as the
   "wrong password" path, so response timing cannot be used to discover which
   addresses are registered. */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO1s2BLnGOWPPHRcxCEjfVBsG2kQRPzO';

userSchema.statics.verifyAgainstNothing = function verifyAgainstNothing(plain) {
  return bcrypt.compare(plain, DUMMY_HASH);
};

/* The shape the browser receives. Explicit allow-list: a field that is not
   named here can never leak, so adding a column to the schema later cannot
   accidentally expose it. */
userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    phone: this.phone || '',
    role: this.role,
    emailVerified: this.emailVerified,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
export default User;
