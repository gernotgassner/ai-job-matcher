const API_BASE = '/api';

let currentUser = null;
let currentToken = null;
let currentCvText = null;
let currentCvFileName = null;
let currentJobs = [];
let favorites = {};
let showLowMatches = false;
let currentFallback = false;

// Nur Treffer ab dieser Schwelle werden standardmäßig angezeigt.
const MATCH_THRESHOLD = 90;
const MIN_CV_CHARS = 200;

// Liest den Text eines Lebenslaufs (TXT, PDF, DOCX) direkt im Browser.
// file.text() liefert bei PDF/DOCX nur Binärmüll, den die KI nicht analysieren kann.
async function extractCvText(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith('.txt') || name.endsWith('.md') || file.type === 'text/plain') {
    return file.text();
  }

  if (name.endsWith('.pdf')) {
    if (!window.pdfjsLib) throw new Error('PDF-Leser konnte nicht geladen werden. Bitte Seite neu laden.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // hasEOL erhält Zeilenumbrüche, damit die Struktur des CVs lesbar bleibt
      pages.push(content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
    }
    return pages.join('\n\n');
  }

  if (name.endsWith('.docx')) {
    if (!window.mammoth) throw new Error('Word-Leser konnte nicht geladen werden. Bitte Seite neu laden.');
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }

  if (name.endsWith('.doc')) {
    throw new Error('Das alte .doc-Format wird nicht unterstützt. Bitte als PDF oder DOCX speichern.');
  }

  throw new Error('Nicht unterstütztes Dateiformat. Erlaubt: PDF, DOCX, TXT.');
}

const $ = (id) => document.getElementById(id);

// CV, Favoriten etc. leben ausschließlich im localStorage des Browsers
// (siehe README) - die serverseitigen API-Routen sind zustandslose
// Vercel-Functions ohne gemeinsamen Speicher zwischen Aufrufen.
function loadFavoritesFromStorage() {
  try {
    return JSON.parse(localStorage.getItem('jobMatcherFavorites') || '{}');
  } catch {
    return {};
  }
}

function saveFavoritesToStorage() {
  localStorage.setItem('jobMatcherFavorites', JSON.stringify(favorites));
}

// Google Login Initialisierung
function initGoogleLogin() {
  if (window.google && window.google.accounts) {
    google.accounts.id.initialize({
      client_id: '986980931499-euoqjpb7uj4h045uf2rns52ijbbke1g6.apps.googleusercontent.com',
      callback: handleGoogleLogin
    });
    google.accounts.id.renderButton(
      document.getElementById('googleButtonContainer'),
      {
        theme: 'outline',
        size: 'large',
        width: '300'
      }
    );
  }
}

