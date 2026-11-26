import { env } from './src/config/env.js';
import { Cashfree, CFEnvironment } from 'cashfree-pg';

console.log('Environment:', env.cashfree.env);
console.log('Client ID:', env.cashfree.clientId ? '[SET]' : '[NOT SET]');
console.log('Client Secret:', env.cashfree.clientSecret ? '[SET]' : '[NOT SET]');
console.log('Webhook Secret:', env.cashfree.webhookSecret ? '[SET]' : '[NOT SET]');
console.log('Environment:', env.cashfree.env);
console.log('API Version:', env.cashfree.apiVersion);

const environment = env.cashfree.env === 'production' 
  ? CFEnvironment.PRODUCTION 
  : CFEnvironment.SANDBOX;
console.log('Environment enum:', environment);

const client = new Cashfree({
  environment,
  clientId: env.cashfree.clientId,
  clientSecret: env.cashfree.clientSecret,
  apiVersion: env.cashfree.apiVersion || '2026-01-01'
});
console.log('Client initialized successfully');