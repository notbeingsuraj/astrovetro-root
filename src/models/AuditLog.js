/* -------------------------------------------------------------------------
   AuditLog — what an administrator changed
   -------------------------------------------------------------------------

   Append-only record of consequential administrative actions: product
   creation, edits, archival, inventory adjustments, receipts, role changes.
   Written by the services that perform the action, so the log and the change
   come from the same code path.

   Kept out of hot paths' way: failures to write a log entry are surfaced but
   never silently swallowed — an audit trail that can silently stop is worse
   than none, because it looks complete.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    actor: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      email: { type: String, required: true, maxlength: 160 },
      role: { type: String, default: '' },
    },
    action: { type: String, required: true, maxlength: 80, index: true },
    entity: {
      type: { type: String, required: true, maxlength: 40, index: true },
      id: { type: String, default: '', maxlength: 120 },
      label: { type: String, default: '', maxlength: 200 },
    },
    /* Short human-readable summary, plus optional structured detail. */
    summary: { type: String, default: '', maxlength: 500 },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany'], function () {
  throw new Error('Audit records are immutable history and cannot be modified.');
});

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ 'entity.type': 1, 'entity.id': 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
