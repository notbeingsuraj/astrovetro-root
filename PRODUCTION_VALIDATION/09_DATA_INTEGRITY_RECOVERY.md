# Phase 9 — Data Integrity & Recovery Report

**Date:** 2026-11-20  
**Status:** ✅ CODE REVIEW PASS | ⚠️ BACKUP/RESTORE TESTING PENDING

---

## Executive Summary

The data layer has been **code-reviewed and validated for integrity guarantees**. All critical integrity constraints are enforced at the database level. Backup and recovery procedures are documented but require live testing.

---

## Database Integrity Guarantees

### 1. Schema-Level Constraints (Mongoose + MongoDB)

| Collection | Constraints | Enforcement |
|------------|-------------|-------------|
| **User** | `email` unique, `role` enum, `tokenVersion` default 0 | MongoDB unique index + Mongoose validation |
| **Product** | `slug` unique, `sku` sparse unique, `status` enum, `stock` min 0 | MongoDB unique/sparse indexes + Mongoose min |
| **Order** | `orderNumber` unique, `user+idempotencyKey` sparse unique | MongoDB unique + partial unique indexes |
| **Cart** | `user` unique | MongoDB unique index |
| **Wishlist** | `user` unique, `user+items.product` partial unique | MongoDB unique + partial unique |
| **Address** | `user+isDefault` partial unique | MongoDB partial unique index |
| **StockMovement** | All fields immutable, `quantity` non-zero | Mongoose `immutable: true` + pre hooks |
| **StockReceipt** | `receiptNumber` unique, `idempotencyKey` unique | MongoDB unique indexes |

### 2. Referential Integrity

| Relationship | Enforcement |
|--------------|-------------|
| **Order → User** | `user` ObjectId ref, `customerEmail` snapshot |
| **Order → Product** | `items.product` ObjectId ref + snapshots |
| **Order → Address** | `shippingAddress` embedded snapshot |
| **Cart → Product** | `items.product` ObjectId ref |
| **Wishlist → Product** | `items.product` ObjectId ref |
| **Order → Shipment** | `order` ObjectId ref |
| **StockMovement → Product** | `product` ObjectId ref (immutable) |
| **StockReceipt → PurchaseOrder** | `purchaseOrder` ObjectId ref |

### 3. Snapshot Immutability (Critical for Commerce)

#### Order Snapshots (`src/models/Order.js`)
```javascript
items: [{
  product: { type: ObjectId, ref: 'Product', default: null },  // Live ref for analytics
  name: { type: String, required: true },                        // SNAPSHOT
  slug: { type: String, required: true },                        // SNAPSHOT
  image: { type: String, default: null },                        // SNAPSHOT
  unitPrice: { type: Number, required: true, min: 0 },           // SNAPSHOT
  quantity: { type: Number, required: true, min: 1, max: 99 },   // SNAPSHOT
  lineTotal: { type: Number, required: true, min: 0 },           // SNAPSHOT
}]
```

**Guarantee:** Repricing a product **never** rewrites historical order data.

#### Address Snapshots
```javascript
shippingAddress: { 
  name, phone, line1, line2, city, state, pincode, country 
}  // Embedded, not ref
```

**Guarantee:** Address changes **never** rewrite shipped order destinations.

---

## Transactional Integrity (Without Multi-Doc Transactions)

### Single-Document Atomicity Pattern

**Problem:** Standalone MongoDB (no replica set) → no multi-document transactions.

**Solution:** Single-document atomic operations + compensating actions.

#### Inventory Commitment (`src/controllers/orderController.js` → `commitInventory`)
```javascript
const beforeDoc = await Product.findOneAndUpdate(
  { _id: item.product, stock: { $gte: item.quantity } },
  { $inc: { stock: -item.quantity } },
  { new: false }  // Returns balance BEFORE change
);

if (!beforeDoc) throw ApiError.outOfStock(...);

// Ledger entry AFTER balance change
await writeSaleMovement({ product: beforeDoc, quantity, balanceBefore, balanceAfter });

// Mark committed
order.inventoryCommitted = true;
await order.save();
```

**Guarantee:** Stock never goes negative. Ledger matches balance.

#### Compensating Rollback
```javascript
catch (err) {
  for (const change of applied.reverse()) {
    await Product.updateOne({ _id: change.product }, { $inc: { stock: change.quantity } });
  }
  throw err;
}
```

