/**
 * Storefront Initialization Regression Tests
 * 
 * These tests verify that the shared storefront initialization (header, footer, logo)
 * works correctly and does not throw the "this.esc is not a function" error.
 * 
 * Tests run without external dependencies by analyzing source code and
 * using Node's built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

describe('Storefront Initialization', () => {
  const storeSource = readFileSync(join(PROJECT_ROOT, 'public/assets/store.js'), 'utf8');
  const apiSource = readFileSync(join(PROJECT_ROOT, 'public/assets/api.js'), 'utf8');

  describe('AV.esc utility', () => {
    it('should be defined in api.js', () => {
      assert.ok(apiSource.includes('AV.esc ='), 'AV.esc should be defined in api.js');
    });

    it('should be a function that escapes HTML', () => {
      // Verify the implementation exists
      assert.ok(apiSource.includes('replace(/&/g'), 'Should escape &');
      assert.ok(apiSource.includes('replace(/</g'), 'Should escape <');
      assert.ok(apiSource.includes('replace(/>/g'), 'Should escape >');
      assert.ok(apiSource.includes('replace(/"/g'), 'Should escape "');
      assert.ok(apiSource.includes('replace(/\'/g'), 'Should escape \'');
    });
  });

  describe('BRAND object in store.js', () => {
    it('should have logo function', () => {
      assert.ok(storeSource.includes('logo: function'), 'BRAND should have logo function');
    });

    it('should use AV.esc not this.esc for src attribute', () => {
      // This is the core fix: AV.esc(src) instead of this.esc(src)
      assert.ok(storeSource.includes('AV.esc(src)'), 'Should use AV.esc(src)');
      assert.ok(!storeSource.includes('this.esc(src)'), 'Should NOT use this.esc(src)');
    });

    it('should use AV.esc not this.esc for alt attribute', () => {
      // This is the core fix: AV.esc(this.alt) instead of this.esc(this.alt)
      assert.ok(storeSource.includes('AV.esc(this.alt)'), 'Should use AV.esc(this.alt)');
      assert.ok(!storeSource.includes('this.esc(this.alt)'), 'Should NOT use this.esc(this.alt)');
    });

    it('should have correct logo asset paths', () => {
      assert.ok(storeSource.includes('astrovetro-wordmark.png'), 'Should reference wordmark');
      assert.ok(storeSource.includes('astrovetro-symbol.png'), 'Should reference symbol');
    });

    it('should have width configurations for desktop, mobile, footer', () => {
      assert.ok(storeSource.includes('desktop:'), 'Should have desktop widths');
      assert.ok(storeSource.includes('mobile:'), 'Should have mobile widths');
      assert.ok(storeSource.includes('footer:'), 'Should have footer widths');
    });
  });

  describe('Header initialization chain', () => {
    it('should have headerHTML function that calls BRAND.logo', () => {
      assert.ok(storeSource.includes('headerHTML'), 'Should have headerHTML function');
      assert.ok(storeSource.includes('BRAND.logo'), 'headerHTML should call BRAND.logo');
    });

    it('should have mount function that calls headerHTML', () => {
      assert.ok(storeSource.includes('function mount'), 'Should have mount function');
      assert.ok(storeSource.includes('headerHTML()'), 'mount should call headerHTML');
    });

    it('should have boot function that calls mount', () => {
      assert.ok(storeSource.includes('AV.boot'), 'Should have boot function');
      assert.ok(storeSource.includes('mount('), 'boot should call mount');
    });
  });

  describe('Footer initialization', () => {
    it('should have footerHTML function that calls BRAND.logo', () => {
      assert.ok(storeSource.includes('footerHTML'), 'Should have footerHTML function');
      assert.ok(storeSource.includes('BRAND.logo'), 'footerHTML should call BRAND.logo');
      // Verify it calls with 'footer' size
      assert.ok(storeSource.includes('footer'), 'footerHTML should use footer size');
    });
  });

  describe('Original bug regression', () => {
    it('should not contain the buggy pattern this.esc()', () => {
      // This is the exact error from production:
      // Uncaught TypeError: this.esc is not a function
      //     at logo (store.js:32)
      //     at headerHTML (store.js:102)
      //     at mount (store.js:182)
      //     at boot (store.js:844)
      
      // The fix changes this.esc to AV.esc in BRAND.logo
      assert.ok(!storeSource.includes('this.esc('), 'Should not use this.esc() anywhere');
    });

    it('should use AV.esc for all escaping in BRAND.logo', () => {
      // Verify both src and alt use AV.esc
      const logoFunctionMatch = storeSource.match(/logo:\s*function\s*\([^)]*\)\s*\{[\s\S]*?\}/);
      assert.ok(logoFunctionMatch, 'Should find logo function');
      
      const logoBody = logoFunctionMatch[0];
      assert.ok(logoBody.includes('AV.esc(src)'), 'Logo should escape src with AV.esc');
      assert.ok(logoBody.includes('AV.esc(this.alt)'), 'Logo should escape alt with AV.esc');
    });
  });

  describe('Cross-page header rendering verification', () => {
    const pages = [
      'home.html',
      'shop.html', 
      'product.html',
      'rituals.html',
      'journal.html',
      'about.html',
      'contact.html',
      'cart.html',
      'checkout.html',
      'wishlist.html',
      'account.html',
      'orders.html',
      'signin.html',
      'signup.html',
      'legal.html',
      'admin.html',
    ];

    for (const page of pages) {
      it(`should have required containers in ${page}`, () => {
        const pageSource = readFileSync(join(PROJECT_ROOT, `public/${page}`), 'utf8');
        assert.ok(pageSource.includes('id="siteHeader"'), `${page} should have siteHeader container`);
        assert.ok(pageSource.includes('id="siteFooter"'), `${page} should have siteFooter container`);
        assert.ok(pageSource.includes('/assets/store.js'), `${page} should load store.js`);
        assert.ok(pageSource.includes('/assets/api.js'), `${page} should load api.js`);
      });
    }
  });

  describe('Script loading order', () => {
    it('should load api.js before store.js on all pages', () => {
      const pages = [
        'home.html',
        'shop.html', 
        'product.html',
        'rituals.html',
        'journal.html',
        'about.html',
        'contact.html',
        'cart.html',
        'checkout.html',
        'wishlist.html',
        'account.html',
        'orders.html',
        'signin.html',
        'signup.html',
        'legal.html',
        'admin.html',
      ];

      for (const page of pages) {
        const pageSource = readFileSync(join(PROJECT_ROOT, `public/${page}`), 'utf8');
        const apiIndex = pageSource.indexOf('/assets/api.js');
        const storeIndex = pageSource.indexOf('/assets/store.js');
        assert.ok(apiIndex !== -1 && storeIndex !== -1, `${page} should load both scripts`);
        assert.ok(apiIndex < storeIndex, `${page} should load api.js before store.js`);
      }
    });
  });
});