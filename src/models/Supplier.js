/* -------------------------------------------------------------------------
   Supplier
   -------------------------------------------------------------------------

   Who stock is bought from. Kept deliberately small: contact details, an
   optional reference code, the products this supplier has historically
   provided, and active/archived status. Archiving never deletes the record —
   purchase orders keep referencing it.

   No suppliers are seeded. Inventing vendors would fabricate trading history;
   they are created by the administrator as real relationships begin.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, trim: true, uppercase: true, maxlength: 40, sparse: true, unique: true },
    email: { type: String, trim: true, lowercase: true, maxlength: 160, default: '' },
    phone: { type: String, trim: true, maxlength: 40, default: '' },
    address: { type: String, trim: true, maxlength: 400, default: '' },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
  },
  { timestamps: true }
);

supplierSchema.index({ name: 1 });

export const Supplier = mongoose.model('Supplier', supplierSchema);
export default Supplier;