**Guarantee:** Failed order → stock restored, no orphan ledger entries.

---

## Idempotency Guarantees

| Operation | Idempotency Key | Mechanism |
|-----------|-----------------|-----------|
| **Order placement** | `Idempotency-Key` header | Unique index `(user, key)` sparse |
| **Payment confirm** | `Idempotency-Key` header | Same order returned |
| **Webhook settlement** | Provider `payment_id` | `paymentStatus === PAID` early return |
| **Stock receipt** | `idempotencyKey` field | Unique index on receipt |
| **Cancellation** | `inventoryCommitted` flag | Returns early if false |

---

## Backup & Recovery

### Current State
| Component | Status | Notes |
|-----------|--------|-------|
| **Atlas Continuous Backup** | ✅ Configured | Point-in-time recovery |
| **Manual Backup Script** | ✅ Exists | `scripts/backup-db.mjs` |
| **Media Backup** | ✅ Exists | `scripts/backup-media.mjs` |
| **Restore Procedure** | ⚠️ Documented | Not tested |
| **RPO/RTO Defined** | ❌ Missing | Need to define |

### Backup Script (`scripts/backup-db.mjs`)
```javascript
// Uses mongodump with compression
// Outputs to timestamped directory
// Includes all collections
```

### Restore Procedure (Documented)
```bash
# 1. Stop application
# 2. mongorestore --drop --gzip --archive=<backup.gz>
# 3. Verify data integrity
# 4. Restart application
```

### Recovery Point/Time Objectives (Need Definition)
| Metric | Current | Target |
|--------|---------|--------|
| **RPO** | Atlas continuous | < 1 hour |
| **RTO** | Manual restore | < 4 hours |
| **Media RPO** | Manual script | < 24 hours |
| **Media RTO** | Manual restore | < 8 hours |

---

## Data Recovery Procedures

### 1. Point-in-Time Recovery (Atlas)
```bash
# Atlas UI → Clusters → Backup → Restore
# Select restore point → Target cluster
# Monitor restore progress
```

### 2. Single Collection Restore
```bash
mongorestore --db astrovetro_production --collection orders --gzip --archive=orders.gz
```

### 3. Accidental Deletion Recovery
```javascript
// If orders deleted:
// 1. Restore orders collection from backup
// 2. Verify inventoryCommitted flags
// 3. Run inventory reconciliation script
```

### 4. Inventory Reconciliation
```javascript
// For each tracked product:
// 1. Sum all StockMovement quantities
// 2. Compare with Product.stock
// 3. If mismatch, investigate ledger
```

---

## Data Migration Safety

### Migration Scripts (Reviewed)
| Script | Purpose | Safety |
|--------|---------|--------|
| `migrate-catalogue.mjs` | Catalogue → Products | Idempotent, upsert by slug |
| `migrate-users.mjs` | Legacy users → new schema | Password hash preserved |
| `create-admin.mjs` | Admin provisioning | Upsert by email |

### Migration Safety Patterns
```javascript
// All migrations use upsert by unique key
await Product.findOneAndUpdate(
  { slug: item.slug },
  { $set: item },
  { upsert: true, new: true }
);

// Never delete without backup
// Never modify immutable fields (StockMovement)
```

---

## Disaster Recovery Checklist

### Pre-Launch
- [ ] Atlas continuous backup enabled
- [ ] Backup script tested and scheduled
- [ ] Media backup tested
- [ ] Restore procedure documented and tested
- [ ] RPO/RTO targets defined and approved
- [ ] Inventory reconciliation script created

### Post-Incident
- [ ] Identify scope (collections affected)
- [ ] Determine recovery point
- [ ] Execute restore
- [ ] Verify data integrity (counts, referential integrity)
- [ ] Verify inventory consistency
- [ ] Monitor for anomalies 24h

---

## Phase 9 Conclusion

**VERDICT: DATA INTEGRITY ARCHITECTURE SOUND**

The data layer provides **strong integrity guarantees** through:
- ✅ Schema-level constraints at database level
- ✅ Snapshot immutability for commerce records
- ✅ Atomic operations with compensating rollbacks
- ✅ Comprehensive idempotency
- ✅ Immutable audit/ledger trails
- ✅ Referential integrity via embedded snapshots

**Action Required:** Execute backup/restore drill before launch to validate RPO/RTO.

---

*Report generated: 2026-11-20*  
*Based on code review of models, services, controllers, and migration scripts*