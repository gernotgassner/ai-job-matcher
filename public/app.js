const API_BASE = '/api';

let currentUser = null;
let currentToken = null;
let currentCvText = null;
let currentCvFileName = null;
let currentJobs = [];
let favorites = {};
let currentFallback = false;
let showMoreTier = false;
let currentEntitlement = { subscribed: false };

// Für "mit Abo: bei erneutem Klick neue Jobs" - Cursor der letzten Suche samt
// Signatur der verwendeten Kriterien. Ändert sich die Signatur, wird eine neue
// Suche gestartet (Cursor verworfen); bleibt sie gleich, fordern wir die
// nächste Seite derselben Suche an.
let lastSearchSignature = null;
let lastCursor = null;

const MIN_CV_CHARS = 200;
const MAX_CV_FILE_BYTES = 1024 * 1024; // 1 MB

// Liest den Text eines Lebenslaufs (PDF, DOCX) direkt im Browser.
// file.text() liefert bei PDF/DOCX nur Binärmüll, den die KI nicht analysieren kann.
async function extractCvText(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith('.pdf')) {
    if (!window.pdfjsLib) throw new Error('PDF-Leser konnte nicht geladen werden. Bitte Seite neu laden.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
    }
    return pages.join('\n\n');
  }

  if (name.endsWith('.docx')) {
    if (!window.mammoth) throw new Error('Word-Leser konnte nicht geladen werden. Bitte Seite neu laden.');
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }

  throw new Error('Nicht unterstütztes Dateiformat. Erlaubt: PDF oder DOCX.');
}

const $ = (id) => document.getElementById(id);

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

// --- Google Login --------------------------------------------------------
// Das GSI-Skript lädt async/defer im <head> - auf einem frischen Besuch (ohne
// Cache) ist es beim DOMContentLoaded-Event oft noch nicht fertig geladen,
// window.google ist dann undefined und der Button erscheint nie (nur nach
// manuellem Reload, wenn das Skript dann aus dem Cache kommt). Deshalb hier
// mit kurzen Intervallen erneut versuchen statt nur einmal zu prüfen.
function initGoogleLogin(retriesLeft = 40) {
  if (window.google && window.google.accounts) {
    google.accounts.id.initialize({
      client_id: '986980931499-euoqjpb7uj4h045uf2rns52ijbbke1g6.apps.googleusercontent.com',
      callback: handleGoogleLogin
    });
    google.accounts.id.renderButton(
      document.getElementById('googleButtonContainer'),
      { theme: 'outline', size: 'large', width: '300' }
    );
    return;
  }
  if (retriesLeft <= 0) {
    console.error('Google Sign-In script did not load in time.');
    return;
  }
  setTimeout(() => initGoogleLogin(retriesLeft - 1), 150);
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

// --- Abo-Status ------------------------------------------------------------
// Suche selbst ist seit dem Produkt-Pivot für alle unbegrenzt möglich - das
// Abo steuert nur noch, wie viele/welche Ergebnisse angezeigt werden.
async function refreshSubscriptionStatus() {
  const box = $('subscriptionStatusText');
  const subscribeBtn = $('subscribeBtn');
  const manageBtn = $('manageSubBtn');

  try {
    const res = await fetch(`${API_BASE}/subscription-status`, {
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler');

    currentEntitlement = { subscribed: data.subscribed };

    if (data.subscribed) {
      const renewalNote = data.currentPeriodEnd
        ? new Date(data.currentPeriodEnd * 1000).toLocaleDateString('de-DE')
        : null;
      box.textContent = data.cancelAtPeriodEnd
        ? `✅ Abo aktiv – läuft am ${renewalNote || 'Periodenende'} aus`
        : `✅ Abo aktiv${renewalNote ? ` – verlängert sich am ${renewalNote}` : ''}`;
      subscribeBtn.classList.add('hidden');
      manageBtn.classList.remove('hidden');
    } else {
      box.textContent = 'Kostenlos: bis zu 3 Top-Matches pro Suche';
      subscribeBtn.classList.remove('hidden');
      manageBtn.classList.add('hidden');
    }
  } catch (error) {
    console.error('Subscription Status Error:', error);
    box.textContent = 'Abo-Status konnte nicht geladen werden.';
  }
}

// --- Modals ------------------------------------------------------------
function openModal(id) {
  $(id).classList.remove('hidden');
}
function closeModal(id) {
  $(id).classList.add('hidden');
}
document.querySelectorAll('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
});
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach((m) => m.classList.add('hidden'));
  }
});

