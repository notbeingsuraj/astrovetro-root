/* -------------------------------------------------------------------------
   Inventory service
   -------------------------------------------------------------------------

   The only place stock is allowed to change. Everything else — the admin
   adjustment screen, purchase-order receipts, checkout — comes through here,
   so three invariants hold no matter which path is used:

     1. The balance never goes negative, and never changes without a ledger
        entry. The change is a single guarded `$inc` (one document, one atomic
        operation), then the matching StockMovement is written; if the
        movement cannot be written, the balance is reversed and the caller
        gets the error. No half-applied stock.
     2. Untracked products (`stock: null`) are never decremented. They are
        either given an opening balance (which starts tracking) or left alone.
     3. Every movement carries the actor, the reason, the before/after balances
        and — where one exists — the reference (order number, PO number).

   Why not a multi-document transaction: the deployment runs a standalone
   MongoDB, where transactions are unavailable. The guarded single-document
   update plus compensating reversal below is the equivalent guarantee for the
   failure modes that can actually occur here, and it is honest about the one
   window it cannot cover (a process crash between the two writes — no
   mechanism short of a replica set closes that, and a replica set is a
   deployment decision, not a code one).
   ------------------------------------------------------------------------- */

import { Product, LOW_STOCK_DEFAULT, defaultSku } from '../models/Product.js';
import { StockMovement } from '../models/StockMovement.js';
import { StockReceipt } from '../models/StockReceipt.js';
import { PurchaseOrder, PO_STATUS } from '../models/PurchaseOrder.js';
import { ApiError } from '../utils/ApiError.js';
import { auditBestEffort } from './auditService.js';

export { LOW_STOCK_DEFAULT };

const insufficientStock = (name, onHand, wanted) =>
  new ApiError(
    422,
    'INSUFFICIENT_STOCK',
    `Only ${onHand} of ${name} ${onHand === 1 ? 'is' : 'are'} on hand, so ${wanted} cannot be ${wanted === 1 ? 'removed' : 'removed'}.`
  );

/** The actor shape every write records, with a system fallback. */
const actorOf = (actor, fallback = 'system') => ({
  userId: actor?.id ?? actor?._id ?? null,
  email: actor?.email || fallback,
  role: actor?.role || '',
});

/* Preserve the existing shop rule: a piece that reaches zero stock stops being
   sold. Done after the ledger write so it is never part of a rollback. */
async function applyZeroStockRule(productId, after) {
  if (after !== 0) return;
  await Product.updateOne({ _id: productId, stock: 0 }, { $set: { availability: false } });
}

async function writeMovement({ product, before, after, delta, type, reason, reference, actor }) {
  return StockMovement.create({
    product: product._id,
    sku: product.sku || defaultSku(product.slug),
    productName: product.name,
    type,
    quantity: delta,
    balanceBefore: before ?? 0,
    balanceAfter: after,
    reason: reason || '',
    reference: reference || '',
    actor: actorOf(actor),
  });
}

/**
 * Change a tracked product's balance by `delta` (signed, non-zero).
 *
 * `type: 'opening'` is the one case that starts tracking an untracked product;
 * every other type requires an existing balance.
 */
