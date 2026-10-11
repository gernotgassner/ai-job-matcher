import crypto from 'crypto';
import { getSupabase } from './_supabase.js';

// Einfacher Fixed-Window-Zähler in Supabase (Funktion rate_limit_hit, siehe
// supabase/migration_003_rate_limit.sql). Schlüssel werden gehasht, damit in
// der Tabelle keine E-Mail-Adressen oder IPs im Klartext landen.
// Fail-open: Ist Supabase nicht erreichbar, wird NICHT blockiert (sonst
// wäre die ganze App von der DB abhängig) - der Fehler wird geloggt.
export function hashKey(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

export async function rateLimit(bucket, identity, limit, windowSeconds) {
  const key = `${bucket}:${hashKey(identity)}`;
  try {
    const { data, error } = await getSupabase().rpc('rate_limit_hit', { p_key: key, p_window_seconds: windowSeconds });
    if (error) throw error;
    return { allowed: Number(data) <= limit, count: Number(data) };
  } catch (e) {
    console.error('rateLimit failed (fail-open):', e.message);
    return { allowed: true, count: 0 };
  }
}
