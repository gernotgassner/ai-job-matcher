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

// Findet den Stripe-Customer zu einer E-Mail oder legt einen neuen an.
// Die E-Mail-Adresse (aus dem verifizierten Google-Login) ist der einzige
// Schlüssel, den diese App ohne eigene Datenbank hat.
export async function getOrCreateCustomer(email) {
  const stripe = getStripe();
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data.length > 0) return existing.data[0];
  return stripe.customers.create({ email, metadata: { app: 'skillmatcher' } });
}

// Abo-Status. Seit der Produktentscheidung "Suche immer möglich, Abo steuert
// nur noch die Ergebnistiefe" gibt es kein Freikontingent/keine Monats-
// Zählung mehr - entsprechend auch keine Metadaten-Schreibvorgänge mehr nötig.
export async function getEntitlement(email) {
  const stripe = getStripe();
  const customer = await getOrCreateCustomer(email);

  const subs = await stripe.subscriptions.list({
    customer: customer.id,
    status: 'all',
    limit: 5
  });
  const activeSub = subs.data.find((s) => ['active', 'trialing', 'past_due'].includes(s.status));

  return {
    customer,
    hasActiveSubscription: !!activeSub,
    subscription: activeSub || null
  };
}

// Zeigt technische Fehlerdetails (Statuscodes, Rohantworten Dritter) nur
// Superusern an - reguläre Nutzer sehen ausschliesslich generische,
// freundliche Meldungen. Liste kommt aus der Env-Var SUPERUSER_EMAILS
// (kommagetrennt, z. B. "admin@example.com,dev@example.com").
export function isSuperuser(email) {
  const list = (process.env.SUPERUSER_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return !!email && list.includes(email.toLowerCase());
}
