import { requireAdmin } from '../_admin-auth.js';
import { getSupabase } from '../_supabase.js';
import { getStripe } from '../_stripe.js';

const PRIMARY_ADMIN_EMAIL = 'gernot.gassner@gmail.com';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RECORDS = 2000; // Sicherheitsgrenze gegen ausufernde Function-Laufzeit

// Dieser eine Endpunkt bündelt bewusst alle Admin-Routen (?resource=stats|
// feedback|issues|errors|admins), statt pro Route eine eigene Datei zu sein -
// Vercel zählt jede Datei unter /api als eigene Serverless Function, und der
// Hobby-Plan erlaubt davon insgesamt nur 12 pro Deployment.

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

async function fetchAllStripe(listFn, params) {
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

async function handleStats(req, res) {
  const days = Math.min(365, Math.max(7, parseInt(req.query?.days || '90', 10) || 90));
  const sinceUnix = Math.floor((Date.now() - days * DAY_MS) / 1000);

  const customers = await fetchAllStripe((stripe, p) => stripe.customers.list(p), { created: { gte: sinceUnix } });
  const subscriptions = await fetchAllStripe((stripe, p) => stripe.subscriptions.list(p), { status: 'all', created: { gte: sinceUnix } });

  const newUserSeries = fillSeries(bucketByDay(customers.map((c) => c.created)), days);
  const resolvedSubsSeries = fillSeries(bucketByDay(subscriptions.map((s) => s.created)), days);
  const cancelledSubsSeries = fillSeries(bucketByDay(subscriptions.filter((s) => s.canceled_at).map((s) => s.canceled_at)), days);

  const allCustomers = await fetchAllStripe((stripe, p) => stripe.customers.list(p), {});
  const allSubs = await fetchAllStripe((stripe, p) => stripe.subscriptions.list(p), { status: 'all' });

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
}

async function handleFeedback(req, res) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('feedback')
    .select('id, email, text, page, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  res.json({ items: data || [] });
}

async function handleIssues(req, res) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('issue_reports')
    .select('id, email, text, page, user_agent, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  res.json({ items: data || [] });
}

async function handleErrors(req, res) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('error_logs')
    .select('id, error_type, message, created_at')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw error;
  res.json({ items: data || [] });
}

async function handleAdmins(req, res, admin) {
  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, email, status, invited_by, invited_at, confirmed_at')
      .order('invited_at', { ascending: false });
    if (error) throw error;
    res.json({
      items: [
        { id: 'primary', email: PRIMARY_ADMIN_EMAIL, status: 'confirmed', invited_by: '(fest hinterlegt)', invited_at: null, confirmed_at: null, primary: true },
        ...(data || [])
      ]
    });
    return;
  }

  if (req.method === 'POST') {
    const email = (req.body?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Gültige E-Mail-Adresse angeben' });
    if (email === PRIMARY_ADMIN_EMAIL) return res.status(400).json({ error: 'Diese Adresse ist bereits der Haupt-Admin.' });

    const { error } = await supabase
      .from('admin_users')
      .upsert({ email, status: 'pending', invited_by: admin.email, invited_at: new Date().toISOString(), confirmed_at: null }, { onConflict: 'email' });
    if (error) throw error;
    res.json({ ok: true, message: `Einladung gespeichert. Bestätigt sich automatisch, sobald sich ${email} per Google einloggt.` });
    return;
  }

  if (req.method === 'DELETE') {
    const email = (req.query?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'E-Mail-Adresse fehlt' });
    if (email === PRIMARY_ADMIN_EMAIL) return res.status(400).json({ error: 'Der Haupt-Admin kann nicht entfernt werden.' });

    const { error } = await supabase.from('admin_users').delete().eq('email', email);
    if (error) throw error;
    res.json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  const resource = req.query?.resource;

  try {
    if (resource === 'stats') return await handleStats(req, res);
    if (resource === 'feedback') return await handleFeedback(req, res);
    if (resource === 'issues') return await handleIssues(req, res);
    if (resource === 'errors') return await handleErrors(req, res);
    if (resource === 'admins') return await handleAdmins(req, res, admin);
    res.status(400).json({ error: 'Unbekannte Admin-Ressource' });
  } catch (error) {
    console.error(`Admin endpoint error (resource=${resource}):`, error.message);
    res.status(500).json({ error: 'Admin-Anfrage fehlgeschlagen: ' + error.message });
  }
}
