import jwt from 'jsonwebtoken';
import { getSupabase } from './_supabase.js';

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key-change-in-production');
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const { text, page } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Text fehlt' });
  }

  const row = { text: text.trim().slice(0, 2000), page: page || null };

  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('feedback').insert(row);
    if (error) throw error;
  } catch (e) {
    // Nicht den Nutzer scheitern lassen, nur weil die DB gerade nicht
    // erreichbar ist - zumindest in den Vercel-Logs bleibt es sichtbar.
    console.error('Feedback insert failed, logging as fallback:', e.message);
    console.log('[FEEDBACK]', JSON.stringify({ ...row, at: new Date().toISOString() }));
  }

  res.json({ ok: true });
}