async function handleGoogleLogin(response) {
  try {
    const res = await fetch(`${API_BASE}/google-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: response.credential })
    });

    const data = await res.json();
    if (data.token) {
      loginSuccess(data.user.email, data.token);
    } else {
      showStatus('Google Login fehlgeschlagen', 'error');
    }
  } catch (error) {
    console.error('Google Login Error:', error);
    showStatus('Login-Fehler. Bitte versuche es später erneut.', 'error');
  }
}

// Test Login
$('testLoginBtn').addEventListener('click', async () => {
  const email = $('testEmail').value.trim();
  if (!email) {
    showStatus('Bitte E-Mail eingeben', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/test-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await res.json();
    if (data.token) {
      loginSuccess(data.user.email, data.token);
    } else {
      showStatus('Login fehlgeschlagen', 'error');
    }
  } catch (error) {
    console.error('Login Error:', error);
    showStatus('Verbindungsfehler', 'error');
  }
});

function loginSuccess(email, token) {
  currentUser = email;
  currentToken = token;
  localStorage.setItem('jobMatcherToken', token);
  localStorage.setItem('jobMatcherEmail', email);
  render();
}

// Logout
$('logoutBtn').addEventListener('click', () => {
  currentUser = null;
  currentToken = null;
  localStorage.removeItem('jobMatcherToken');
  localStorage.removeItem('jobMatcherEmail');
  render();
});

// CV Upload
$('cvInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !currentUser) return;

  try {
    showStatus('🔄 Lebenslauf wird gelesen...', 'info');
    const text = (await extractCvText(file)).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    if (text.length < MIN_CV_CHARS) {
      showStatus('❌ Aus der Datei konnte kaum Text gelesen werden (gescanntes PDF/Bild?). Bitte ein PDF mit Text, DOCX oder TXT hochladen.', 'error');
      e.target.value = '';
      return;
    }

    // Lebenslauf lokal speichern - das ist die Quelle der Wahrheit für die
    // Jobsuche, da Vercel-Functions keinen Speicher über Requests hinweg teilen.
    currentCvText = text;
    currentCvFileName = file.name;
    localStorage.setItem('jobMatcherCvText', text);
    localStorage.setItem('jobMatcherCvFileName', file.name);

    showStatus(`✅ Lebenslauf gelesen: ${file.name} (${text.length.toLocaleString('de-DE')} Zeichen)`, 'success');
    updateCvStatus(file.name);

    // Best-effort serverseitiges Speichern (z. B. für zukünftiges Logging);
    // die App funktioniert unabhängig vom Ergebnis dieses Calls.
    fetch(`${API_BASE}/cv`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ email: currentUser, cvText: text })
    }).catch(() => {});
  } catch (error) {
    console.error('CV Upload Error:', error);
    showStatus(`❌ ${error.message || 'Fehler beim Hochladen'}`, 'error');
  }
});

// Delete CV
$('removeCvBtn').addEventListener('click', () => {
  if (!currentUser) return;

  currentCvText = null;
  currentCvFileName = null;
  localStorage.removeItem('jobMatcherCvText');
  localStorage.removeItem('jobMatcherCvFileName');

  showStatus('✅ Lebenslauf gelöscht', 'success');
  updateCvStatus(null);
  currentJobs = [];
  renderCvProfile(null);
  renderJobs([]);
});

// Job Search
$('scanBtn').addEventListener('click', async () => {
  if (!currentUser) {
    showStatus('Bitte anmelden', 'error');
    return;
  }

  if (!currentCvText) {
    showStatus('❌ Bitte zuerst einen Lebenslauf hochladen', 'error');
    return;
  }

  const role = $('jobRoleInput').value.trim() || 'Software Engineer';
  const roleDescription = $('jobRoleDescriptionInput').value.trim();
  const country = $('countrySelect').value;

  showStatus('🔄 Suche läuft...', 'info');

  try {
    const res = await fetch(`${API_BASE}/jobs-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        email: currentUser,
        cvText: currentCvText,
        role,
        roleDescription,
        country
      })
    });

    const data = await res.json();

    if (!res.ok) {
      showStatus(`❌ ${data.error || 'Fehler bei der Jobsuche'}`, 'error');
      currentJobs = [];
      renderJobs([]);
      return;
    }

    currentJobs = data.jobs || [];
    currentFallback = !!data.fallback;
    showLowMatches = false;
    renderCvProfile(data.cvProfile);

    if (data.fallback) {
      showStatus(`⚠️ Demo-Jobs (externe Jobsuche fehlgeschlagen): ${data.reason || ''}`, 'error');
      renderJobs(currentJobs);
    } else if (currentJobs.length > 0) {
      const strong = currentJobs.filter((j) => j.match >= MATCH_THRESHOLD).length;
      const hidden = currentJobs.length - strong;
      let msg = strong > 0
        ? `✅ ${strong} Job${strong === 1 ? '' : 's'} mit mindestens ${MATCH_THRESHOLD} % Match gefunden`
        : `Keine Jobs mit mindestens ${MATCH_THRESHOLD} % Match gefunden`;
      if (hidden > 0) msg += ` – ${hidden} weitere unter ${MATCH_THRESHOLD} % ausgeblendet`;
      if (!data.aiPowered) {
        msg += ` ⚠️ Ohne KI-Bewertung (${data.aiError || 'KI nicht verfügbar'}) – nur grobe Keyword-Näherung`;
      }
      showStatus(msg, strong > 0 && data.aiPowered ? 'success' : 'info');
      renderJobs(currentJobs);
    } else {
      showStatus(`❌ Keine passenden Jobs gefunden${data.note ? ' – ' + data.note : ''}`, 'info');
      renderJobs([]);
    }
  } catch (error) {
    console.error('Search Error:', error);
    showStatus('Fehler bei der Jobsuche', 'error');
  }
});

