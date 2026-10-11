import { getSupabase } from './_supabase.js';
import { verifyToken } from './_auth.js';
import { apiPreamble } from './_http.js';
import { rateLimit } from './_ratelimit.js';

export default async function handler(req, res) {

  if (apiPreamble(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const { text, page } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Text fehlt' });
  }

  // Schutz vor Spam/Flooding der Tabelle (5 Meldungen pro Stunde und Nutzer)
  const rl = await rateLimit('issue', decoded.email, 5, 3600);
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Zu viele Meldungen in kurzer Zeit. Bitte versuche es später erneut.' });
  }

  const row = {
    email: decoded.email,
    text: text.trim().slice(0, 2000),
    page: typeof page === 'string' ? page.slice(0, 200) : null,
    user_agent: req.headers['user-agent'] || null
  };

  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('issue_reports').insert(row);
    if (error) throw error;
  } catch (e) {
    console.error('Issue report insert failed, logging as fallback:', e.message);
    console.log('[ISSUE_REPORT]', JSON.stringify({ ...row, at: new Date().toISOString() }));
  }

  res.json({ ok: true });
}
