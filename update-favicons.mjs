import fs from 'fs';
import path from 'path';

const publicDir = '/Users/surajkumar/Desktop/Astrovetro-production/public';
const faviconLinks = `
<link rel="icon" type="image/png" sizes="32x32" href="/assets/img/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/assets/img/favicon-16.png">
<link rel="icon" type="image/png" sizes="48x48" href="/assets/img/favicon-48.png">
<link rel="icon" type="image/png" sizes="64x64" href="/assets/img/favicon-64.png">
<link rel="icon" type="image/png" sizes="128x128" href="/assets/img/favicon-128.png">
<link rel="icon" type="image/png" sizes="256x256" href="/assets/img/favicon-256.png">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/img/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/assets/img/favicon-16.png">
<link rel="icon" type="image/png" sizes="256x256" href="/assets/img/favicon-256.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/img/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">`;

const files = [
  '404.html',
  'about.html',
  'account.html',
  'admin.html',
  'article.html',
  'booking.html',
  'cart.html',
  'checkout.html',
  'contact.html',
  'home.html',
  'index.html',
  'journal.html',
  'legal.html',
  'order.html',
  'orders.html',
  'product.html',
  'readings.html',
  'ritual.html',
  'rituals.html',
  'shop.html',
  'signin.html',
  'signup.html',
  'tracking.html',
  'wishlist.html',
  'order.html',
  'orders.html',
  'product.html',
  'readings.html',
  'ritual.html',
  'rituals.html',
  'signin.html',
  'signup.html',
  'tracking.html',
  'wishlist.html',
  'order.html',
  'orders.html',
  'product.html',
  'article.html',
  'legal.html',
  'booking.html',
  'contact.html',
  'home.html',
  'index.html',
  'journal.html',
  'order.html',
  'orders.html',
  'product.html',
  'article.html',
  'legal.html',
];

for (const file of files) {
  const filePath = path.join('/Users/surajkumar/Desktop/Astrovetro-production/public', file);
  if (!fs.existsSync(filePath)) continue;
  
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // Replace the favicon section
  const oldFaviconRegex = /<link rel="icon" href="\/assets\/img\/favicon\.svg" type="image\/svg\+xml">\s*<link rel="apple-touch-icon" href="\/assets\/img\/favicon\.svg">/g;
  if (content.match(/<link rel="icon" href="\/assets\/img\/favicon\.svg" type="image\/svg\+xml">/)) {
    content = content.replace(/<link rel="icon" href="\/assets\/img\/favicon\.svg" type="image\/svg\+xml">\s*<link rel="apple-touch-icon" href="\/assets\/img\/favicon\.svg">/, faviconLinks);
  } else if (content.match(/<link rel="icon" href="\/assets\/img\/favicon\.svg" type="image\/svg\+xml">/)) {
    content = content.replace(/<link rel="icon" href="\/assets\/img\/favicon\.svg" type="image\/svg\+xml">\s*<link rel="apple-touch-icon" href="\/assets\/img\/favicon\.svg">/, faviconLinks);
  } else if (content.match(/<link rel="icon" href="\/assets\/img\/favicon\.svg">/)) {
    content = content.replace(/<link rel="icon" href="\/assets\/img\/favicon\.svg">\s*<link rel="apple-touch-icon" href="\/assets\/img\/favicon\.svg">/, faviconLinks);
  }
  
  // Also handle the case where it's already updated
  if (!content.includes('favicon-32.png')) {
    // Find the old favicon pattern and replace
    content = content.replace(
      /<link rel="icon" href="\/assets\/img\/favicon\.svg"[^>]*>\s*<link rel="apple-touch-icon" href="\/assets\/img\/favicon\.svg">/g,
      faviconLinks
    );
  }
  
  fs.writeFileSync(filePath, content);
  console.log(`Updated ${file}`);
}

console.log('Done!');