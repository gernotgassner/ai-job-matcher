import jwt from 'jsonwebtoken';
import { getEntitlement, isSuperuser } from './_stripe.js';

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key-change-in-production');
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { hasActiveSubscription, subscription } = await getEntitlement(decoded.email);

    res.json({
      subscribed: hasActiveSubscription,
      cancelAtPeriodEnd: subscription?.cancel_at_period_end || false,
      currentPeriodEnd: subscription?.items?.data?.[0]?.current_period_end || subscription?.current_period_end || null,
      status: subscription?.status || null
    });
  } catch (error) {
    const detail = error.raw?.message || error.message;
    console.error('Subscription Status Error:', detail);
    const msg = isSuperuser(decoded.email) ? `Abo-Status konnte nicht geladen werden: ${detail}` : 'Abo-Status konnte nicht geladen werden.';
    res.status(500).json({ error: msg });
  }
}
