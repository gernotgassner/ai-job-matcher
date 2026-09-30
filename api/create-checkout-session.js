import jwt from 'jsonwebtoken';
import { getStripe, getOrCreateCustomer, PRICE_ID, APP_URL } from './_stripe.js';

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key-change-in-production');
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const stripe = getStripe();
    const customer = await getOrCreateCustomer(decoded.email);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      allow_promotion_codes: true,
      locale: 'de',
      success_url: `${APP_URL}/?checkout=success`,
      cancel_url: `${APP_URL}/?checkout=cancel`
    });

    res.json({ url: session.url });
  } catch (error) {
    const detail = error.raw?.message || error.message;
    console.error('Create Checkout Session Error:', detail);
    res.status(500).json({ error: `Checkout konnte nicht gestartet werden: ${detail}` });
  }
}
