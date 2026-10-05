/* -------------------------------------------------------------------------
   Address
   -------------------------------------------------------------------------

   A saved delivery address belonging to exactly one user.

   Two invariants matter and are enforced by the index rather than by trusting
   the route handler:

     1. `user` is required, so an address can never be orphaned.
     2. Only one address per user may be the default. The partial unique index
        below means a second default is rejected by the database itself, so two
        concurrent requests cannot both set one and leave the customer with an
        ambiguous "deliver here".

   An order does NOT read from this collection when it is finalised — it takes a
   snapshot. Editing an address later must not rewrite where a past parcel went.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label: { type: String, trim: true, maxlength: 40, default: 'Home' },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    line1: { type: String, required: true, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200, default: '' },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, trim: true, maxlength: 100, default: '' },
    pincode: {
      type: String,
      required: true,
      trim: true,
      /* Indian PIN codes are six digits. Validated here so an undeliverable
         address is rejected at entry rather than by the courier. */
      match: /^[0-9]{6}$/,
    },
    country: { type: String, trim: true, maxlength: 100, default: 'India' },

    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/* At most one default per user. Sparse + partial so only documents that are
   actually flagged default take part in the uniqueness check. */
addressSchema.index(
  { user: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

addressSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    label: this.label,
    name: this.name,
    phone: this.phone,
    line1: this.line1,
    line2: this.line2,
    city: this.city,
    state: this.state,
    pincode: this.pincode,
    country: this.country,
    isDefault: this.isDefault,
  };
};

export const Address = mongoose.model('Address', addressSchema);
export default Address;
