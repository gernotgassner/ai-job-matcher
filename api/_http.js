// Gemeinsamer Anfang aller API-Handler. Es werden bewusst KEINE CORS-Header
// gesetzt: Frontend und API laufen auf derselben Origin, ein "Allow-Origin: *"
// würde nur fremden Webseiten erlauben, die API aus dem Browser anzusprechen.
export function apiPreamble(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function clientIp(req) {
  const h = req.headers || {};
  const raw = h['x-vercel-forwarded-for'] || h['x-real-ip'] || (h['x-forwarded-for'] || '').split(',')[0] || 'unknown';
  return String(raw).trim().slice(0, 64);
}
