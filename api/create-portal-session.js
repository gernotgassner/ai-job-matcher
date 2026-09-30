import jwt from 'jsonwebtoken';
import { getStripe, getOrCreateCustomer, APP_URL } from './_stripe.js';

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

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${APP_URL}/`
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Create Portal Session Error:', error.message);
    res.status(500).json({ error: 'Kundenportal konnte nicht geöffnet werden. Bitte später erneut versuchen.' });
  }
}
