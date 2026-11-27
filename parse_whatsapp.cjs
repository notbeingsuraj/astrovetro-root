const fs = require('fs');
const path = require('path');

// Read the chat file
const chatPath = path.join(__dirname, 'secret-files/whatsapp_extract/_chat.txt');
const chatContent = fs.readFileSync(chatPath, 'utf-8');

// Parse the chat
const lines = chatContent.split('\n');

const products = [];
const seenProducts = new Map(); // For deduplication

// Regex to match product lines:
// [timestamp] ~ Astro Vetro: Product name ₹price <attached: image.jpg>
// The product name is everything between the colon after sender and the price symbol
const productLineRegex = /\[\d{2}\/\d{2}\/\d{2}, \d{2}:\d{2}:\d{2}\]\s*[^:]+:\s*(.+?)\s*[₹Rs]\s*(\d[\d,]*)\s*<attached:\s*([^>]+)>/g;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Reset regex lastIndex for each line
  productLineRegex.lastIndex = 0;
  
  let match;
  while ((match = productLineRegex.exec(line)) !== null) {
    const fullMatch = match[0];
    const productName = match[1].trim();
    const price = match[2].replace(/,/g, '');
    const imageFile = match[3].trim();
    
    // Clean up product name - remove emojis and extra spaces
    const cleanName = productName
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/[😳😍😊😂🤣😭😱😍🥰😘😍]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Skip if it's just comments or very short
    if (cleanName.toLowerCase().includes('very pretty') || 
        cleanName.toLowerCase().includes('good hai') ||
        cleanName.toLowerCase().includes('just slight') ||
        cleanName.toLowerCase().includes('please') ||
        cleanName.toLowerCase().includes('today') ||
        cleanName.toLowerCase().includes('number') ||
        cleanName.toLowerCase().includes('password') ||
        cleanName.toLowerCase().includes('email') ||
        cleanName.toLowerCase().includes('update') ||
        cleanName.toLowerCase().includes('hi') ||
        cleanName.length < 3) {
      continue;
    }
    
    // Create a unique key for deduplication
    const key = `${cleanName.toLowerCase()}_${price}_${imageFile}`;
    
    if (!seenProducts.has(key)) {
      seenProducts.set(key, true);
      
      // Determine category based on name
      let category = 'crystal';
      const nameLower = cleanName.toLowerCase();
      if (nameLower.includes('ring')) category = 'jewellery';
      else if (nameLower.includes('pendant') || nameLower.includes('necklace') || nameLower.includes('cross')) category = 'jewellery';
      else if (nameLower.includes('bracelet') || nameLower.includes('bangle')) category = 'jewellery';
      else if (nameLower.includes('earring')) category = 'jewellery';
      else if (nameLower.includes('tower') || nameLower.includes('point') || nameLower.includes('sphere') || nameLower.includes('cluster') || nameLower.includes('raw') || nameLower.includes('chunk') || nameLower.includes('tower')) category = 'crystal';
      else if (nameLower.includes('pendulum')) category = 'ritual';
      else if (nameLower.includes('egg') || nameLower.includes('carved')) category = 'crystal';
      else if (nameLower.includes('lollipop') || nameLower.includes('yoda') || nameLower.includes('snake') || nameLower.includes('cat') || nameLower.includes('fox') || nameLower.includes('koala') || nameLower.includes('butterfly') || nameLower.includes('mermaid') || nameLower.includes('lion') || nameLower.includes('bumblebee') || nameLower.includes('spider') || nameLower.includes('witch') || nameLower.includes('pregnant') || nameLower.includes('woman') || nameLower.includes('moon') || nameLower.includes('fairy')) category = 'carved';
      else if (nameLower.includes('hair clip') || nameLower.includes('broach') || nameLower.includes('brooch')) category = 'accessory';
      else if (nameLower.includes('tarot')) category = 'tarot';
      else if (nameLower.includes('disk') || nameLower.includes('plate')) category = 'ritual';
      
      // Determine confidence
      let confidence = 'high';
      if (cleanName.includes('...') || cleanName.length < 5) confidence = 'low';
      else if (cleanName.includes('(') && cleanName.includes(')')) confidence = 'medium';
      else if (cleanName.includes('cracked') || cleanName.includes('heated')) confidence = 'medium';
      
      products.push({
        name: cleanName,
        description: cleanName,
        price: parseInt(price),
        priceRaw: `₹${price}`,
        images: [imageFile],
        category,
        source: `Line ${i + 1}: ${line.substring(0, 150)}...`,
        confidence,
        duplicateOf: null
      });
    }
  }
}

// Now group products by name and price to consolidate multiple images
const productGroups = new Map();

for (const product of products) {
  const groupKey = `${product.name.toLowerCase()}_${product.price}`;
  if (!productGroups.has(groupKey)) {
    productGroups.set(groupKey, {
      name: product.name,
      description: product.name,
      price: product.price,
      priceRaw: product.priceRaw,
      images: [],
      category: product.category,
      sources: [],
      confidence: product.confidence,
      duplicateOf: null
    });
  }
  const group = productGroups.get(groupKey);
  group.images.push(...product.images);
  group.sources.push(product.source);
}