function setShowLowMatches(value) {
  showLowMatches = value;
  renderJobs(currentJobs);
}

function renderCvProfile(profile) {
  const box = $('cvProfileBox');
  if (!profile || (!profile.summary && !profile.headline)) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const skills = (profile.coreSkills || []).slice(0, 12)
    .map((sk) => `<span class="skill-chip">${escapeHtml(String(sk))}</span>`).join('');
  box.innerHTML = `
    <p><strong>🧠 So hat die KI deinen Lebenslauf verstanden:</strong>
    ${escapeHtml(profile.headline || '')}${profile.seniority ? ' · ' + escapeHtml(profile.seniority) : ''}</p>
    ${profile.summary ? `<p class="cv-profile-text">${escapeHtml(profile.summary)}</p>` : ''}
    ${skills ? `<div class="skill-chips">${skills}</div>` : ''}`;
  box.classList.remove('hidden');
}

function renderBreakdown(job) {
  if (!Array.isArray(job.breakdown) || job.breakdown.length === 0) {
    return currentFallback ? '' : '<p class="field-hint">Grobe Keyword-Näherung – keine KI-Bewertung.</p>';
  }
  const rows = job.breakdown.map((b) => `
    <li>
      <span class="bd-label">${escapeHtml(b.label)}</span>
      <span class="bd-score">${b.score} %</span>
      <span class="bd-weight">Gewicht ${b.weight} %</span>
      <span class="bd-reason">${escapeHtml(b.reason || '')}</span>
    </li>`).join('');
  return `
    <details class="match-details">
      <summary>Wie kommt der Wert von ${job.match} % zustande?</summary>
      ${job.matchFormula ? `<p class="match-formula">${escapeHtml(job.matchFormula)}</p>` : ''}
      <ul class="match-breakdown">${rows}</ul>
    </details>`;
}

function renderJobs(jobs) {
  const container = $('jobsContainer');

  if (!jobs || jobs.length === 0) {
    container.innerHTML = '<p class="empty-state">Keine Jobangebote gefunden. Versuche eine neue Suche.</p>';
    $('foundJobsCount').textContent = '0';
    return;
  }

  // Unter der Schwelle wird nur auf ausdrücklichen Wunsch angezeigt.
  const visible = (showLowMatches || currentFallback)
    ? jobs
    : jobs.filter((j) => j.match >= MATCH_THRESHOLD);
  const hiddenCount = jobs.length - visible.length;
  $('foundJobsCount').textContent = visible.length;

  const toggle = hiddenCount > 0
    ? `<button class="btn btn-secondary full" onclick="setShowLowMatches(true)">Auch ${hiddenCount} Match${hiddenCount === 1 ? '' : 'es'} unter ${MATCH_THRESHOLD} % anzeigen</button>`
    : (showLowMatches && !currentFallback && jobs.some((j) => j.match < MATCH_THRESHOLD)
      ? `<button class="btn btn-secondary full" onclick="setShowLowMatches(false)">Matches unter ${MATCH_THRESHOLD} % wieder ausblenden</button>`
      : '');

  if (visible.length === 0) {
    container.innerHTML = `<p class="empty-state">Keine Jobs mit mindestens ${MATCH_THRESHOLD} % Match. Treffer darunter kannst du mit dem Button einblenden.</p>${toggle}`;
    return;
  }

  container.innerHTML = visible.map((job) => `
    <div class="job-card${job.match < MATCH_THRESHOLD && !currentFallback ? ' low-match' : ''}">
      <div class="job-header">
        <div class="job-title">
          <h4>${escapeHtml(job.title)}</h4>
          <p class="job-company">${escapeHtml(job.company)}</p>
        </div>
        <span class="match-badge">${job.match}% Match</span>
      </div>
      <div class="job-meta">
        <span class="meta-item">📍 ${escapeHtml(job.location)}</span>
        <span class="meta-item">🌍 ${escapeHtml(job.country || 'Global')}</span>
      </div>
      <p class="job-description">${escapeHtml(job.description.substring(0, 200))}</p>
      ${job.aiSummary ? `
      <div class="ai-summary">
        <span class="ai-icon">🤖</span>
        <span>${escapeHtml(job.aiSummary)}</span>
      </div>` : ''}
      ${renderBreakdown(job)}
      <div class="job-actions">
        <a href="${job.url}" target="_blank" rel="noopener noreferrer" class="btn btn-job-link">
          💼 Job ansehen
        </a>
        <button class="btn btn-favorite ${favorites[job.id] ? 'active' : ''}" data-id="${job.id}" onclick="toggleFavorite('${job.id}')">
          ${favorites[job.id] ? '★ Favorit' : '☆ Favorit'}
        </button>
      </div>
    </div>
  `).join('') + toggle;
}

