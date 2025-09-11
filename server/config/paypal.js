// config/paypal.js
const checkoutNodeJssdk = require('@paypal/checkout-server-sdk');

function environment() {
  const clientId = process.env.PAYPAL_CLIENT_KEY;
  const clientSecret = process.env.PAYPAL_SECRET_KEY;

  if (!clientId || !clientSecret) {
    console.error('Missing PayPal credentials: expect PAYPAL_CLIENT_KEY and PAYPAL_SECRET_KEY in environment');
    throw new Error('Missing PayPal credentials');
  }

  return new checkoutNodeJssdk.core.SandboxEnvironment(clientId, clientSecret);
}

function client() {
  return new checkoutNodeJssdk.core.PayPalHttpClient(environment());
}

module.exports = { client };
