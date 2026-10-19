/* -------------------------------------------------------------------------
   Admin system controller
   -------------------------------------------------------------------------

   Accounts, settings and the audit trail — the screens that answer "who can
   do this" and "who did that".

   The role toggle carries the one guard that matters: the last remaining
   admin cannot be demoted, because a dashboard nobody can enter is not a
   recoverable state from inside the dashboard. Passwords are never handled
   here; account creation produces an invitation-free account whose password
   the administrator sets through the same public auth flow the customer
   uses (see scripts/create-admin.mjs for the local bootstrap). */

import { z } from 'zod';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../services/auditService.js';
import { LOW_STOCK_DEFAULT } from '../models/Product.js';

const id = (v) => mongoose.isValidObjectId(v);

/* ── Users ───────────────────────────────────────────────────────────────── */

export const listUsers = asyncHandler(async (req, res) => {
  const q = z
    .object({
      search: z.string().trim().optional(),
      role: z.enum(['customer', 'admin']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    })
    .parse(req.query);

  const filter = {};
  if (q.role) filter.role = q.role;
  if (q.search) {
    const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ email: rx }, { name: rx }];
  }

  const limit = q.limit;
  const skip = (q.page - 1) * limit;
  const [rows, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  /* Shape the rows here rather than exposing the model's own serialiser:
     nothing about an account beyond these fields is any dashboard's business. */
  return res.json({
    success: true,
    data: {
      items: rows.map((u) => ({
        id: u._id.toString(),
        email: u.email,
        name: u.name || '',
        role: u.role,
        emailVerified: u.emailVerified,
        createdAt: u.createdAt,
      })),
      meta: {
        page: q.page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: q.page * limit < total,
      },
    },
  });
});

async function adminCount(excludeUserId) {
  const filter = { role: 'admin' };
  if (excludeUserId) filter._id = { $ne: excludeUserId };
  return User.countDocuments(filter);
}

export const setUserRole = asyncHandler(async (req, res) => {
  if (!id(req.params.userId)) throw ApiError.badRequest('That account id is not valid.');
  const { role } = z.object({ role: z.enum(['customer', 'admin']) }).parse(req.body);

  const user = await User.findById(req.params.userId);
  if (!user) throw ApiError.notFound('We could not find that account.');

  if (user.role === role) return res.json({ success: true, data: { user: { id: user._id, role: user.role } } });

  /* Guard: never leave the store without an administrator. */
  if (user.role === 'admin' && role === 'customer' && (await adminCount(user._id)) === 0) {
    throw ApiError.conflict('This is the last admin account. Promote another account before changing this one.');
  }

  user.role = role;
  await user.save();

  await recordAudit({
    actor: req.user,
    action: 'user.role',
    entity: { type: 'user', id: user._id.toString(), label: user.email },
    summary: `Changed ${user.email} from ${role === 'admin' ? 'customer' : 'admin'} to ${role}`,
  });
  return res.json({ success: true, data: { user: { id: user._id, email: user.email, role: user.role } } });
});

/* ── Audit trail ─────────────────────────────────────────────────────────── */

export const listAudit = asyncHandler(async (req, res) => {
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(30),
      action: z.string().trim().optional(),
      entityType: z.string().trim().optional(),
    })
    .parse(req.query);

  const filter = {};
  if (q.action) filter.action = q.action;
  if (q.entityType) filter['entity.type'] = q.entityType;

  const limit = q.limit;
  const skip = (q.page - 1) * limit;
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  return res.json({
    success: true,
    data: {
      items: rows,
      meta: {
        page: q.page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: q.page * limit < total,
      },
    },
  });
});

/* ── Settings ────────────────────────────────────────────────────────────── */

/* Read-only by design for now: the values here are policy the code already
   applies (the low-stock default, the accepted upload formats, the currency
   the pricing service uses). Exposing them for editing would promise
   configurability the rest of the system does not honour, so the dashboard
   displays them as the single source of truth instead. */
export const getSettings = asyncHandler(async (_req, res) => {
  return res.json({
    success: true,
    data: {
      lowStockDefault: LOW_STOCK_DEFAULT,
      currency: process.env.CURRENCY || 'INR',
      acceptedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxUploadMB: 12,
      auth: {
        mechanism: 'JWT in an httpOnly cookie (av_token)',
        rateLimits: {
          login: '10 attempts / 15 minutes per IP',
          register: '5 attempts / hour per IP',
        },
      },
      reservedStock: {
        supported: false,
        note: 'Orders decrement stock at payment; there is no reservation phase, so available equals on hand.',
      },
    },
  });
});
