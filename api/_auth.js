import jwt from 'jsonwebtoken';

// Zentrale Token-Logik für alle Endpunkte. WICHTIG: bewusst KEIN Fallback-
// Secret - das Repository ist öffentlich, ein im Code stehendes Standard-
// Secret würde jedem erlauben, gültige Login-Tokens (auch für Admins) zu
// fälschen. Fehlt JWT_SECRET, ist die Authentifizierung komplett deaktiviert
// ("fail closed") und es wird laut ins Log geschrieben.
const TOKEN_TTL = '72h';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET ist nicht gesetzt oder kürzer als 32 Zeichen - Authentifizierung deaktiviert (fail closed).');
  }
  return secret;
}

export function signToken(email) {
  return jwt.sign({ email }, getSecret(), { algorithm: 'HS256', expiresIn: TOKEN_TTL });
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    // Algorithmus fest vorgeben (kein "alg: none"/Algorithmus-Wechsel möglich)
    return jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
  } catch (error) {
    if (String(error.message).startsWith('JWT_SECRET')) console.error(error.message);
    return null;
  }
}
