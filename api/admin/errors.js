import { requireAdmin } from '../_admin-auth.js';
import { getSupabase } from '../_supabase.js';

// Liefert bewusst NUR error_type, message, created_at - die Tabelle hat
// ohnehin keine Nutzer-/E-Mail-Spalte (siehe supabase/schema.sql), damit
// auch im Admin-Bereich keine Zuordnung zu einer Person möglich ist.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('error_logs')
      .select('id, error_type, message, created_at')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw error;
    res.json({ items: data || [] });
  } catch (error) {
    console.error('Admin error log list error:', error.message);
    res.status(500).json({ error: 'Fehlerprotokoll konnte nicht geladen werden: ' + error.message });
  }
}