async function callStripeEndpoint(path, btn, fallbackMsg) {
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Bitte warten...';
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.url) {
      window.location.href = data.url;
      return;
    }

    const message = data.error || `${fallbackMsg} (HTTP ${res.status})`;
    console.error('Stripe Endpoint Error:', path, res.status, message);
    showStatus(`❌ ${message}`, 'error');
  } catch (error) {
    console.error('Stripe Endpoint Network Error:', path, error);
    showStatus(`❌ ${fallbackMsg}: ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// "Abonnieren" zeigt zuerst nochmal die Vorteile, bevor es zu Stripe geht.
function startCheckoutFlow() {
  openModal('subscribeModal');
}
$('subscribeBtn').addEventListener('click', startCheckoutFlow);
$('subscribeModalConfirmBtn').addEventListener('click', () => {
  callStripeEndpoint('/create-checkout-session', $('subscribeModalConfirmBtn'), 'Checkout konnte nicht gestartet werden');
});
$('manageSubBtn').addEventListener('click', () => {
  callStripeEndpoint('/create-portal-session', $('manageSubBtn'), 'Kundenportal konnte nicht geöffnet werden');
});

function loginSuccess(email, token) {
  currentUser = email;
  currentToken = token;
  localStorage.setItem('jobMatcherToken', token);
  localStorage.setItem('jobMatcherEmail', email);
  render();
}

$('logoutBtn').addEventListener('click', () => {
  currentUser = null;
  currentToken = null;
  localStorage.removeItem('jobMatcherToken');
  localStorage.removeItem('jobMatcherEmail');
  render();
});

// --- CV Upload -------------------------------------------------------------
$('cvInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !currentUser) return;

  const name = file.name.toLowerCase();
  if (!name.endsWith('.pdf') && !name.endsWith('.docx')) {
    showStatus('❌ Nur PDF- oder DOCX-Dateien sind erlaubt.', 'error');
    e.target.value = '';
    return;
  }

  if (file.size > MAX_CV_FILE_BYTES) {
    showStatus(`❌ Die Datei ist zu gross (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximal 1 MB sind erlaubt.`, 'error');
    e.target.value = '';
    return;
  }

  try {
    showStatus('🔄 Lebenslauf wird gelesen...', 'info');
    const text = (await extractCvText(file)).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    if (text.length < MIN_CV_CHARS) {
      showStatus('❌ Aus der Datei konnte kaum Text gelesen werden (gescanntes PDF/Bild?). Bitte ein PDF mit Text oder DOCX hochladen.', 'error');
      e.target.value = '';
      return;
    }

    currentCvText = text;
    currentCvFileName = file.name;
    localStorage.setItem('jobMatcherCvText', text);
    localStorage.setItem('jobMatcherCvFileName', file.name);
    lastSearchSignature = null; // neuer CV -> nächste Suche startet frisch
    lastCursor = null;

    showStatus(`✅ Lebenslauf gelesen: ${file.name} (${text.length.toLocaleString('de-DE')} Zeichen)`, 'success');
    updateCvStatus(file.name);

    fetch(`${API_BASE}/cv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ email: currentUser, cvText: text })
    }).catch(() => {});
  } catch (error) {
    console.error('CV Upload Error:', error);
    showStatus(`❌ ${error.message || 'Fehler beim Hochladen'}`, 'error');
  }
});

$('removeCvBtn').addEventListener('click', () => {
  if (!currentUser) return;

  currentCvText = null;
  currentCvFileName = null;
  localStorage.removeItem('jobMatcherCvText');
  localStorage.removeItem('jobMatcherCvFileName');
  lastSearchSignature = null;
  lastCursor = null;

  showStatus('✅ Lebenslauf gelöscht', 'success');
  updateCvStatus(null);
  currentJobs = [];
  renderCvProfile(null);
  renderCareerGoalFit(null);
  renderImprovementTips(null);
  renderUpsell(null);
  renderJobs([]);
});

