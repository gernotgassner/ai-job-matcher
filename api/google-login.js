import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { getSupabase } from './_supabase.js';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token missing' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const email = payload.email;

    if (!payload.email_verified) {
      return res.status(401).json({ error: 'E-Mail-Adresse ist bei Google nicht verifiziert.' });
    }

    await confirmPendingAdminInvite(email);

    const jwtToken = jwt.sign(
      { email },
      process.env.JWT_SECRET || 'dev-secret-key-change-in-production',
      { expiresIn: '7d' }
    );

    res.json({ token: jwtToken, user: { email } });
  } catch (error) {
    console.error('Google Login Error:', error.message);
    if (!process.env.GOOGLE_CLIENT_ID) {
      console.error('GOOGLE_CLIENT_ID is not set in this deployment\'s environment - token audience check will always fail.');
    }
    res.status(401).json({ error: 'Authentication failed' });
  }
}