function toggleFavorite(jobId) {
  if (!currentUser) return;

  if (favorites[jobId]) {
    delete favorites[jobId];
  } else {
    const job = currentJobs.find(j => j.id === jobId);
    if (job) {
      favorites[jobId] = job;
    }
  }

  saveFavoritesToStorage();
  $('favoritesCount').textContent = Object.keys(favorites).length;
  renderFavorites(Object.values(favorites));
  renderJobs(currentJobs);
}

function renderFavorites(favorites) {
  const container = $('favoritesContainer');

  if (!favorites || favorites.length === 0) {
    container.innerHTML = '<p class="empty-state">Noch keine Favoriten. Markiere Jobs als Favorit!</p>';
    return;
  }

  container.innerHTML = favorites.map((job) => `
    <div class="job-card">
      <div class="job-header">
        <div class="job-title">
          <h4>${escapeHtml(job.title)}</h4>
          <p class="job-company">${escapeHtml(job.company)}</p>
        </div>
        <span class="match-badge">${job.match}% Match</span>
      </div>
      <div class="job-meta">
        <span class="meta-item">📍 ${escapeHtml(job.location)}</span>
      </div>
      <div class="job-actions">
        <a href="${job.url}" target="_blank" rel="noopener noreferrer" class="btn btn-job-link">
          💼 Job ansehen
        </a>
      </div>
    </div>
  `).join('');
}

function updateCvStatus(fileName) {
  const statusEl = $('cvStatusText');
  const removeBtn = $('removeCvBtn');

  if (fileName) {
    statusEl.textContent = `✅ ${fileName} hochgeladen`;
    removeBtn.classList.remove('hidden');
  } else {
    statusEl.textContent = 'Noch kein Lebenslauf hochgeladen';
    removeBtn.classList.add('hidden');
  }
}

function showStatus(message, type = 'info') {
  const el = $('statusMessage');
  el.textContent = message;
  el.className = `status-message status-${type}`;
}

function render() {
  const loginSection = $('loginSection');
  const appSection = $('appSection');
  const logoutBtn = $('logoutBtn');
  const userEmail = $('userEmail');

  if (currentUser) {
    loginSection.classList.add('hidden');
    appSection.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    userEmail.textContent = currentUser;
  } else {
    loginSection.classList.remove('hidden');
    appSection.classList.add('hidden');
    logoutBtn.classList.add('hidden');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Restore session on load
window.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('jobMatcherToken');
  const email = localStorage.getItem('jobMatcherEmail');

  if (token && email) {
    currentToken = token;
    currentUser = email;
    render();
  }

  const savedCvText = localStorage.getItem('jobMatcherCvText');
  const savedCvFileName = localStorage.getItem('jobMatcherCvFileName');
  if (savedCvText && savedCvFileName) {
    currentCvText = savedCvText;
    currentCvFileName = savedCvFileName;
    updateCvStatus(savedCvFileName);
  }

  favorites = loadFavoritesFromStorage();
  $('favoritesCount').textContent = Object.keys(favorites).length;
  renderFavorites(Object.values(favorites));

  initGoogleLogin();
});
