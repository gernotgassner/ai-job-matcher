const KEY = 'ai-job-matcher-v1';
let state = JSON.parse(localStorage.getItem(KEY) || '{}');

const $ = (id) => document.getElementById(id);
const save = () => localStorage.setItem(KEY, JSON.stringify(state));

const bucket = () => {
  const key = state.user;
  if (!key) return null;
  if (!state[key]) state[key] = { cv: null, favorites: {}, results: [] };
  return state[key];
};

const demo = [
  ['Frontend Developer', 'NovaLabs GmbH', 'Berlin', 'https://example.com/jobs/frontend', 'React, TypeScript, JavaScript, UX, APIs und Accessibility'],
  ['Fullstack Engineer', 'BluePeak Solutions', 'Hamburg', 'https://example.com/jobs/fullstack', 'Node.js, React, TypeScript, PostgreSQL, APIs und Cloud'],
  ['Product Designer', 'Northwind Digital', 'München', 'https://example.com/jobs/design', 'Figma, UX Research, UI Design, Accessibility und Design Systems']
];

function keywords(s) {
  return (s || '').toLowerCase().match(/[a-zäöüß+#.]{3,}/g) || [];
}

function score(cvText, searchText) {
  const a = new Set(keywords(cvText));
  const b = [...new Set(keywords(searchText))];
  const hits = b.filter((x) => a.has(x)).length;
  return Math.min(100, Math.round((hits / Math.max(1, b.length)) * 100 + hits * 4));
}

function renderList(id, list, emptyText) {
  const el = $(id);
  if (!list.length) {
    el.innerHTML = `<p class="muted">${emptyText}</p>`;
    return;
  }

  el.innerHTML = list.map((job) => {
    const isFavorite = state[state.user]?.favorites?.[job.id];
    return `
      <article class="job">
        <h3>${job.title}</h3>
        <small>${job.company} · ${job.location} · <b>${job.match}% Match</b></small>
        <p>${job.description}</p>
        <div class="actions">
          <a href="${job.url}" target="_blank" rel="noreferrer">Job ansehen</a>
          <button class="${isFavorite ? 'favorite' : ''}" data-id="${job.id}">
            ${isFavorite ? '★ Entfernen' : '☆ Favorit'}
          </button>
        </div>
      </article>
    `;
  }).join('');

  el.querySelectorAll('[data-id]').forEach((button) => {
    button.onclick = () => toggle(button.dataset.id);
  });
}

function render() {
  const logged = !!state.user;
  $('login').classList.toggle('hidden', logged);
  $('app').classList.toggle('hidden', !logged);
  $('logout').classList.toggle('hidden', !logged);

  if (!logged) return;

  const b = bucket();
  $('cvStatus').textContent = b.cv ? `${b.cv.name} gespeichert (nur in diesem Browser)` : 'Noch kein Lebenslauf';

  renderList('results', b.results || [], 'Keine passenden Angebote gefunden.');
  renderList('favorites', Object.values(b.favorites || {}), 'Noch keine Favoriten.');
}

function toggle(id) {
  const b = bucket();
  if (!b) return;
  const resultJob = (b.results || []).find((item) => item.id === id);
  const favJob = Object.values(b.favorites || {}).find((item) => item.id === id);
  const job = resultJob || favJob;
  if (!job) return;

  if (b.favorites[id]) delete b.favorites[id];
  else b.favorites[id] = job;

  save();
  render();
}

$('loginButton').onclick = () => {
  const email = $('email').value.trim();
  if (!email) return alert('Bitte E-Mail eingeben.');
  state.user = email;
  bucket();
  save();
  render();
};

$('logout').onclick = () => {
  delete state.user;
  save();
  render();
};

$('cv').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  const b = bucket();
  b.cv = { name: file.name, text };
  save();
  render();
  $('status').textContent = 'Lebenslauf lokal gespeichert.';
};

$('removeCv').onclick = () => {
  const b = bucket();
  if (!b) return;
  b.cv = null;
  save();
  render();
  $('status').textContent = 'Lebenslauf gelöscht.';
};

$('scan').onclick = () => {
  const b = bucket();
  if (!b || !b.cv) return $('status').textContent = 'Bitte zuerst einen Lebenslauf hochladen.';

  const role = $('role').value || 'Software Engineer';
  const country = $('country').value;

  b.results = demo.map((item, index) => ({
    id: `${country}-${index}`,
    title: `${item[0]} – ${role}`,
    company: item[1],
    location: `${item[2]}, ${country}`,
    url: item[3],
    description: item[4],
    match: score(b.cv.text, `${item.join(' ')} ${role}`)
  })).filter((job) => job.match >= 90);

  save();
  render();
  $('status').textContent = `${b.results.length} Angebote mit mindestens 90% Match gefunden.`;
};

render();
