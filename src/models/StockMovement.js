/* -------------------------------------------------------------------------
   StockMovement — the inventory ledger
   -------------------------------------------------------------------------

   Every change to a product's quantity on hand is recorded here with the
   balance before and after, who did it, why, and when. The product's `stock`
   field is the current truth; this collection is how the current truth was
   reached, and it is never edited after creation.

   Fields are marked immutable so a later code path cannot quietly rewrite
   history — corrections happen by making a NEW compensating movement, the way
   a ledger works.

   `quantity` is signed: receiving +10, a write-off -3. `balanceAfter` always
   equals `balanceBefore + quantity` and both are >= 0; the service that writes
   movements is the only thing allowed to create them.

   No transactions are used because the deployment runs a standalone MongoDB
   (no replica set), where multi-document transactions are unavailable. The
   service therefore applies the balance change atomically with a single
   guarded $inc (one document, one atomic operation) and compensates if the
   ledger insert itself fails — see src/services/inventoryService.js.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

export const MOVEMENT_TYPES = [
  'opening',    // first balance recorded for a product
  'receive',    // goods received (purchase order receipt)
  'sale',       // decremented by a paid order
  'adjustment', // manual correction
  'write_off',  // damaged / lost stock
  'return',     // customer or supplier return restocked
];

const stockMovementSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
      immutable: true,
    },
    /* Snapshots, because history must survive renames, SKU changes and even
       archival of the product it refers to. */
    sku: { type: String, required: true, immutable: true },
    productName: { type: String, required: true, immutable: true },

    type: { type: String, enum: MOVEMENT_TYPES, required: true, immutable: true },
    quantity: { type: Number, required: true, immutable: true, validate: [(v) => v !== 0, 'A movement cannot be zero.'] },
    balanceBefore: { type: Number, required: true, min: 0, immutable: true },
    balanceAfter: { type: Number, required: true, min: 0, immutable: true },

    reason: { type: String, default: '', maxlength: 300, immutable: true },
    /* Order number, purchase order number or receipt number when there is one. */
    reference: { type: String, default: '', maxlength: 120, immutable: true },

    /* The administrator responsible. Email is snapshotted so the record stays
       attributable if the account is later removed. */
    actor: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', immutable: true },
      email: { type: String, required: true, immutable: true },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

/* The immutable flag stops document saves; this stops direct update queries
   from being used against the ledger at all. */
stockMovementSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany'], function () {
  throw new Error('Stock movements are immutable history and cannot be modified.');
});

stockMovementSchema.index({ product: 1, createdAt: -1 });
stockMovementSchema.index({ createdAt: -1 });
stockMovementSchema.index({ type: 1, createdAt: -1 });

export const StockMovement = mongoose.model('StockMovement', stockMovementSchema);
export default StockMovement;
