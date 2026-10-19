/* -------------------------------------------------------------------------
   PurchaseOrder
   -------------------------------------------------------------------------

   Ordering stock does NOT change stock. A line item's quantity only reaches
   the inventory when a receipt is recorded against the order (see
   src/services/inventoryService.js recordReceipt), which is what keeps
   "ordered" and "on the shelf" from ever being the same number.

   receivedQuantity on each line is the running total of accepted receipts, so
   partial deliveries are simply receipts whose quantities cover part of the
   line. The receipt documents themselves live in the StockReceipt collection.

   Unit costs recorded here are the supplier's prices. They inform — but are
   never copied over — a product's recorded cost price, because a cost on one
   order is not the cost of the product forever.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

export const PO_STATUS = ['draft', 'sent', 'partial', 'received', 'cancelled'];

const lineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    /* Snapshots so a renamed or archived product does not rewrite the PO. */
    name: { type: String, required: true, maxlength: 160 },
    sku: { type: String, required: true, maxlength: 80 },
    orderedQuantity: { type: Number, required: true, min: 1 },
    receivedQuantity: { type: Number, default: 0, min: 0 },
    unitCost: { type: Number, required: true, min: 0 },
  },
  { _id: true }
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: { type: String, required: true, unique: true, index: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    status: { type: String, enum: PO_STATUS, default: 'draft', index: true },
    lines: { type: [lineSchema], default: [] },
    expectedDate: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sentAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

purchaseOrderSchema.index({ createdAt: -1 });

export const PurchaseOrder = mongoose.model('PurchaseOrder', purchaseOrderSchema);
export default PurchaseOrder;
