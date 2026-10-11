import { getStripe, getOrCreateCustomer, APP_URL, isSuperuser } from './_stripe.js';
import { verifyToken } from './_auth.js';
import { apiPreamble } from './_http.js';

export default async function handler(req, res) {

  if (apiPreamble(req, res)) return;
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
    const detail = error.raw?.message || error.message;
    console.error('Create Portal Session Error:', detail);
    const msg = (await isSuperuser(decoded.email)) ? `Kundenportal konnte nicht geöffnet werden: ${detail}` : 'Kundenportal konnte nicht geöffnet werden. Bitte später erneut versuchen.';
    res.status(500).json({ error: msg });
  }
}
