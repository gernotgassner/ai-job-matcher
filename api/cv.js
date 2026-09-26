import jwt from 'jsonwebtoken';

const users = new Map();

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key-change-in-production');
  } catch (error) {
    return null;
  }
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { email, cvText } = req.body;

  if (!email || !cvText) {
    return res.status(400).json({ error: 'Missing email or cvText' });
  }

  if (!users.has(email)) {
    users.set(email, { cvText: '', favorites: {}, lastScan: [] });
  }

  users.get(email).cvText = cvText;

  res.json({ ok: true, message: 'CV saved successfully' });
}
