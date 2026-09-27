import axios from 'axios';
import jwt from 'jsonwebtoken';

// DACH-Region: einzig erlaubte Länder für die Jobsuche
const ALLOWED_COUNTRIES = new Set(['Germany', 'Austria', 'Switzerland']);

// JSearch /search-v2 erwartet einen ISO-3166-1-alpha-2-Ländercode, keinen
// ausgeschriebenen Ländernamen.
const COUNTRY_CODES = { Germany: 'de', Austria: 'at', Switzerland: 'ch' };

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key-change-in-production');
  } catch (error) {
    return null;
  }
}

function extractKeywords(text = '') {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = normalized.split(' ');
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'have',
    'will', 'over', 'about', 'their', 'them', 'what', 'when', 'where', 'there',
    'years', 'year', 'work', 'team', 'using', 'skills', 'also', 'more', 'most',
    'such', 'being', 'role', 'jobs', 'job', 'developer', 'engineer', 'product', 'design'
  ]);
  return words.filter(w => w.length > 2 && !stopWords.has(w));
}

// Einfacher Keyword-basierter Fallback-Score, falls keine KI-Bewertung verfügbar ist
function calculateMatchScore(cvText, jobText) {
  const cvKeywords = new Set(extractKeywords(cvText));
  const jobKeywords = new Set(extractKeywords(jobText));

  if (jobKeywords.size === 0) return 0;

  const matches = [...jobKeywords].filter(kw => cvKeywords.has(kw)).length;
  const baseScore = (matches / jobKeywords.size) * 100;
  const bonus = [...cvKeywords].filter(kw => kw.length > 5 && jobKeywords.has(kw)).length * 2;

  return Math.min(100, Math.round(baseScore + bonus));
}

// Lässt die KI jeden Job anhand von CV + Wunschberuf + Kurzbeschrieb bewerten
// und eine kurze, deutschsprachige Begründung/Zusammenfassung erstellen.
async function scoreJobsWithAI({ cvText, role, roleDescription, jobs }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || jobs.length === 0) return null;

  const jobList = jobs.map((job, i) => ({
    index: i,
    title: job.title,
    company: job.company,
    location: job.location,
    description: (job.description || '').slice(0, 500)
  }));

  const prompt = `Du bist ein Karriereberater. Bewerte, wie gut jede der folgenden Stellenanzeigen zum Kandidatenprofil passt.

LEBENSLAUF (Auszug):
${cvText.slice(0, 6000)}

WUNSCHBERUF: ${role}
KURZBESCHRIEB DES KANDIDATEN ZUM WUNSCHBERUF: ${roleDescription || '(keine Angabe)'}

STELLENANZEIGEN (JSON):
${JSON.stringify(jobList)}

Antworte AUSSCHLIESSLICH mit einem JSON-Array (kein Fließtext, keine Markdown-Codeblöcke). Ein Objekt pro Stellenanzeige, in der Reihenfolge des "index"-Feldes:
[{"index": 0, "match": 0-100, "summary": "1-2 kurze Sätze auf Deutsch, warum diese Stelle passt oder nicht passt, unter Berücksichtigung von Lebenslauf, Wunschberuf und Kurzbeschrieb"}]`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        timeout: 25000
      }
    );

    const textBlock = (response.data.content || []).find(b => b.type === 'text');
    if (!textBlock) return null;

    const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const byIndex = new Map(parsed.map(r => [r.index, r]));
    return byIndex;
  } catch (error) {
    console.error('AI scoring error:', error.message);
    return null;
  }
}

