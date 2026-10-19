/* -------------------------------------------------------------------------
   StockReceipt — goods physically received against a purchase order
   -------------------------------------------------------------------------

   A separate collection rather than an embedded array, for two reasons:

     1. `idempotencyKey` carries a unique index, so a double-submitted receipt
        is rejected at the database level — the second attempt can never
        increment stock a second time.
     2. Receipts are the auditable event; keeping them out of the PO document
        means recording one never rewrites another.

   Stock increases only when a receipt is successfully created; the same
   service call performs the guarded balance update and the ledger write.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

const receiptLineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true, maxlength: 160 },
    sku: { type: String, required: true, maxlength: 80 },
    quantityReceived: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const stockReceiptSchema = new mongoose.Schema(
  {
    receiptNumber: { type: String, required: true, unique: true, index: true },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true, index: true },
    poNumber: { type: String, required: true, maxlength: 40 },
    /* Supplied by the client; unique index makes the receipt idempotent. */
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    lines: { type: [receiptLineSchema], required: true, validate: [(v) => v.length > 0, 'A receipt needs at least one line.'] },
    receivedAt: { type: Date, default: Date.now },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    receivedByEmail: { type: String, default: '', maxlength: 160 },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    /* Reference numbers of the stock movements this receipt created. */
    movementIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StockMovement' }],
  },
  { timestamps: true }
);

export const StockReceipt = mongoose.model('StockReceipt', stockReceiptSchema);
export default StockReceipt;
