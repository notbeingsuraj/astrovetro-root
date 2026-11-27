import sharp from 'sharp';

async function generateFavicons() {
  const symbol = await sharp('/Users/surajkumar/Desktop/Astrovetro-production/public/assets/img/brand/astrovetro-symbol.png')
    .ensureAlpha()
    .toBuffer();
  
  // Generate favicon sizes
  await sharp(symbol).resize(16, 16).png().toFile('/Users/surajkumar/Desktop/Astrovetro-production/public/assets/img/favicon-16.png');
  await sharp(symbol).resize(32, 32).png().toFile('/Users/surajkumar/Desktop/Astrovetro-production/public/assets/img/favicon-32.png');
  await sharp(symbol).resize(48, 48).png().toFile('/Users/surajkumar/Desktop/Astrovetro-production/public/assets/img/favicon-48.png');
  await sharp(symbol).resize(64, 64).png().toFile('/Users/surajkumar/Desktop/Astrovetro-production/public/assets/img/favicon-64.png');
  await sharp(symbol).resize(128, 128).png().toFile('/Users/surajkumar/Desktop/Astrovetro-production/public/assets/img/favicon-128.png');
  await sharp(symbol).resize(256, 256).png().toFile('/Users/surajkumar/Desktop/Astrovetro-production/public/assets/img/favicon-256.png');
  await sharp(symbol).resize(192, 192).png().toFile('/Users/surajkumar/Desktop/Astrovetro-production/public/assets/img/favicon-192.png');
  await sharp(symbol).resize(512, 512).png().toFile('/Users/surajkumar/Desktop/Astrovetro-production/public/assets/img/favicon-512.png');
  
  // Apple touch icon
  await sharp(symbol).resize(180, 180).png().toFile('/Users/surajkumar/Desktop/Astrovetro-production/public/assets/img/apple-touch-icon.png');
  
  // Create ICO file with multiple sizes
  const sizes = [16, 32, 48, 64];
  const buffers = await Promise.all(sizes.map(s => 
    sharp(symbol).resize(s, s).png().toBuffer()
  ));
  
  // For ICO, we'll just use the 32x32 as favicon.ico for now
  await sharp(symbol).resize(32, 32).png().toFile('/Users/surajkumar/Desktop/Astrovetro-production/public/assets/img/favicon.ico');
  
  console.log('Favicons generated!');
}

generateFavicons().catch(console.error);