export default async function handler(req, res) {
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

  // cvText kommt direkt vom Client mit (aus localStorage), statt serverseitig
  // über ein per-Request-isoliertes In-Memory-Objekt nachgeschlagen zu werden.
  // Vercel-Serverless-Functions teilen sich keinen Prozessspeicher zwischen
  // unterschiedlichen API-Routen/Invocations - daher darf der Suchendpunkt
  // nicht von zuvor in einer anderen Funktion gespeicherten Daten abhängen.
  const { cvText, role, roleDescription, country } = req.body;

  if (!cvText || !cvText.trim()) {
    return res.status(400).json({ error: 'Kein Lebenslauf vorhanden' });
  }

  if (!role || !role.trim()) {
    return res.status(400).json({ error: 'Wunschberuf fehlt' });
  }

  if (!country || !ALLOWED_COUNTRIES.has(country)) {
    return res.status(400).json({ error: 'Ungültiges Land. Erlaubt: Deutschland, Österreich, Schweiz' });
  }

  const rapidApiKey = (process.env.JSEARCH_API_KEY || '').trim();

  if (!rapidApiKey) {
    console.error('JSEARCH_API_KEY is not set in this deployment\'s environment.');
  } else {
    // Sicheres Diagnose-Log (kein vollständiges Secret): Länge + maskierter
    // Anfang/Ende, um Whitespace-/Falscher-Key-/Env-Scope-Probleme zu erkennen,
    // ohne den echten Key preiszugeben.
    const masked = rapidApiKey.length > 8
      ? `${rapidApiKey.slice(0, 4)}...${rapidApiKey.slice(-4)}`
      : '(zu kurz)';
    console.log(`JSEARCH_API_KEY present: length=${rapidApiKey.length}, masked=${masked}`);
  }

  try {
    // RapidAPI hat den alten "/search"-Endpunkt auf "/search-v2" migriert
    // (siehe Fehlerhinweis von RapidAPI selbst: "Endpoint '/search' does not
    // exist", Beispiel-curl zeigt "/search-v2"). v2 nutzt außerdem einen
    // ISO-3166-alpha-2 "country"-Parameter statt des Ländernamens im
    // Freitext, und kein "page"/"sort" mehr (Paginierung über "cursor").
    const query = roleDescription
      ? `${role} ${roleDescription}`.slice(0, 200)
      : `${role} jobs`;

    const response = await axios.get('https://jsearch.p.rapidapi.com/search-v2', {
      params: {
        query,
        num_pages: '1',
        date_posted: 'anytime',
        country: COUNTRY_CODES[country] || 'de'
      },
      headers: {
        'x-rapidapi-key': rapidApiKey,
        'x-rapidapi-host': 'jsearch.p.rapidapi.com'
      },
      timeout: 10000
    });

    let jobs = (response.data.data || []).slice(0, 12).map((job, index) => {
      const combinedText = `${job.job_title || ''} ${job.job_description || ''} ${job.employer_name || ''}`;
      const match = calculateMatchScore(cvText, combinedText);

      return {
        id: job.job_id || `job-${index}-${Date.now()}`,
        title: job.job_title || 'Position',
        company: job.employer_name || 'Company',
        location: `${job.job_city || 'Remote'}, ${job.job_country || country}`,
        country: job.job_country || country,
        url: job.job_apply_link || job.job_url || '#',
        description: (job.job_description || '').replace(/<[^>]*>/g, '').slice(0, 250),
        match,
        aiSummary: null
      };
    });

    // KI-Bewertung: überschreibt den Keyword-Score und liefert eine
    // nachvollziehbare Zusammenfassung pro Job. Fällt bei Fehlern/fehlendem
    // API-Key automatisch auf den einfachen Keyword-Score zurück.
    const aiResults = await scoreJobsWithAI({ cvText, role, roleDescription, jobs });
    if (aiResults) {
      jobs = jobs.map((job, i) => {
        const aiResult = aiResults.get(i);
        if (!aiResult) return job;
        return {
          ...job,
          match: typeof aiResult.match === 'number' ? Math.max(0, Math.min(100, Math.round(aiResult.match))) : job.match,
          aiSummary: aiResult.summary || null
        };
      });
    }

    // Kein hartes 90%-Filter mehr (führte praktisch immer zu leeren
    // Ergebnissen) - stattdessen absteigend nach Match sortieren und
    // die besten Treffer zeigen.
    jobs = jobs.sort((a, b) => b.match - a.match).slice(0, 10);

    res.json({ jobs, aiPowered: !!aiResults });
  } catch (error) {
    const status = error.response?.status;
    const body = error.response?.data;
    console.error('JSearch API Error:', status, JSON.stringify(body) || error.message);

    const bodyMessage = typeof body === 'string' ? body : (body?.message || body?.error || (body ? JSON.stringify(body) : null));

    let reason;
    if (!rapidApiKey) {
      reason = 'JSEARCH_API_KEY ist in dieser Umgebung nicht gesetzt.';
    } else if (status === 401 || status === 403) {
      reason = `RapidAPI hat den Zugriff abgelehnt (HTTP ${status}) - meist fehlt ein aktives Abo der JSearch-API auf rapidapi.com/hub, oder der Key ist ungültig.${bodyMessage ? ' Antwort: ' + bodyMessage : ''}`;
    } else if (status === 429) {
      reason = `RapidAPI-Kontingent aufgebraucht (429 Too Many Requests).${bodyMessage ? ' Antwort: ' + bodyMessage : ''}`;
    } else if (error.code === 'ECONNABORTED') {
      reason = 'Zeitüberschreitung bei der Anfrage an JSearch.';
    } else if (status) {
      // Beliebiger anderer HTTP-Statuscode - Statuscode und Antworttext direkt
      // anzeigen, statt einen pauschalen "unbekannter Fehler" zu melden.
      // Key-Länge mitgeben (kein Secret-Leak) - hilft, einen falschen/
      // abgeschnittenen Key in Vercel zu erkennen.
      reason = `RapidAPI-Fehler HTTP ${status}${bodyMessage ? ': ' + bodyMessage : ''} (verwendeter Key: ${rapidApiKey.length} Zeichen)`;
    } else {
      // Kein HTTP-Response erhalten -> Netzwerk-/Verbindungsfehler
      reason = `Netzwerkfehler bei der Anfrage an JSearch: ${error.code || error.message}`;
    }

    // Fallback Demo-Jobs, falls die externe Jobsuche fehlschlägt
    // (z. B. fehlender/ungültiger JSEARCH_API_KEY, fehlendes RapidAPI-Abo)
    const fallbackJobs = [
      {
        id: 'fallback-1',
        title: `${role} – Berlin`,
        company: 'Tech Company GmbH',
        location: 'Berlin, Germany',
        country: 'Germany',
        url: 'https://example.com/jobs/1',
        description: `Wir suchen einen erfahrenen ${role}. Remote-Möglichkeit. Attraktive Konditionen.`,
        match: 94,
        aiSummary: 'Demo-Eintrag: Die externe Jobsuche war nicht erreichbar (JSEARCH_API_KEY prüfen).'
      },
      {
        id: 'fallback-2',
        title: `Senior ${role}`,
        company: 'StartUp AG',
        location: 'Vienna, Austria',
        country: 'Austria',
        url: 'https://example.com/jobs/2',
        description: `Erfahrener ${role} gesucht. Moderne Tech Stack. Innovatives Team.`,
        match: 91,
        aiSummary: 'Demo-Eintrag: Die externe Jobsuche war nicht erreichbar (JSEARCH_API_KEY prüfen).'
      }
    ];

    res.json({ jobs: fallbackJobs, aiPowered: false, fallback: true, reason });
  }
}
