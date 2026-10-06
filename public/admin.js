const API_BASE = '/api';
const $ = (id) => document.getElementById(id);

const token = localStorage.getItem('jobMatcherToken');
const email = localStorage.getItem('jobMatcherEmail');

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function fmtDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('de-DE');
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let usersChart, subsChart;

function renderCharts(stats) {
  const labels = stats.newUserSeries.map((p) => p.date.slice(5));

  if (usersChart) usersChart.destroy();
  usersChart = new Chart($('usersChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Neue Nutzer',
        data: stats.newUserSeries.map((p) => p.count),
        borderColor: '#0F172A',
        backgroundColor: 'rgba(15,23,42,0.08)',
        tension: 0.25,
        fill: true
      }]
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });

  if (subsChart) subsChart.destroy();
  subsChart = new Chart($('subsChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Abgeschlossen',
          data: stats.resolvedSubsSeries.map((p) => p.count),
          borderColor: '#10B981',
          backgroundColor: 'rgba(16,185,129,0.08)',
          tension: 0.25,
          fill: true
        },
        {
          label: 'Gekündigt',
          data: stats.cancelledSubsSeries.map((p) => p.count),
          borderColor: '#EF4444',
          backgroundColor: 'rgba(239,68,68,0.06)',
          tension: 0.25,
          fill: true
        }
      ]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });
}

async function loadStats() {
  const days = $('rangeSelect').value;
  try {
    const stats = await apiGet(`/admin/stats?days=${days}`);
    $('statUsers').textContent = stats.totals.users;
    $('statActive').textContent = stats.totals.activeSubscriptions;
    $('statCancelled').textContent = stats.totals.cancelledSubscriptions;
    renderCharts(stats);
  } catch (error) {
    console.error('Stats error:', error);
  }
}

async function loadFeedback() {
  try {
    const { items } = await apiGet('/admin/feedback');
    $('feedbackTable').querySelector('tbody').innerHTML = items.length
      ? items.map((f) => `<tr><td>${escapeHtml(f.email)}</td><td class="wrap">${escapeHtml(f.text)}</td><td>${escapeHtml(f.page)}</td><td>${fmtDate(f.created_at)}</td></tr>`).join('')
      : '<tr><td colspan="4">Noch kein Feedback.</td></tr>';
  } catch (error) {
    console.error('Feedback load error:', error);
  }
}

async function loadIssues() {
  try {
    const { items } = await apiGet('/admin/issues');
    $('issuesTable').querySelector('tbody').innerHTML = items.length
      ? items.map((i) => `<tr><td>${escapeHtml(i.email)}</td><td class="wrap">${escapeHtml(i.text)}</td><td>${escapeHtml(i.page)}</td><td>${fmtDate(i.created_at)}</td></tr>`).join('')
      : '<tr><td colspan="4">Keine Störungsmeldungen.</td></tr>';
  } catch (error) {
    console.error('Issues load error:', error);
  }
}

async function loadErrors() {
  try {
    const { items } = await apiGet('/admin/errors');
    $('errorsTable').querySelector('tbody').innerHTML = items.length
      ? items.map((e) => `<tr><td>${escapeHtml(e.error_type)}</td><td class="wrap">${escapeHtml(e.message)}</td><td>${fmtDate(e.created_at)}</td></tr>`).join('')
      : '<tr><td colspan="3">Keine Fehler protokolliert.</td></tr>';
  } catch (error) {
    console.error('Errors load error:', error);
  }
}

async function loadAdmins() {
  try {
    const { items } = await apiGet('/admin/admins');
    $('adminsTable').querySelector('tbody').innerHTML = items.map((a) => `
      <tr>
        <td>${escapeHtml(a.email)}</td>
        <td><span class="status-pill ${a.status}">${a.status === 'confirmed' ? 'Bestätigt' : 'Ausstehend'}</span></td>
        <td>${escapeHtml(a.invited_by)}</td>
        <td>${fmtDate(a.confirmed_at || a.invited_at)}</td>
        <td>${a.primary ? '' : `<button class="admin-remove-btn" onclick="removeAdmin('${escapeHtml(a.email)}')">Entfernen</button>`}</td>
      </tr>`).join('');
  } catch (error) {
    console.error('Admins load error:', error);
  }
}

async function removeAdmin(adminEmail) {
  if (!confirm(`Admin-Zugriff für ${adminEmail} wirklich entfernen?`)) return;
  try {
    const res = await fetch(`${API_BASE}/admin/admins?email=${encodeURIComponent(adminEmail)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    loadAdmins();
  } catch (error) {
    alert('Fehler: ' + error.message);
  }
}
window.removeAdmin = removeAdmin;

$('inviteAdminBtn').addEventListener('click', async () => {
  const newEmail = $('newAdminEmail').value.trim();
  const statusEl = $('adminActionStatus');
  if (!newEmail) {
    statusEl.textContent = 'Bitte E-Mail-Adresse eingeben.';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/admin/admins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: newEmail })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    statusEl.textContent = `✅ ${data.message || 'Eingeladen.'}`;
    $('newAdminEmail').value = '';
    loadAdmins();
  } catch (error) {
    statusEl.textContent = `❌ ${error.message}`;
  }
});

$('rangeSelect').addEventListener('change', loadStats);

async function init() {
  const gate = $('gateMessage');

  if (!token || !email) {
    gate.innerHTML = '<p>Bitte zuerst auf der Hauptseite einloggen.</p><p><a href="/">Zur Anmeldung</a></p>';
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/subscription-status`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler');

    if (!data.isAdmin) {
      gate.innerHTML = '<p>Kein Zugriff auf den Admin-Bereich.</p><p><a href="/">Zurück zur App</a></p>';
      return;
    }
  } catch (error) {
    gate.innerHTML = `<p>Zugriff konnte nicht geprüft werden: ${escapeHtml(error.message)}</p>`;
    return;
  }

  gate.classList.add('hidden');
  $('adminContent').classList.remove('hidden');

  loadStats();
  loadAdmins();
  loadFeedback();
  loadIssues();
  loadErrors();
}

init();
