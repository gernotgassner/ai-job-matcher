import jwt from 'jsonwebtoken';
import { isSuperuser } from './_stripe.js';

export function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key-change-in-production');
  } catch {
    return null;
  }
}

// Gibt die dekodierten Token-Daten zurück, wenn und nur wenn die Anfrage von
// einem autorisierten Admin kommt - sonst null. Aufrufer antwortet dann
// selbst mit 401/403, ohne irgendwelche Admin-Daten preiszugeben.
export async function requireAdmin(req) {
  const token = (req.headers.authorization || '').split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) return null;
  const admin = await isSuperuser(decoded.email);
  if (!admin) return null;
  return decoded;
}
