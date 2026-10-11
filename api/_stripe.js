import Stripe from 'stripe';
import { getSupabase } from './_supabase.js';
import { getCached, setCached } from './_cache.js';

// Fest hinterlegter Haupt-Admin - braucht keinen Eintrag in admin_users und
// funktioniert auch, falls Supabase mal nicht erreichbar ist.
const PRIMARY_ADMIN_EMAIL = 'gernot.gassner@gmail.com';

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
const ENTITLEMENT_TTL_MS = 60 * 1000;

// Abo-Status mit kurzem Cache (60 s): Ohne ihn würde jede Suche und jeder
// Seitenaufruf zwei Stripe-API-Aufrufe auslösen - bei vielen gleichzeitigen
// Nutzern würde man schnell ans Stripe-Rate-Limit stossen. Direkt nach einem
// Checkout wird mit { fresh: true } am Cache vorbei neu geladen.
export async function getEntitlement(email, { fresh = false } = {}) {
  const cacheKey = `ent:${email}`;
  if (!fresh) {
    const hit = getCached(cacheKey);
    if (hit) return hit;
  }

  const stripe = getStripe();
  const customer = await getOrCreateCustomer(email);

  const subs = await stripe.subscriptions.list({
    customer: customer.id,
    status: 'all',
    limit: 5
  });
  const activeSub = subs.data.find((s) => ['active', 'trialing', 'past_due'].includes(s.status));

  const result = {
    customer,
    hasActiveSubscription: !!activeSub,
    subscription: activeSub || null
  };
  setCached(cacheKey, result, ENTITLEMENT_TTL_MS);
  return result;
}

// Zeigt technische Fehlerdetails (Statuscodes, Rohantworten Dritter) und den
// Admin-Bereich nur Superusern. Das sind: der fest hinterlegte Haupt-Admin,
// optional weitere Adressen in der Env-Var SUPERUSER_EMAILS (kommagetrennt -
// Fallback, falls Supabase noch nicht eingerichtet ist), sowie bestätigte
// Einträge in admin_users (status='confirmed', bestätigt durch Google-Login
// der eingeladenen Person - siehe api/google-login.js).
export async function isSuperuser(email) {
  if (!email) return false;
  const lower = email.toLowerCase();

  if (lower === PRIMARY_ADMIN_EMAIL) return true;

  const envList = (process.env.SUPERUSER_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (envList.includes(lower)) return true;

  // Kurzer Cache (60 s) für die DB-Prüfung; ein entzogener Admin-Zugriff
  // wirkt dadurch spätestens nach einer Minute.
  const cacheKey = `adm:${lower}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('admin_users')
      .select('status')
      .eq('email', lower)
      .eq('status', 'confirmed')
      .maybeSingle();
    if (error) throw error;
    setCached(cacheKey, !!data, 60 * 1000);
    return !!data;
  } catch (e) {
    console.error('isSuperuser: admin_users check failed (treating as non-admin):', e.message);
    return false;
  }
}
