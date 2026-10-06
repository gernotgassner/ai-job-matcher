import { createClient } from '@supabase/supabase-js';

// Dateiname beginnt mit "_", damit Vercel daraus keine eigene Route macht.
// Nutzt ausschliesslich den Service-Role-Key (server-seitig, umgeht RLS) -
// darf niemals an den Browser gelangen.

let client = null;

export function getSupabase() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY sind in dieser Umgebung nicht gesetzt.');
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

// Best-effort Fehlerprotokoll OHNE Nutzerbezug (bewusst keine E-Mail-Spalte
// in error_logs - siehe supabase/schema.sql). Wirft nie, damit ein Logging-
// Problem nie den eigentlichen Request zum Scheitern bringt.
export async function logError(errorType, message) {
  try {
    const supabase = getSupabase();
    await supabase.from('error_logs').insert({ error_type: errorType, message: String(message).slice(0, 2000) });
  } catch (e) {
    console.error('logError failed (non-fatal):', e.message);
  }
}