// --- Job-Suche ---------------------------------------------------------
$('scanBtn').addEventListener('click', async () => {
  if (!currentUser) {
    showStatus('Bitte anmelden', 'error');
    return;
  }
  if (!currentCvText) {
    showStatus('❌ Bitte zuerst einen Lebenslauf hochladen', 'error');
    return;
  }

  const careerGoal = $('careerGoalInput').value.trim();
  const country = $('countrySelect').value;

  // Gleiche Suche nochmal angestossen (mit Abo) -> nächste Seite statt
  // derselben Ergebnisse. Ändert sich Wunschberuf/Land oder der CV, startet
  // die Suche neu (siehe auch CV-Upload/-Löschen oben).
  const signature = JSON.stringify({ careerGoal, country, cv: currentCvText.length });
  const cursorToSend = (signature === lastSearchSignature) ? lastCursor : null;

  showStatus('🔄 Suche läuft...', 'info');
  $('scanBtn').disabled = true;

  try {
    const res = await fetch(`${API_BASE}/jobs-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ email: currentUser, cvText: currentCvText, careerGoal, country, cursor: cursorToSend })
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
    showMoreTier = false;
    lastSearchSignature = signature;
    lastCursor = data.cursor || null;

    renderCvProfile(data.cvProfile);
    renderCareerGoalFit(data.careerGoalFit);
    renderImprovementTips(data.improvementTips);
    renderUpsell(data);
    refreshSubscriptionStatus();

    const topCount = currentJobs.filter((j) => j.tier === 'top').length;

    if (data.fallback) {
      showStatus(`⚠️ Demo-Jobs (externe Jobsuche fehlgeschlagen): ${data.reason || ''}`, 'error');
    } else if (topCount > 0) {
      let msg = `✅ ${topCount} Top-Match${topCount === 1 ? '' : 'es'} gefunden`;
      if (!data.aiPowered) msg += ` ⚠️ Ohne KI-Bewertung (${data.aiError || 'KI nicht verfügbar'}) – nur grobe Näherung`;
      showStatus(msg, data.aiPowered ? 'success' : 'info');
    } else {
      showStatus('Keine Top-Matches gefunden – siehe Tipps unten.', 'info');
    }

    renderJobs(currentJobs);
  } catch (error) {
    console.error('Search Error:', error);
    showStatus('Fehler bei der Jobsuche', 'error');
  } finally {
    $('scanBtn').disabled = false;
  }
});

function setShowMoreTier(value) {
  showMoreTier = value;
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
  const education = (profile.education || []).length
    ? `<p class="cv-profile-text">🎓 ${escapeHtml(profile.education.join(' · '))}</p>` : '';
  box.innerHTML = `
    <p><strong>🧠 So hat die KI deinen Lebenslauf verstanden:</strong>
    ${escapeHtml(profile.headline || '')}${profile.seniority ? ' · ' + escapeHtml(profile.seniority) : ''}</p>
    ${profile.summary ? `<p class="cv-profile-text">${escapeHtml(profile.summary)}</p>` : ''}
    ${education}
    ${skills ? `<div class="skill-chips">${skills}</div>` : ''}`;
  box.classList.remove('hidden');
}

function renderCareerGoalFit(fit) {
  const box = $('careerGoalFitBox');
  if (!fit || !fit.description) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<strong>🎯 Wunschberuf-Abgleich:</strong> ${escapeHtml(fit.description)}`;
  box.classList.remove('hidden');
}

function renderImprovementTips(tips) {
  const box = $('improvementTipsBox');
  if (!tips) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<strong>💡 So verbesserst du deine Trefferquote:</strong> ${escapeHtml(tips)}`;
  box.classList.remove('hidden');
}

function renderUpsell(data) {
  const box = $('upsellBox');
  if (!data || currentEntitlement.subscribed || currentFallback) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const { lockedTopCount = 0, lockedMoreCount = 0 } = data;
  if (lockedTopCount === 0 && lockedMoreCount === 0) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const parts = [];
  if (lockedTopCount > 0) parts.push(`${lockedTopCount} weitere${lockedTopCount === 1 ? 'r' : ''} Top-Match${lockedTopCount === 1 ? '' : 'es'} (ab 85 %)`);
  if (lockedMoreCount > 0) parts.push(`${lockedMoreCount} Treffer im Bereich 50-84 %`);
  box.innerHTML = `
    <p>🔒 Mit Abo siehst du zusätzlich: ${parts.join(' und ')} – plus Verbesserungs­empfehlungen je Job.</p>
    <button class="btn btn-primary full" onclick="startCheckoutFlow()">💳 Abo-Vorteile ansehen</button>`;
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
      <summary>Wie kommt dieser Match zustande?</summary>
      <ul class="match-breakdown">${rows}</ul>
    </details>`;
}

function renderJobs(jobs) {
  const container = $('jobsContainer');

  if (!jobs || jobs.length === 0) {
    container.innerHTML = '<p class="empty-state">Keine Jobangebote gefunden. Versuche eine neue Suche oder passe deinen Wunschberuf an.</p>';
    $('foundJobsCount').textContent = '0';
    return;
  }

  const topJobs = jobs.filter((j) => j.tier === 'top' || currentFallback);
  const moreJobs = jobs.filter((j) => j.tier === 'more');
  const visible = showMoreTier ? jobs : topJobs;
  $('foundJobsCount').textContent = visible.length;

  const toggle = moreJobs.length > 0
    ? `<button class="btn btn-secondary full" onclick="setShowMoreTier(${!showMoreTier})">
        Weitere Jobs ${showMoreTier ? 'ausblenden' : `anzeigen (${moreJobs.length})`}
       </button>`
    : '';

  container.innerHTML = visible.map((job) => renderJobCard(job)).join('') + toggle;
}

function renderJobCard(job) {
  const isFav = !!favorites[job.id];
  return `
    <div class="job-card${job.tier === 'more' ? ' tier-more' : ''}">
      <div class="job-header">
        <div class="job-title">
          <h4>${escapeHtml(job.title)}</h4>
          <p class="job-company">${escapeHtml(job.company)}</p>
        </div>
        <span>
          ${job.isBestMatch ? '<span class="best-match-badge">⭐ Best Match</span>' : ''}
          <span class="match-badge">${job.match}% Match</span>
        </span>
      </div>
      <div class="job-meta">
        <span class="meta-item">📍 ${escapeHtml(job.location)}</span>
        <span class="meta-item">🌍 ${escapeHtml(job.country || 'Global')}</span>
        ${job.source ? `<span class="job-source">Quelle: ${escapeHtml(job.source)}</span>` : ''}
      </div>
      ${job.matchExplanation ? `
      <div class="ai-summary">
        <span class="ai-icon">🤖</span>
        <span>${escapeHtml(job.matchExplanation)}</span>
      </div>` : ''}
      ${renderBreakdown(job)}
      ${job.growthRecommendation ? `
      <div id="growth-${job.id}" class="growth-tip-box hidden">
        <strong>📈 So kommst du auf 100 %:</strong> ${escapeHtml(job.growthRecommendation)}
      </div>` : ''}
      <div class="job-actions">
        <a href="${job.url}" target="_blank" rel="noopener noreferrer" class="btn btn-job-link">💼 Job ansehen</a>
        ${job.growthRecommendation ? `
        <button class="btn btn-growth" onclick="toggleGrowthTip('${job.id}')">📈 Empfehlung</button>` : ''}
        <button class="btn btn-favorite ${isFav ? 'active' : ''}" data-id="${job.id}" onclick="toggleFavorite('${job.id}')">
          ${isFav ? '★ Favorit' : '☆ Favorit'}
        </button>
      </div>
    </div>
  `;
}

function toggleGrowthTip(jobId) {
  const el = $(`growth-${jobId}`);
  if (el) el.classList.toggle('hidden');
}

function toggleFavorite(jobId) {
  if (!currentUser) return;

  if (favorites[jobId]) {
    delete favorites[jobId];
  } else {
    const job = currentJobs.find((j) => j.id === jobId);
    if (job) favorites[jobId] = job;
  }

  saveFavoritesToStorage();
  $('favoritesCount').textContent = Object.keys(favorites).length;
  renderFavorites(Object.values(favorites));
  renderJobs(currentJobs);
}

function removeFavorite(jobId) {
  delete favorites[jobId];
  saveFavoritesToStorage();
  $('favoritesCount').textContent = Object.keys(favorites).length;
  renderFavorites(Object.values(favorites));
  renderJobs(currentJobs);
}

function renderFavorites(favoriteList) {
  const container = $('favoritesContainer');

  if (!favoriteList || favoriteList.length === 0) {
    container.innerHTML = '<p class="empty-state">Noch keine Favoriten. Markiere Jobs als Favorit!</p>';
    return;
  }

  container.innerHTML = favoriteList.map((job) => `
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
        ${job.source ? `<span class="job-source">Quelle: ${escapeHtml(job.source)}</span>` : ''}
      </div>
      <div class="job-actions">
        <a href="${job.url}" target="_blank" rel="noopener noreferrer" class="btn btn-job-link">💼 Job ansehen</a>
        <button class="favorite-remove-btn" onclick="removeFavorite('${job.id}')">✕ Entfernen</button>
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
    refreshSubscriptionStatus();
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

// --- Feedback & Störungsmeldung ------------------------------------------
async function submitSupportMessage(kind, text, statusEl, modalId, btn) {
  if (!text.trim()) {
    statusEl.textContent = 'Bitte zuerst einen Text eingeben.';
    return;
  }
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Wird gesendet...';
  try {
    const res = await fetch(`${API_BASE}/${kind === 'feedback' ? 'feedback' : 'report-issue'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
      body: JSON.stringify({ text: text.trim(), page: window.location.pathname })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      statusEl.textContent = '✅ Danke, deine Nachricht ist angekommen!';
      setTimeout(() => closeModal(modalId), 1200);
    } else {
      statusEl.textContent = `❌ ${data.error || 'Senden fehlgeschlagen. Bitte später erneut versuchen.'}`;
    }
  } catch (error) {
    console.error('Support message error:', error);
    statusEl.textContent = '❌ Senden fehlgeschlagen. Bitte später erneut versuchen.';
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

$('feedbackBtn').addEventListener('click', () => {
  $('feedbackText').value = '';
  $('feedbackStatus').textContent = '';
  openModal('feedbackModal');
});
$('feedbackSubmitBtn').addEventListener('click', () => {
  submitSupportMessage('feedback', $('feedbackText').value, $('feedbackStatus'), 'feedbackModal', $('feedbackSubmitBtn'));
});

$('reportIssueBtn').addEventListener('click', () => {
  $('issueText').value = '';
  $('issueStatus').textContent = '';
  openModal('issueModal');
});
$('issueSubmitBtn').addEventListener('click', () => {
  submitSupportMessage('issue', $('issueText').value, $('issueStatus'), 'issueModal', $('issueSubmitBtn'));
});

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

  const checkoutResult = new URLSearchParams(window.location.search).get('checkout');
  if (checkoutResult === 'success') {
    showStatus('✅ Vielen Dank! Dein Abo ist aktiv.', 'success');
    refreshSubscriptionStatus();
  } else if (checkoutResult === 'cancel') {
    showStatus('Checkout abgebrochen.', 'info');
  }
  if (checkoutResult) {
    window.history.replaceState({}, '', window.location.pathname);
  }

  initGoogleLogin();
  initCookieConsent();
});

// --- Cookie-Einwilligung -----------------------------------------------
const COOKIE_CONSENT_KEY = 'jobMatcherCookieConsent';

function initCookieConsent() {
  const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
  if (!consent) {
    $('cookieBanner').classList.remove('hidden');
  } else if (consent === 'all') {
    maybeLoadAnalytics();
  }

  $('cookieAcceptBtn').addEventListener('click', () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, 'all');
    $('cookieBanner').classList.add('hidden');
    maybeLoadAnalytics();
  });

  $('cookieRejectBtn').addEventListener('click', () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, 'necessary');
    $('cookieBanner').classList.add('hidden');
  });

  $('footerCookieBtn').addEventListener('click', () => {
    $('cookieBanner').classList.remove('hidden');
  });
}

function maybeLoadAnalytics() {
  const id = window.GA_MEASUREMENT_ID;
  if (!id || document.getElementById('ga4-script')) return;

  const script = document.createElement('script');
  script.id = 'ga4-script';
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', id, { anonymize_ip: true });
}
