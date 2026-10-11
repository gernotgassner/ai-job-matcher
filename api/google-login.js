import { OAuth2Client } from 'google-auth-library';
import { getSupabase } from './_supabase.js';
import { signToken } from './_auth.js';
import { apiPreamble, clientIp } from './_http.js';
import { rateLimit } from './_ratelimit.js';

const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Login-Versuche pro IP (schützt vor Token-Stuffing und unnötiger Last)
const LOGIN_LIMIT = 30;
const LOGIN_WINDOW_SECONDS = 600;

// Bestätigt eine ausstehende Admin-Einladung, sobald sich genau diese
// E-Mail-Adresse erfolgreich per Google-Login anmeldet - das ist der
// geforderte Nachweis, dass die Person wirklich Zugriff auf dieses
// Google-Konto hat. Wirft nie (Login darf daran nicht scheitern).
async function confirmPendingAdminInvite(email) {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('admin_users')
      .select('status')
      .eq('email', email.toLowerCase())
      .eq('status', 'pending')
      .maybeSingle();
    if (data) {
      await supabase
        .from('admin_users')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
        .eq('email', email.toLowerCase());
    }
  } catch (e) {
    console.error('confirmPendingAdminInvite failed (non-fatal):', e.message);
  }
}

export default async function handler(req, res) {
  if (apiPreamble(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.body || {};

  if (!token || typeof token !== 'string' || token.length > 4096) {
    return res.status(400).json({ error: 'Token missing' });
  }

  // Ohne konfigurierte Client-ID würde die Bibliothek die Audience-Prüfung
  // überspringen - dann würde jedes von Google für IRGENDEINE App
  // ausgestellte ID-Token akzeptiert (Token-Replay). Daher: fail closed.
  if (!GOOGLE_CLIENT_ID) {
    console.error('GOOGLE_CLIENT_ID is not set - refusing all logins (audience check would be skipped).');
    return res.status(500).json({ error: 'Login ist derzeit nicht verfügbar.' });
  }

  const rl = await rateLimit('login-ip', clientIp(req), LOGIN_LIMIT, LOGIN_WINDOW_SECONDS);
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Zu viele Anmeldeversuche. Bitte warte ein paar Minuten.' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const email = payload.email;

    if (!payload.email_verified) {
      return res.status(401).json({ error: 'E-Mail-Adresse ist bei Google nicht verifiziert.' });
    }

    await confirmPendingAdminInvite(email);

    res.json({ token: signToken(email), user: { email } });
  } catch (error) {
    console.error('Google Login Error:', error.message);
    res.status(401).json({ error: 'Authentication failed' });
  }
}
