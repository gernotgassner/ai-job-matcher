import axios from 'axios';
import jwt from 'jsonwebtoken';

const users = new Map();

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

function calculateMatchScore(cvText, jobText) {
  const cvKeywords = new Set(extractKeywords(cvText));
  const jobKeywords = new Set(extractKeywords(jobText));

  if (jobKeywords.size === 0) return 0;

  const matches = [...jobKeywords].filter(kw => cvKeywords.has(kw)).length;
  const baseScore = (matches / jobKeywords.size) * 100;
  const bonus = [...cvKeywords].filter(kw => kw.length > 5 && jobKeywords.has(kw)).length * 2;

  return Math.min(100, Math.round(baseScore + bonus));
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

  const { email, role, country } = req.body;

  if (!email || !role || !country) {
    return res.status(400).json({ error: 'Missing email, role, or country' });
  }

  if (!users.has(email)) {
    return res.status(400).json({ error: 'No CV uploaded' });
  }

  const cvText = users.get(email).cvText;

  if (!cvText) {
    return res.status(400).json({ error: 'CV is empty' });
  }

  try {
    const query = `${role} jobs in ${country}`;

    const response = await axios.get('https://jsearch.p.rapidapi.com/search', {
      params: {
        query,
        page: '1',
        num_pages: '1',
        date_posted: 'all',
        sort: 'relevance'
      },
      headers: {
        'x-rapidapi-key': process.env.JSEARCH_API_KEY,
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
        match
      };
    });

    // Filter für 90%+ matches
    jobs = jobs.filter(j => j.match >= 90).sort((a, b) => b.match - a.match);

    // Speichere in User-Session
    if (!users.has(email)) {
      users.set(email, { cvText, favorites: {}, lastScan: [] });
    }
    users.get(email).lastScan = jobs;

    res.json({ jobs });
  } catch (error) {
    console.error('JSearch API Error:', error.message);

    // Fallback Demo-Jobs
    const fallbackJobs = [
      {
        id: 'fallback-1',
        title: `${role} – Berlin`,
        company: 'Tech Company GmbH',
        location: 'Berlin, Germany',
        country: 'Germany',
        url: 'https://example.com/jobs/1',
        description: `Wir suchen einen erfahrenen ${role}. Remote-Möglichkeit. Attraktive Konditionen.`,
        match: 94
      },
      {
        id: 'fallback-2',
        title: `Senior ${role}`,
        company: 'StartUp AG',
        location: 'Vienna, Austria',
        country: 'Austria',
        url: 'https://example.com/jobs/2',
        description: `Erfahrener ${role} gesucht. Moderne Tech Stack. Innovatives Team.`,
        match: 91
      }
    ];

    res.json({ jobs: fallbackJobs });
  }
}
