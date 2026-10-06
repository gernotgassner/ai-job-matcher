import { requireAdmin } from '../_admin-auth.js';
import { getSupabase } from '../_supabase.js';

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
      .from('issue_reports')
      .select('id, email, text, page, user_agent, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json({ items: data || [] });
  } catch (error) {
    console.error('Admin issues list error:', error.message);
    res.status(500).json({ error: 'Störungsmeldungen konnten nicht geladen werden: ' + error.message });
  }
}
