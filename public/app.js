const API_BASE = '/api';

let currentUser = null;
let currentToken = null;
let currentCvText = null;
let currentCvFileName = null;
let currentJobs = [];
let favorites = {};

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
    const text = await file.text();

    // Lebenslauf lokal speichern - das ist die Quelle der Wahrheit für die
    // Jobsuche, da Vercel-Functions keinen Speicher über Requests hinweg teilen.
    currentCvText = text;
    currentCvFileName = file.name;
    localStorage.setItem('jobMatcherCvText', text);
    localStorage.setItem('jobMatcherCvFileName', file.name);

    showStatus(`✅ Lebenslauf hochgeladen: ${file.name}`, 'success');
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
    showStatus('Fehler beim Hochladen', 'error');
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
  renderJobs([]);
  $('foundJobsCount').textContent = '0';
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

    if (data.fallback) {
      showStatus(`⚠️ Demo-Jobs (externe Jobsuche fehlgeschlagen): ${data.reason || ''}`, 'error');
      renderJobs(currentJobs);
      $('foundJobsCount').textContent = currentJobs.length;
    } else if (currentJobs.length > 0) {
      const suffix = data.aiPowered ? ' (KI-bewertet)' : '';
      showStatus(`✅ ${currentJobs.length} passende Jobs gefunden!${suffix}`, 'success');
      renderJobs(currentJobs);
      $('foundJobsCount').textContent = currentJobs.length;
    } else {
      showStatus(`❌ Keine passenden Jobs gefunden${data.note ? ' – ' + data.note : ''}`, 'info');
      renderJobs([]);
      $('foundJobsCount').textContent = '0';
    }
  } catch (error) {
    console.error('Search Error:', error);
    showStatus('Fehler bei der Jobsuche', 'error');
  }
});

function renderJobs(jobs) {
  const container = $('jobsContainer');

  if (!jobs || jobs.length === 0) {
    container.innerHTML = '<p class="empty-state">Keine Jobangebote gefunden. Versuche eine neue Suche.</p>';
    return;
  }

  container.innerHTML = jobs.map((job) => `
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
        <span class="meta-item">🌍 ${escapeHtml(job.country || 'Global')}</span>
      </div>
      <p class="job-description">${escapeHtml(job.description.substring(0, 200))}</p>
      ${job.aiSummary ? `
      <div class="ai-summary">
        <span class="ai-icon">🤖</span>
        <span>${escapeHtml(job.aiSummary)}</span>
      </div>` : ''}
      <div class="job-actions">
        <a href="${job.url}" target="_blank" rel="noopener noreferrer" class="btn btn-job-link">
          💼 Job ansehen
        </a>
        <button class="btn btn-favorite ${favorites[job.id] ? 'active' : ''}" data-id="${job.id}" onclick="toggleFavorite('${job.id}')">
          ${favorites[job.id] ? '★ Favorit' : '☆ Favorit'}
        </button>
      </div>
    </div>
  `).join('');
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
