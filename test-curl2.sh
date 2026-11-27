#!/bin/bash

cd /Users/surajkumar/Desktop/Astrovetro-production

PORT=5316 CASHFREE_CLIENT_SECRET=test_client_secret_12345 RAZORPAY_KEY_SECRET=test_key_secret_12345 RAZORPAY_WEBHOOK_SECRET=test_webhook_secret_12345 CASHFREE_WEBHOOK_SECRET=test_webhook_secret_12345 NODE_ENV=test node server.js &
SERVER_PID=$!

sleep 3

PAYLOAD='{"type":"PAYMENT_SUCCESS","data":{"payment":{"order_id":"order_cf_test_123","payment_id":"pay_cf_test_456","payment_amount":1099,"payment_currency":"INR","payment_status":"SUCCESS","payment_time":"2024-01-15T10:30:00Z"}}'
TIMESTAMP=1705315800
SIGNATURE=$(echo -n "${TIMESTAMP}${PAYLOAD}" | openssl dgst -sha256 -hmac 'test_client_secret_12345' -binary | base64)

curl -X POST http://127.0.0.1:5316/api/webhooks/cashfree \
  -H "x-webhook-signature: ${SIGNATURE}" \
  -H "x-webhook-timestamp: ${TIMESTAMP}" \
  -H "content-type: application/json" \
  -d "${PAYLOAD}"

kill $SERVER_PID