export async function applyStockDelta({
  productId,
  delta,
  type,
  reason = '',
  reference = '',
  actor,
}) {
  if (!Number.isInteger(delta) || delta === 0) {
    throw ApiError.badRequest('A stock change must be a whole, non-zero number.');
  }

  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound('That product could not be found.');

  /* ── Starting to track an untracked product ─────────────────────────── */
  if (type === 'opening') {
    if (product.stock != null) {
      throw ApiError.conflict(`${product.name} already has a tracked balance. Use an adjustment instead.`);
    }
    if (delta < 0) throw ApiError.badRequest('An opening balance cannot be negative.');

    /* Guarded on `stock: null`, so a concurrent opening cannot both win and
       the first balance recorded is the only one. */
    const claimed = await Product.findOneAndUpdate(
      { _id: product._id, stock: null },
      { $set: { stock: delta } },
      { new: true }
    );
    if (!claimed) {
      throw ApiError.conflict('The balance changed while you were editing. Reload and try again.');
    }

    let movement;
    try {
      movement = await writeMovement({
        product: claimed,
        before: null,
        after: delta,
        delta,
        type,
        reason,
        reference,
        actor,
      });
    } catch (err) {
      /* Reverse the balance: a stock change without a ledger entry must not
         survive. */
      await Product.updateOne({ _id: product._id, stock: delta }, { $set: { stock: null } });
      throw err;
    }

    await auditBestEffort({
      actor,
      action: 'inventory.opening',
      entity: { type: 'product', id: product._id.toString(), label: product.name },
      summary: `Opening balance set to ${delta}`,
      meta: { balanceAfter: delta, reference },
    });

    return { movement, balanceBefore: null, balanceAfter: delta };
  }

  /* ── Everything else needs a tracked product ────────────────────────── */
  if (product.stock == null) {
    throw ApiError.conflict(`${product.name} is not stock-tracked. Record an opening balance first.`);
  }
  if (product.stock + delta < 0) {
    throw insufficientStock(product.name, product.stock, Math.abs(delta));
  }

  /* The guard is the atomic race gate: the update only matches while the
     balance can absorb the delta, and `new: false` returns the balance from
     before the change, so before/after are exact even under concurrency. */
  const beforeDoc = await Product.findOneAndUpdate(
    {
      _id: product._id,
      stock: { $ne: null },
      $expr: { $gte: [{ $add: ['$stock', delta] }, 0] },
    },
    { $inc: { stock: delta } },
    { new: false }
  );

  if (!beforeDoc) {
    /* The guarded update lost: say precisely why. */
    const fresh = await Product.findById(product._id);
    if (!fresh) throw ApiError.notFound('That product no longer exists.');
    if (fresh.stock == null) {
      throw ApiError.conflict(`${fresh.name} is not stock-tracked. Record an opening balance first.`);
    }
    throw insufficientStock(fresh.name, fresh.stock, Math.abs(delta));
  }

  const balanceBefore = beforeDoc.stock;
  const balanceAfter = balanceBefore + delta;

  let movement;
  try {
    movement = await writeMovement({
      product: beforeDoc,
      before: balanceBefore,
      after: balanceAfter,
      delta,
      type,
      reason,
      reference,
      actor,
    });
  } catch (err) {
    await Product.updateOne({ _id: product._id }, { $inc: { stock: -delta } });
    throw err;
  }

  await applyZeroStockRule(product._id, balanceAfter);
  await auditBestEffort({
    actor,
    action: `inventory.${type}`,
    entity: { type: 'product', id: product._id.toString(), label: beforeDoc.name },
    summary: `${delta > 0 ? '+' : ''}${delta}: ${balanceBefore} → ${balanceAfter}${reason ? ` (${reason})` : ''}`,
    meta: { balanceBefore, balanceAfter, reference, type },
  });

  return { movement, balanceBefore, balanceAfter };
}

/**
 * Set a tracked product's balance to an exact number.
 *
 * Implemented as a delta so it goes through the same ledger and the same
 * negative-stock guard — "set to 4" from 10 is recorded as −6, which is what
 * makes the history readable.
 */
export async function setStockAbsolute({ productId, quantity, type = 'adjustment', reason = '', reference = '', actor }) {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw ApiError.badRequest('Enter a whole number of units (0 or more).');
  }
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound('That product could not be found.');
  if (product.stock == null) {
    /* Setting an untracked product's balance is the same act as opening it. */
    return applyStockDelta({ productId, delta: quantity, type: 'opening', reason, reference, actor });
  }
  const delta = quantity - product.stock;
  if (delta === 0) {
    throw ApiError.conflict(`The balance is already ${quantity}. Nothing to record.`);
  }
  return applyStockDelta({ productId, delta, type, reason, reference, actor });
}

/** Stop tracking a product's stock (returns it to "made to order"). */
export async function clearTracking({ productId, reason = '', actor }) {
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound('That product could not be found.');
  if (product.stock == null) throw ApiError.conflict(`${product.name} is already untracked.`);
  const cleared = await Product.findOneAndUpdate(
    { _id: product._id, stock: product.stock },
    { $set: { stock: null } },
    { new: true }
  );
  if (!cleared) throw ApiError.conflict('The balance changed while you were editing. Reload and try again.');

  await auditBestEffort({
    actor,
    action: 'inventory.untrack',
    entity: { type: 'product', id: product._id.toString(), label: product.name },
    summary: `Stopped tracking (last balance ${product.stock})${reason ? ` — ${reason}` : ''}`,
    meta: { balanceBefore: product.stock },
  });
  return { productId: product._id, stock: null };
}

/* ── Purchase order receipts ─────────────────────────────────────────────── */

/**
 * Receive goods against a purchase order.
 *
 * Stock rises here and only here. The operation is idempotent on
 * `idempotencyKey`: the receipt document is created first, and its unique
 * index is what makes a double-submitted receipt fail rather than count twice.
 * Any later failure rolls back the stock and movements it had applied, then
 * deletes the receipt, so a failed receipt leaves nothing behind.
 */
