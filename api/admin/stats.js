import { requireAdmin } from '../_admin-auth.js';
import { getStripe } from '../_stripe.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RECORDS = 2000; // Sicherheitsgrenze gegen ausufernde Function-Laufzeit

function dayKey(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function bucketByDay(timestamps) {
  const buckets = new Map();
  for (const ts of timestamps) {
    const key = dayKey(ts);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return buckets;
}

// Füllt fehlende Tage im gewählten Zeitraum mit 0 auf, damit das Diagramm
// keine Lücken hat.
function fillSeries(buckets, days) {
  const series = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, count: buckets.get(key) || 0 });
  }
  return series;
}

async function fetchAll(listFn, params) {
  const stripe = getStripe();
  const items = [];
  let startingAfter;
  while (items.length < MAX_RECORDS) {
    const page = await listFn(stripe, { ...params, limit: 100, starting_after: startingAfter });
    items.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return items;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  const days = Math.min(365, Math.max(7, parseInt(req.query?.days || '90', 10) || 90));
  const sinceUnix = Math.floor((Date.now() - days * DAY_MS) / 1000);

  try {
    // Nutzerwachstum = Stripe-Kunden über Zeit (jeder Login/jede Suche legt
    // bei Bedarf einen Stripe-Customer an - siehe _stripe.js getOrCreateCustomer).
    const customers = await fetchAll(
      (stripe, p) => stripe.customers.list(p),
      { created: { gte: sinceUnix } }
    );

    const subscriptions = await fetchAll(
      (stripe, p) => stripe.subscriptions.list(p),
      { status: 'all', created: { gte: sinceUnix } }
    );

    const newUserSeries = fillSeries(bucketByDay(customers.map((c) => c.created)), days);
    const resolvedSubsSeries = fillSeries(bucketByDay(subscriptions.map((s) => s.created)), days);
    const cancelledSubsSeries = fillSeries(
      bucketByDay(subscriptions.filter((s) => s.canceled_at).map((s) => s.canceled_at)),
      days
    );

    // Gesamtzahlen (alle Kunden/Abos, nicht nur im gewählten Zeitraum).
    const allCustomers = await fetchAll((stripe, p) => stripe.customers.list(p), {});
    const allSubs = await fetchAll((stripe, p) => stripe.subscriptions.list(p), { status: 'all' });

    res.json({
      days,
      totals: {
        users: allCustomers.length,
        activeSubscriptions: allSubs.filter((s) => ['active', 'trialing', 'past_due'].includes(s.status)).length,
        cancelledSubscriptions: allSubs.filter((s) => s.canceled_at).length
      },
      newUserSeries,
      resolvedSubsSeries,
      cancelledSubsSeries
    });
  } catch (error) {
    console.error('Admin stats error:', error.message);
    res.status(500).json({ error: 'Statistiken konnten nicht geladen werden: ' + error.message });
  }
}
