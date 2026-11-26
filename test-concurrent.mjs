import { startServer } from './tests/helpers/server.mjs';
import crypto from 'crypto';
import mongoose from 'mongoose';

const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';

async function test() {
  // Connect mongoose for direct model usage
  await mongoose.connect('mongodb://127.0.0.1:27017/astrovetro_concurrent_test', { 
    serverSelectionTimeoutMS: 5000, 
    bufferCommands: false 
  });
  console.log('Mongoose connected');

  const server = await startServer({ 
    port: 5316, 
    databaseUrl: 'mongodb://127.0.0.1:27017/astrovetro_concurrent_test', 
    disableRateLimit: true 
  });
  console.log('Server started at:', server.base);

  const cashfreeOrderId = 'order_cf_test_123';
  const payload = JSON.stringify({
    type: 'PAYMENT_SUCCESS',
    data: {
      payment: {
        order_id: cashfreeOrderId,
        payment_id: 'pay_cf_test_456',
        payment_amount: 1099,
        payment_currency: 'INR',
        payment_status: 'SUCCESS',
        payment_time: '2024-01-15T10:30:00Z'
      }
    }
  });
  const timestamp = '1705315800';
  const signature = crypto.createHmac('sha256', 'test_client_secret_12345').update(timestamp + payload).digest('base64');

  console.log('Sending 2 concurrent webhooks...');
  const [res1, res2] = await Promise.all([
    fetch(server.base + '/api/webhooks/cashfree', {
      method: 'POST',
      headers: {
        'x-webhook-signature': signature,
        'x-webhook-timestamp': timestamp,
        'content-type': 'application/json',
      },
      body: payload,
    }),
    fetch(server.base + '/api/webhooks/cashfree', {
      method: 'POST',
      headers: {
        'x-webhook-signature': signature,
        'x-webhook-timestamp': timestamp,
        'content-type': 'application/json',
      },
      body: payload,
    })
  ]);

  console.log('Response 1 status:', res1.status, await res1.json());
  console.log('Response 2 status:', res2.status, await res2.json());

  await server.stop();
  await mongoose.disconnect();
  console.log('Test completed');
}

test().catch(console.error);