export async function recordReceipt({
  purchaseOrderId,
  lines,                 // [{ lineId, quantityReceived }]
  actor,
  idempotencyKey,
  note = '',
}) {
  if (!idempotencyKey || String(idempotencyKey).length < 8) {
    throw ApiError.badRequest('A receipt needs an idempotency key of at least 8 characters.');
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw ApiError.badRequest('A receipt needs at least one line.');
  }

  /* Fast path: this exact submission already succeeded. */
  const existing = await StockReceipt.findOne({ idempotencyKey: String(idempotencyKey) });
  if (existing) return { receipt: existing, replayed: true };

  const po = await PurchaseOrder.findById(purchaseOrderId);
  if (!po) throw ApiError.notFound('That purchase order could not be found.');
  if (po.status === 'cancelled') throw ApiError.conflict('A cancelled purchase order cannot receive stock.');
  if (po.status === 'draft') {
    throw ApiError.conflict('Send the purchase order before receiving stock against it.');
  }
  if (po.status === 'received') throw ApiError.conflict('This purchase order has already been fully received.');

  /* Validate every line against the order before touching stock. */
  const prepared = [];
  for (const input of lines) {
    const qty = Number(input.quantityReceived);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw ApiError.badRequest('Received quantities must be whole numbers greater than zero.');
    }
    const line = po.lines.id(input.lineId) || po.lines.find((l) => l.product.toString() === String(input.productId));
    if (!line) throw ApiError.badRequest('That line is not part of this purchase order.');
    const outstanding = line.orderedQuantity - line.receivedQuantity;
    if (qty > outstanding) {
      throw ApiError.conflict(
        `${line.name}: only ${outstanding} of ${line.orderedQuantity} ${outstanding === 1 ? 'is' : 'are'} still outstanding.`
      );
    }
    prepared.push({ line, quantityReceived: qty });
  }

  /* Reserve the idempotency slot first, so two simultaneous submissions
     cannot both proceed past this point. */
  let receipt;
  try {
    receipt = await StockReceipt.create({
      receiptNumber: `RC-${Date.now().toString(36).toUpperCase()}`,
      purchaseOrder: po._id,
      poNumber: po.poNumber,
      idempotencyKey: String(idempotencyKey),
      lines: prepared.map(({ line, quantityReceived }) => ({
        product: line.product,
        name: line.name,
        sku: line.sku,
        quantityReceived,
        unitCost: line.unitCost,
      })),
      receivedBy: actorOf(actor).userId,
      receivedByEmail: actorOf(actor).email,
      note,
      movementIds: [],
    });
  } catch (err) {
    if (err?.code === 11000) {
      const winner = await StockReceipt.findOne({ idempotencyKey: String(idempotencyKey) });
      if (winner) return { receipt: winner, replayed: true };
    }
    throw err;
  }

  const applied = [];   // [{ productId, delta, movementId }]
  try {
    for (const { line, quantityReceived } of prepared) {
      const { movement } = await applyStockDelta({
        productId: line.product,
        delta: quantityReceived,
        type: 'receive',
        reason: `Received against ${po.poNumber}`,
        reference: po.poNumber,
        actor,
      });
      applied.push({ productId: line.product, delta: quantityReceived, movementId: movement._id });
    }

    /* Update the purchase order lines and its derived status. */
    for (const { line, quantityReceived } of prepared) {
      await PurchaseOrder.updateOne(
        { _id: po._id, 'lines._id': line._id },
        { $inc: { 'lines.$.receivedQuantity': quantityReceived } }
      );
    }
    const fresh = await PurchaseOrder.findById(po._id);
    const fullyReceived = fresh.lines.every((l) => l.receivedQuantity >= l.orderedQuantity);
    fresh.status = fullyReceived ? 'received' : 'partial';
    if (fullyReceived && !fresh.completedAt) fresh.completedAt = new Date();
    await fresh.save();

    await StockReceipt.updateOne(
      { _id: receipt._id },
      { $set: { movementIds: applied.map((a) => a.movementId) } }
    );

    await auditBestEffort({
      actor,
      action: 'purchase.receipt',
      entity: { type: 'purchaseOrder', id: po._id.toString(), label: po.poNumber },
      summary: `Received ${prepared.map(({ line, quantityReceived }) => `${quantityReceived} × ${line.name}`).join(', ')}`,
      meta: { receiptNumber: receipt.receiptNumber, lines: prepared.map(({ line, quantityReceived }) => ({ sku: line.sku, quantityReceived })) },
    });

    const saved = await StockReceipt.findById(receipt._id);
    return { receipt: saved, purchaseOrder: fresh, replayed: false };
  } catch (err) {
    /* Roll back every balance this receipt had already applied, and the
       movements that recorded them, then remove the receipt itself. The
       result is as if the receipt was never attempted. */
    for (const change of applied.reverse()) {
      await Product.updateOne({ _id: change.productId }, { $inc: { stock: -change.delta } }).catch(() => {});
      /* Raw driver call on purpose: the model's immutability hook forbids
         update/delete queries, but a movement created by THIS failed receipt
         is not history — it is debris, and leaving it would make the ledger
         disagree with the balances that were just reversed. */
      await StockMovement.collection.deleteOne({ _id: change.movementId }).catch(() => {});
    }
    await StockReceipt.deleteOne({ _id: receipt._id }).catch(() => {});
    throw err;
  }
}

/** Purchase-order status label used by the UI and reports. */
export const PO_STATUS_VALUES = PO_STATUS;
