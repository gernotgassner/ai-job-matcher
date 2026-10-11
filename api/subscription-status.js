import { getEntitlement, isSuperuser } from './_stripe.js';
import { verifyToken } from './_auth.js';
import { apiPreamble } from './_http.js';
import { rateLimit } from './_ratelimit.js';

export default async function handler(req, res) {

  if (apiPreamble(req, res)) return;

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

  // "fresh" umgeht den Cache (nach dem Checkout nötig) - damit niemand damit
  // die Stripe-API hämmern kann, ist es auf 10 Aufrufe pro Stunde begrenzt.
  let fresh = req.query?.fresh === '1';
  if (fresh) {
    const rl = await rateLimit('fresh', decoded.email, 10, 3600);
    if (!rl.allowed) fresh = false;
  }

  try {
    const { hasActiveSubscription, subscription } = await getEntitlement(decoded.email, { fresh });

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
