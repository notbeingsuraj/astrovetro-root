/* -------------------------------------------------------------------------
   Audit log service
   -------------------------------------------------------------------------

   One function that writes an administrative action to the audit collection,
   used by every admin mutation so the log cannot drift from the code that
   performs the change.

   A failure to write the audit entry is logged loudly and rethrown by
   `recordAudit`, while `auditBestEffort` only logs. Which one a caller uses is
   a deliberate decision:

   - Inventory movements use the ledger itself as the record of truth, so a
     movement that fails to write already rolls the balance back (see
     inventoryService). The audit line is a convenience there, hence best-effort.
   - Product and account changes have no other record, but rolling back a
     completed, valid change because a log write failed would be worse for the
     shop than a loud error line. Those callers log and continue.

   Nothing is ever swallowed silently: every failure path writes to stderr.
   ------------------------------------------------------------------------- */

import { AuditLog } from '../models/AuditLog.js';

function entryFrom({ actor, action, entity, summary, meta }) {
  return {
    actor: {
      userId: actor?.id ?? actor?._id ?? null,
      email: actor?.email || 'system',
      role: actor?.role || '',
    },
    action: String(action).slice(0, 80),
    entity: {
      type: String(entity?.type || 'unknown').slice(0, 40),
      id: String(entity?.id ?? '').slice(0, 120),
      label: String(entity?.label ?? '').slice(0, 200),
    },
    summary: String(summary ?? '').slice(0, 500),
    meta: meta ?? null,
  };
}

/** Write an audit entry, throwing (after logging) if it cannot be written. */
export async function recordAudit(payload) {
  try {
    return await AuditLog.create(entryFrom(payload));
  } catch (err) {
    console.error(`[audit] could not record "${payload?.action}": ${err.message}`);
    throw err;
  }
}

/** Write an audit entry; a failure is logged but does not fail the caller. */
export async function auditBestEffort(payload) {
  try {
    return await AuditLog.create(entryFrom(payload));
  } catch (err) {
    console.error(`[audit] could not record "${payload?.action}" (continuing): ${err.message}`);
    return null;
  }
}

/** Recent audit entries for the dashboard and the product history panel. */
export async function listAudit({ limit = 20, entityType, entityId, action } = {}) {
  const filter = {};
  if (entityType) filter['entity.type'] = entityType;
  if (entityId) filter['entity.id'] = String(entityId);
  if (action) filter.action = action;
  return AuditLog.find(filter).sort({ createdAt: -1 }).limit(Math.min(200, Number(limit) || 20)).lean();
}
