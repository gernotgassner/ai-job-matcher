import jwt from 'jsonwebtoken';

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key-change-in-production');
  } catch {
    return null;
  }
}

// TODO sobald SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY gesetzt sind: Meldung in
// eine "issue_reports"-Tabelle schreiben statt nur zu loggen, damit sie im
// Admin-Bereich (Störungsmeldungen) ausgewertet werden kann.
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

  console.log('[ISSUE_REPORT]', JSON.stringify({
    email: decoded.email,
    text: text.trim().slice(0, 2000),
    page: page || null,
    userAgent: req.headers['user-agent'] || null,
    at: new Date().toISOString()
  }));

  res.json({ ok: true });
}
