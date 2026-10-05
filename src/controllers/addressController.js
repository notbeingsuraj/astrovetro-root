/* -------------------------------------------------------------------------
   Address controller
   -------------------------------------------------------------------------

   Saved delivery addresses, owned by exactly one account.

   Ownership is enforced two ways at once, because either alone has a gap:

     - Every query filters on `user: req.user._id`. A guessed address id from
       another account therefore matches nothing.
     - Reads and writes return 404, never 403, when the id is not this
       customer's. A 403 would confirm the address exists, which is itself a
       small leak; 404 says nothing either way.

   The first address saved becomes the default automatically, because an account
   with exactly one address and no default is a confusing state for checkout to
   encounter.

   Editing an address does not touch past orders. Orders hold their own snapshot
   of where the parcel went.
   ------------------------------------------------------------------------- */

import { z } from 'zod';
import { Address } from '../models/Address.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { addressFields } from '../middleware/validate.js';

/* One schema, used for both create and edit, so a saved address and a checkout
   address are validated identically. */
const addressSchema = z.object({
  label: z.string().trim().max(40).optional().default('Home'),
  name: addressFields.name(z),
  phone: addressFields.phone(z),
  line1: addressFields.line1(z),
  line2: addressFields.line2(z),
  city: addressFields.city(z),
  state: addressFields.state(z),
  pincode: addressFields.pincode(z),
  country: addressFields.country(z),
  isDefault: z.coerce.boolean().optional().default(false),
});

const validId = (id) => {
  if (!/^[a-f\d]{24}$/i.test(id)) throw ApiError.badRequest('That address could not be identified.');
  return id;
};

/* Scoped find. Returns null rather than throwing so each handler decides
   whether a miss is a 404 in its own context. */
const findOwned = (userId, addressId) => Address.findOne({ _id: validId(addressId), user: userId });

/* Clears the current default before setting a new one.

   Done as two writes rather than relying on the partial unique index to reject
   the second: the index would surface as a duplicate-key 409 to the customer,
   which reads as a failure when in fact they simply chose a different default.
   Setting a default always succeeds.

   ORDER IS THE WHOLE POINT. The clear must happen before the set — including
   before the new address is *created*. Creating an address with isDefault:true
   while another row already holds it violates the partial unique index at insert
   time and fails the whole request, which is why createAddress inserts false and
   promotes afterwards. */
async function makeDefault(userId, addressId) {
  await Address.updateMany({ user: userId, isDefault: true, _id: { $ne: addressId } }, { $set: { isDefault: false } });
  await Address.updateOne({ _id: addressId, user: userId }, { $set: { isDefault: true } });
}

export const listAddresses = asyncHandler(async (req, res) => {
  const rows = await Address.find({ user: req.user._id }).sort({ isDefault: -1, createdAt: -1 });
  res.json({
    success: true,
    data: { addresses: rows.map((a) => a.toPublic()), count: rows.length },
  });
});

export const createAddress = asyncHandler(async (req, res) => {
  const body = addressSchema.parse(req.body);

  const count = await Address.countDocuments({ user: req.user._id });
  /* The first address is always the default, whether or not the client asked
     for it. */
  const isDefault = body.isDefault || count === 0;

  /* Always inserted non-default, then promoted below. Inserting true here would
     trip the partial unique index against an existing default before makeDefault
     ever gets a chance to clear it. */
  const address = await Address.create({ ...body, user: req.user._id, isDefault: false });
  if (isDefault) {
    await makeDefault(req.user._id, address._id);
    address.isDefault = true;
  }

  res.status(201).json({ success: true, data: { address: address.toPublic() } });
});

export const updateAddress = asyncHandler(async (req, res) => {
  const body = addressSchema.partial().parse(req.body);
  const address = await findOwned(req.user._id, req.params.addressId);
  if (!address) throw ApiError.notFound('We could not find that address.');

  /* An edit that promotes this address must displace the previous default
     *before* the row is written, for the same index reason as above. So
     isDefault is held back from the assign and applied afterwards. */
  const promoting = body.isDefault === true;
  const fields = { ...body };
  delete fields.isDefault;

  Object.assign(address, fields);
  /* Persisted as false during the edit so the unique index is never violated;
     makeDefault below promotes it and re-reads the value. */
  await address.save();

  if (promoting) {
    await makeDefault(req.user._id, address._id);
    address.isDefault = true;
  }

  res.json({ success: true, data: { address: address.toPublic() } });
});

export const setDefaultAddress = asyncHandler(async (req, res) => {
  const address = await findOwned(req.user._id, req.params.addressId);
  if (!address) throw ApiError.notFound('We could not find that address.');

  await makeDefault(req.user._id, address._id);
  const fresh = await Address.findById(address._id);
  res.json({ success: true, data: { address: fresh.toPublic() } });
});

export const deleteAddress = asyncHandler(async (req, res) => {
  const address = await findOwned(req.user._id, req.params.addressId);
  if (!address) throw ApiError.notFound('We could not find that address.');

  const wasDefault = address.isDefault;
  await address.deleteOne();

  /* Deleting the default leaves the account with none, which checkout would then
     have to guess about. Promote the most recent remaining address. */
  if (wasDefault) {
    const next = await Address.findOne({ user: req.user._id }).sort({ createdAt: -1 });
    if (next) await makeDefault(req.user._id, next._id);
  }

  res.json({ success: true, data: { deleted: true } });
});
