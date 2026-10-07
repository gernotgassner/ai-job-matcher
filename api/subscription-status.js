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

  // Admin-Status unabhängig vom Stripe-Aufruf ermitteln, damit ein Stripe-
  // Problem (z. B. vorübergehend nicht erreichbar) niemals den Admin-Zugriff
  // verdeckt - vorher führte ein Fehler in getEntitlement() dazu, dass die
  // ganze Antwort fehlschlug, bevor isAdmin überhaupt berechnet wurde.
  let admin = false;
  try {
    admin = await isSuperuser(decoded.email);
  } catch (error) {
    console.error('isSuperuser check failed:', error.message);
  }

  try {
    const { hasActiveSubscription, subscription } = await getEntitlement(decoded.email);

    res.json({
      subscribed: hasActiveSubscription,
      cancelAtPeriodEnd: subscription?.cancel_at_period_end || false,
      currentPeriodEnd: subscription?.items?.data?.[0]?.current_period_end || subscription?.current_period_end || null,
      status: subscription?.status || null,
      isAdmin: admin
    });
  } catch (error) {
    const detail = error.raw?.message || error.message;
    console.error('Subscription Status Error:', detail);
    const msg = admin ? `Abo-Status konnte nicht geladen werden: ${detail}` : 'Abo-Status konnte nicht geladen werden.';
    // isAdmin auch im Fehlerfall mitgeben, damit admin.html trotzdem
    // funktioniert, selbst wenn der Stripe-Teil gerade klemmt.
    res.status(500).json({ error: msg, isAdmin: admin });
  }
}