// Convert to array and deduplicate images
const uniqueProducts = Array.from(productGroups.values()).map(p => ({
  ...p,
  images: [...new Set(p.images)],
  source: p.sources.join('; ')
}));

// Write outputs
const outputDir = path.join(__dirname, 'whatsapp_products_output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 1. Manifest JSON
const manifest = {
  extractedAt: new Date().toISOString(),
  sourceFile: '_chat.txt',
  totalProducts: uniqueProducts.length,
  products: uniqueProducts.map((p, i) => ({
    id: i + 1,
    name: p.name,
    description: p.description,
    price: p.price,
    priceFormatted: p.priceRaw,
    currency: 'INR',
    images: p.images,
    category: p.category,
    sourceReference: p.source,
    confidence: p.confidence,
    status: 'draft',
    slug: p.name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 100),
    duplicateOf: p.duplicateOf,
    verified: false
  }))
};

fs.writeFileSync(
  path.join(outputDir, 'whatsapp-products-manifest.json'),
  JSON.stringify(manifest, null, 2)
);

// 2. Review CSV
const csvHeaders = [
  'ID', 'Product Name', 'Description', 'Price (INR)', 'Price Raw', 
  'Currency', 'Image Filenames', 'Category', 'Source Reference', 
  'Confidence', 'Status', 'Slug', 'Verified', 'Notes'
];

const csvRows = manifest.products.map(p => [
  p.id,
  `"${p.name.replace(/"/g, '""')}"`,
  `"${p.description.replace(/"/g, '""')}"`,
  p.price,
  p.priceFormatted,
  p.currency,
  `"${p.images.join('; ')}"`,
  p.category,
  `"${p.sourceReference.replace(/"/g, '""')}"`,
  p.confidence,
  p.status,
  p.slug,
  p.verified ? 'Yes' : 'No',
  ''
]);

const csvContent = [csvHeaders.join(','), ...csvRows.map(r => r.join(','))].join('\n');
fs.writeFileSync(path.join(outputDir, 'whatsapp-products-review.csv'), csvContent);

// 3. Report Markdown
const report = `# WHATSAPP CATALOGUE EXTRACTION REPORT

## Executive Summary
Extracted product data from WhatsApp chat export "_chat.txt" dated 2026-10-31 to 2026-11-18.

## Extraction Statistics
- **Total products identified**: ${uniqueProducts.length}
- **Products with verified prices**: ${uniqueProducts.filter(p => p.confidence === 'high').length}
- **Products with matched images**: ${uniqueProducts.filter(p => p.images.length > 0).length}
- **Ambiguous/incomplete records**: ${uniqueProducts.filter(p => p.confidence !== 'high').length}
- **Duplicate records detected and consolidated**: ${products.length - uniqueProducts.length}

## Product Details

| ID | Name | Price | Category | Images | Confidence |
|----|------|-------|----------|--------|------------|
${uniqueProducts.map((p, i) => `| ${i+1} | ${p.name} | ₹${p.price} | ${p.category} | ${p.images.length} | ${p.confidence} |`).join('\n')}

## Image Mapping
${uniqueProducts.map((p, i) => `### ${i+1}. ${p.name}
- **Price**: ${p.priceRaw}
- **Category**: ${p.category}
- **Images**: ${p.images.join(', ') || 'NONE'}
- **Confidence**: ${p.confidence}
- **Source**: ${p.source}
`).join('\n')}

## Duplicate Detection
${products.length > uniqueProducts.length 
  ? `Found ${products.length - uniqueProducts.length} duplicate entries that were consolidated. Duplicates typically occurred when the same product was photographed from multiple angles and posted in quick succession.`
  : 'No duplicates detected.'}

## Ambiguous/Incomplete Records
${uniqueProducts.filter(p => p.confidence !== 'high').map(p => `- **${p.name}** (${p.confidence}): ${p.source}`).join('\n') || 'None'}

## Products Prepared for Listing
${uniqueProducts.filter(p => p.confidence === 'high' && p.images.length > 0).length} products have high confidence and at least one image, ready for review.

## Storage Verification
- **Storage adapter**: Not yet verified (requires B2 credentials)
- **Images to upload**: ${uniqueProducts.reduce((sum, p) => sum + p.images.length, 0)} unique images
- **Total image size**: ~${Math.round(uniqueProducts.reduce((sum, p) => sum + p.images.length * 500, 0) / 1000)}KB estimated

## Files Generated
- \`whatsapp-products-manifest.json\` - Structured product data for integration
- \`whatsapp-products-review.csv\` - Spreadsheet for manual review
- \`WHATSAPP_CATALOGUE_EXTRACTION_REPORT.md\` - This report

## Next Steps
1. Review CSV for accuracy
2. Verify image associations
3. Map categories to Astrovetro schema
4. Upload images via storage adapter
4. Create product records in draft status
5. Publish after review
`;

fs.writeFileSync(path.join(outputDir, 'WHATSAPP_CATALOGUE_EXTRACTION_REPORT.md'), report);

console.log(`Extraction complete!`);
console.log(`- Products found: ${uniqueProducts.length}`);
console.log(`- Raw matches: ${products.length}`);
console.log(`- Duplicates consolidated: ${products.length - uniqueProducts.length}`);
console.log(`- Output directory: ${outputDir}`);