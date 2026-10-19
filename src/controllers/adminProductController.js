export const createProduct = asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  const slug = (body.slug || body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
  const sku = sanitizeSku(body.sku, slug);

  const exists = await Product.findOne({ $or: [{ slug }, { sku }] });
  if (exists) throw ApiError.conflict('A product with that slug or SKU already exists.');

  const product = await Product.create({
    name: body.name,
    slug,
    category: String(body.category).toLowerCase(),
    sku,
    price: body.price,
    salePrice: body.salePrice,
    costPrice: body.costPrice,
    shortDescription: body.shortDescription,
    description: body.description,
    stone: body.stone,
    metal: body.metal,
    featured: body.featured,
    status: body.status,
    availability: body.availability,
    needsReview: body.needsReview,
    reviewNote: body.reviewNote,
    reorderThreshold: body.reorderThreshold,
    reorderQuantity: body.reorderQuantity,
    tags: body.tags,
  });

  await recordAudit({
    actor: req.user,
    action: 'product.create',
    entity: { type: 'product', id: product._id.toString(), label: product.name },
    summary: `Created product ${product.slug} (SKU ${product.sku})`,
  });

  return res.status(201).json({ success: true, data: { product: product.toAdmin() } });
});

export const updateProduct = asyncHandler(async (req, res) => {
  const body = updateSchema.parse(req.body);
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound('We could not find that product.');

  if (body.slug !== undefined && body.slug !== product.slug) {
    const exists = await Product.findOne({ slug: body.slug });
    if (exists) throw ApiError.conflict('A product with that slug already exists.');
  }
  if (body.sku !== undefined) {
    const sku = sanitizeSku(body.sku, body.slug || product.slug);
    if (sku !== product.sku) {
      const exists = await Product.findOne({ sku });
      if (exists) throw ApiError.conflict('A product with that SKU already exists.');
      body.sku = sku;
    }
  }

  if (body.status === 'archived') body.availability = false; // hide on public

  Object.assign(product, body);
  if (product.slug) product.slug = String(product.slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (product.category) product.category = String(product.category).toLowerCase();

  await product.save();

  await recordAudit({
    actor: req.user,
    action: 'product.update',
    entity: { type: 'product', id: product._id.toString(), label: product.name },
    summary: `Updated product ${product.slug}`,
  });

  return res.json({ success: true, data: { product: product.toAdmin() } });
});

export const archiveProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound('We could not find that product.');
  if (product.status === 'archived') return res.json({ success: true, data: { product: product.toAdmin() } });

  product.status = 'archived';
  product.availability = false;
  await product.save();

  await recordAudit({
    actor: req.user,
    action: 'product.archive',
    entity: { type: 'product', id: product._id.toString(), label: product.name },
    summary: `Archived product ${product.slug}`,
  });
  return res.json({ success: true, data: { product: product.toAdmin() } });
});

export const restoreProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound('We could not find that product.');
  if (product.status !== 'archived') return res.json({ success: true, data: { product: product.toAdmin() } });

  product.status = 'active';
  await product.save();

  await recordAudit({
    actor: req.user,
    action: 'product.restore',
    entity: { type: 'product', id: product._id.toString(), label: product.name },
    summary: `Restored product ${product.slug}`,
  });
  return res.json({ success: true, data: { product: product.toAdmin() } });
});
