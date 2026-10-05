/* -------------------------------------------------------------------------
   Pricing
   -------------------------------------------------------------------------

   The single authority for what anything costs.

   Cart display, checkout revalidation and order creation all call
   `priceCart`. That is the whole point of this file: three places computing
   totals independently is how a customer ends up seeing one number in the bag
   and being charged another.

   Every price here comes from the Product document loaded on the server. There
   is deliberately no parameter through which a caller could pass a price in,
   because the moment such a parameter exists someone will pass a client-supplied
   one.

   Currency is INR throughout, matching the existing catalogue and the reference
   pages' GBP values being sample data only. It is defined once here rather than
   per page so no screen can disagree about the symbol.
   ------------------------------------------------------------------------- */

export const CURRENCY = 'INR';

export const CURRENCY_SYMBOL = '₹';

/* Free delivery above this subtotal. Mirrors the threshold the existing
   Astro Vetro order logic used, so nothing becomes more expensive than before. */
export const FREE_SHIPPING_THRESHOLD = 1500;
export const SHIPPING_FLAT = 99;

/* Zero for now. Indian GST on jewellery is charged at checkout by the payment
   provider once the store is registered, and inventing a rate here would put a
   number on the invoice that the provider does not agree with. Kept as an
   explicit field so adding it later is a one-line change rather than a schema
   migration. */
export const TAX_RATE = 0;

export function shippingFor(subtotal) {
  if (subtotal <= 0) return 0;
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FLAT;
}

/**
 * Price a set of cart lines against live product documents.
 *
 * @param {Array<{product: object, quantity: number}>} lines
 *        `product` must be a loaded Product document. Lines whose product has
 *        gone missing are reported rather than silently dropped, so a cart can
 *        never quietly lose an item.
 * @returns {{subtotal, discount, shipping, tax, total, currency, itemCount,
 *            lines, issues}}
 */
export function priceCart(lines) {
  const priced = [];
  const issues = [];

  for (const line of lines) {
    const p = line.product;
    const qty = line.quantity;

    /* The product was deleted after it was added. Surfaced to the customer
       rather than skipped — a bag that quietly loses things is worse than one
       that explains itself. */
    if (!p) {
      issues.push({ type: 'unavailable', message: 'A piece in your bag is no longer available.' });
      continue;
    }

    if (!p.availability) {
      issues.push({ type: 'unavailable', slug: p.slug, name: p.name, message: `${p.name} is no longer available.` });
      continue;
    }

    /* Tracked stock that cannot cover the requested quantity. Reported, and the
       line is still priced so the customer can see the rest of their bag. */
    if (!p.canFulfil(qty)) {
      issues.push({
        type: 'stock',
        slug: p.slug,
        name: p.name,
        requested: qty,
        available: p.stock,
        message:
          p.stock === 0
            ? `${p.name} has just sold out.`
            : `Only ${p.stock} of ${p.name} ${p.stock === 1 ? 'is' : 'are'} left.`,
      });
    }

    const unitPrice = p.effectivePrice();
    priced.push({
      product: p,
      productId: p._id.toString(),
      slug: p.slug,
      name: p.name,
      image: p.images?.[0] || null,
      unitPrice,
      quantity: qty,
      lineTotal: unitPrice * qty,
    });
  }

  const subtotal = priced.reduce((sum, l) => sum + l.lineTotal, 0);
  const discount = 0;
  const shipping = shippingFor(subtotal);
  const tax = Math.round(subtotal * TAX_RATE);
  const total = subtotal - discount + shipping + tax;

  return {
    lines: priced,
    subtotal,
    discount,
    shipping,
    tax,
    total,
    currency: CURRENCY,
    itemCount: priced.reduce((n, l) => n + l.quantity, 0),
    issues,
  };
}

/** Display helper, so no page formats money its own way. */
export function formatMoney(amount, currency = CURRENCY) {
  const n = Number(amount) || 0;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
  return currency === 'INR' ? `${CURRENCY_SYMBOL}${formatted}` : `${currency} ${formatted}`;
}

/** Serialisable form for the client. Strips the mongoose document. */
export function cartPayload(priced) {
  return {
    lines: priced.lines.map((l) => ({
      productId: l.productId,
      slug: l.slug,
      name: l.name,
      image: l.image,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      lineTotal: l.lineTotal,
      inStock: l.product.canFulfil(l.quantity),
      maxQuantity: l.product.stock == null ? 99 : l.product.stock,
    })),
    subtotal: priced.subtotal,
    discount: priced.discount,
    shipping: priced.shipping,
    tax: priced.tax,
    total: priced.total,
    currency: priced.currency,
    itemCount: priced.itemCount,
    issues: priced.issues,
    freeShippingThreshold: FREE_SHIPPING_THRESHOLD,
    /* What is still needed to unlock free delivery, or null once it is met.
       Lets the bag say "₹412 more for free delivery" without duplicating the
       threshold arithmetic in the browser. */
    amountToFreeShipping:
      priced.subtotal >= FREE_SHIPPING_THRESHOLD ? null : FREE_SHIPPING_THRESHOLD - priced.subtotal,
  };
}
