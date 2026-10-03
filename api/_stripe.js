import Stripe from 'stripe';

// Geteilte Stripe-Logik für alle API-Routen. Dateiname beginnt mit "_", damit
// Vercel daraus keine eigene Serverless-Function/Route macht.

export const PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_1UL6BiEL9FDD9zpIsFMtVyqR';
export const APP_URL = process.env.APP_URL || 'https://ai-job-matcher-sand.vercel.app';

let stripeClient = null;
export function getStripe() {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY ist in dieser Umgebung nicht gesetzt.');
    stripeClient = new Stripe(key, { apiVersion: '2025-06-30.basil' });
  }
  return stripeClient;
}

// Aktueller Abrechnungsmonat in UTC, z. B. "2026-09" - dient als Schlüssel
// für "1 kostenlose Suche pro Monat".
export function currentPeriodKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Findet den Stripe-Customer zu einer E-Mail oder legt einen neuen an.
// Die E-Mail-Adresse (aus dem verifizierten Google-Login) ist der einzige
// Schlüssel, den diese App ohne eigene Datenbank hat.
export async function getOrCreateCustomer(email) {
  const stripe = getStripe();
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data.length > 0) return existing.data[0];
  return stripe.customers.create({ email, metadata: { app: 'skillmatcher' } });
}

// Prüft Abo-Status und Kontingent für die kostenlose Suche. Die Stripe-
// Kunden-Metadaten dienen hier als einzige Persistenz (keine eigene DB):
// metadata.free_search_period speichert den Monat, in dem die kostenlose
// Suche bereits verbraucht wurde.
export async function getEntitlement(email) {
  const stripe = getStripe();
  const customer = await getOrCreateCustomer(email);

  const subs = await stripe.subscriptions.list({
    customer: customer.id,
    status: 'all',
    limit: 5
  });
  const activeSub = subs.data.find((s) => ['active', 'trialing', 'past_due'].includes(s.status));

  const period = currentPeriodKey();
  const freeSearchUsed = customer.metadata?.free_search_period === period;

  return {
    customer,
    hasActiveSubscription: !!activeSub,
    subscription: activeSub || null,
    freeSearchAvailable: !activeSub && !freeSearchUsed
  };
}

// Markiert die kostenlose Suche des laufenden Monats als verbraucht. Nur nach
// einer TATSÄCHLICH erfolgreichen Suche aufrufen, nicht bei Fehlern/Fallback -
// sonst verliert ein Nutzer sein Freikontingent durch einen Server-Fehler.
export async function consumeFreeSearch(customer) {
  const stripe = getStripe();
  await stripe.customers.update(customer.id, {
    metadata: { ...customer.metadata, free_search_period: currentPeriodKey() }
  });
}
