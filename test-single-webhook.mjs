import { startServer } from './tests/helpers/server.mjs';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Order } from './src/models/Order.js';
import { PAYMENT_STATUS, ORDER_STATUS, PAYMENT_METHOD } from './src/models/Order.js';
import { Product } from './src/models/Product.js';

const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';

async function test() {
  // Connect mongoose for direct model usage
  await mongoose.connect('mongodb://127.0.0.1:27017/astrovetro_concurrent_test', { 
    serverSelectionTimeoutMS: 5000, 
    bufferCommands: false 
  });
  console.log('Mongoose connected');

  // Set test Cashfree secret
  process.env.CASHFREE_CLIENT_SECRET = CASH_FREE_CLIENT_SECRET;
  process.env.CASHFREE_CLIENT_ID = 'test_client_id';
  process.env.CASHFREE_ENV = 'sandbox';

  const server = await startServer({ 
    port: 5316, 
    databaseUrl: 'mongodb://127.0.0.1:27017/astrovetro_concurrent_test', 
    disableRateLimit: true 
  });
  console.log('Server started at:', server.base);

  // Create admin user
  const { createAdmin } = await import('./tests/helpers/server.mjs');
  await createAdmin({ databaseUrl: 'mongodb://127.0.0.1:27017/astrovetro_concurrent_test', email: 'admin@test.com', password: 'password123' });

  // Create product
  const product = new Product({
    name: 'Test Product',
    slug: 'test-product-' + Date.now(),
    category: 'pendant',
    price: 1000,
    costPrice: 500,
    status: 'active',
    productType: 'jewellery',
    shortDescription: 'Test product',
  });
  await product.save();
  console.log('Product created:', product._id);

  // Create order
  const orderCashfreeOrderId = 'order_cf_test_' + Date.now();
  const order = new Order({
    orderNumber: 'AV-TEST-' + Date.now(),
    user: new mongoose.Types.ObjectId(),
    customerEmail: 'test@test.com',
    items: [{
      product: (await Product.findOne())._id,
      name: 'Test Product',
      slug: 'test-product',
      image: null,
      unitPrice: 1000,
      quantity: 1,
      lineTotal: 1000,
    }],
    subtotal: 1000,
    discount: 0,
    shipping: 99,
    tax: 0,
    total: 1099,
    currency: 'INR',
    shippingAddress: {
      name: 'Test Customer',
      phone: '+91 90000 00000',
      line1: '123 Test Street',
      city: 'Test City',
      state: 'Test State',
      pincode: '110001',
      country: 'India',
    },
    status: 'pending',
    paymentStatus: 'pending',
    paymentMethod: 'card',
    payment: {
      provider: 'cashfree',
      providerOrderId: orderCashfreeOrderId,
      providerPaymentId: null,
      signature: null,
      paidAt: null,
      refundedAt: null,
      amount: 109900,
    },
    inventoryCommitted: false,
    idempotencyKey: 'idem-' + Date.now(),
  });
  await order.save();
  console.log('Order created:', order._id, 'providerOrderId:', order.payment.providerOrderId);

  const testCashfreeOrderId = order.payment.providerOrderId;
  const payload = JSON.stringify({
    type: 'PAYMENT_SUCCESS',
    data: {
      payment: {
        order_id: testCashfreeOrderId,
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
  const res = await fetch('http://127.0.0.1:5316/api/webhooks/cashfree', {
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

  // Check order state
  const updatedOrder = await Order.findById(order._id);
  console.log('Order after webhook:', {
    paymentStatus: updatedOrder.paymentStatus,
    status: updatedOrder.status,
    inventoryCommitted: updatedOrder.inventoryCommitted,
    payment: updatedOrder.payment,
  });

  await mongoose.disconnect();
  console.log('Test completed');
}

test().catch(console.error);