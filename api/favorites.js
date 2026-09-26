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

  const { email, jobId } = req.body;

  if (!email || !jobId) {
    return res.status(400).json({ error: 'Missing email or jobId' });
  }

  if (!users.has(email)) {
    users.set(email, { cvText: '', favorites: {}, lastScan: [] });
  }

  const user = users.get(email);

  if (user.favorites[jobId]) {
    delete user.favorites[jobId];
  } else {
    const job = user.lastScan?.find(j => j.id === jobId);
    if (job) {
      user.favorites[jobId] = job;
    }
  }

  res.json({ favorites: user.favorites });
}
