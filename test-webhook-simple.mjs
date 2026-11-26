import { startServer } from './tests/helpers/server.mjs';
import crypto from 'crypto';

const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';

async function test() {
  const server = await startServer({ 
    port: 5316, 
    databaseUrl: 'mongodb://127.0.0.1:27017/astrovetro_concurrent_test', 
    disableRateLimit: true 
  });
  console.log('Server started at:', server.base);

  const cashfreeOrderId = 'order_cf_test_' + Date.now();
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

  console.log('Sending webhook...');
  const res = await fetch(server.base + '/api/webhooks/cashfree', {
    method: 'POST',
    headers: {
      'x-webhook-signature': signature,
      'x-webhook-timestamp': timestamp,
      'content-type': 'application/json',
    },
    body: payload,
  });

  console.log('Response status:', res.status);
  console.log('Response body:', await res.json());

  await server.stop();
  console.log('Server stopped');
}

test().catch(console.error);