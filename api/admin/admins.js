import { requireAdmin } from '../_admin-auth.js';
import { getSupabase } from '../_supabase.js';

const PRIMARY_ADMIN_EMAIL = 'gernot.gassner@gmail.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  const supabase = getSupabase();

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('admin_users')
        .select('id, email, status, invited_by, invited_at, confirmed_at')
        .order('invited_at', { ascending: false });
      if (error) throw error;
      // Haupt-Admin ist fest im Code hinterlegt und taucht hier mit auf,
      // auch ohne eigene Tabellenzeile.
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
      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Gültige E-Mail-Adresse angeben' });
      }
      if (email === PRIMARY_ADMIN_EMAIL) {
        return res.status(400).json({ error: 'Diese Adresse ist bereits der Haupt-Admin.' });
      }
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
      if (email === PRIMARY_ADMIN_EMAIL) {
        return res.status(400).json({ error: 'Der Haupt-Admin kann nicht entfernt werden.' });
      }
      const { error } = await supabase.from('admin_users').delete().eq('email', email);
      if (error) throw error;
      res.json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Admin management error:', error.message);
    res.status(500).json({ error: 'Admin-Verwaltung fehlgeschlagen: ' + error.message });
  }
}
