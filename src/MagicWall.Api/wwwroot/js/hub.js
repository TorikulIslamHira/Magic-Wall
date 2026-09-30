// Interactive Hub: the presenter drives the screen. A full-screen menu of module tiles; a tap
// opens the module, "মেনু" (or H / browser Back) returns. Isolated from the admin side: it
// ignores the producers' on-air switching and reads only public, approved-only endpoints,
// but still receives live DataChanged pushes so approved figures update in place.
import { connectHub, getJson } from './api.js';
import { el, setChildren } from './dom.js';
import { initFullscreen } from './fullscreen.js';
import { languageToggle, localizeDom, num, t } from './i18n.js';
import { MODULES, createStage, initChrome, setHeader } from './stage.js';

localizeDom();
document.querySelector('.topbar .status').prepend(languageToggle('lang-toggle'));

const MENU_HEADER = { title: t.hub.menuTitle, eyebrow: t.hub.menuEyebrow };

const menu = document.getElementById('hub-menu');
const picker = document.getElementById('hub-picker');
const stageEl = document.getElementById('stage');
const backButton = document.getElementById('hub-back');

const stage = createStage(stageEl, {
  tag: 'hub',
  onModule: module => setHeader(module, MENU_HEADER)
});

// ---------- routing: #Election, #Sports/3/7 (player), #Sports/3/all (whole match), #War, #Budget; empty = menu ----------

function navigate(hash) {
  if (location.hash.slice(1) === hash) route();
  else location.hash = hash;
}

async function route() {
  const [module, matchId, playerId] = decodeURIComponent(location.hash.slice(1)).split('/');

  if (!MODULES.includes(module)) {
    await stage.clear();
    show('menu');
    setHeader(null, MENU_HEADER);
    refreshStats();
    return;
  }

  if (module === 'Sports' && !(matchId && playerId)) {
    await stage.clear();
    show('picker');
    setHeader('Sports', MENU_HEADER);
    await renderPicker(matchId ? Number(matchId) : null);
    return;
  }

  show('stage');
  await stage.show(module, {
    activeModule: module,
    matchId: matchId ? Number(matchId) : null,
    playerId: playerId && playerId !== 'all' ? Number(playerId) : null
  });
}

function show(which) {
  menu.hidden = which !== 'menu';
  picker.hidden = which !== 'picker';
  stageEl.hidden = which !== 'stage';
  backButton.hidden = which === 'menu';
  document.body.dataset.view = which;
}

window.addEventListener('hashchange', route);
for (const tile of document.querySelectorAll('.hub-tile')) {
  tile.addEventListener('click', () => navigate(tile.dataset.module));
}
backButton.addEventListener('click', () => navigate(''));
document.addEventListener('keydown', event => {
  if (event.target.closest?.('input, textarea, select')) return;
  if ((event.key === 'h' || event.key === 'H' || event.key === 'Home') && !event.ctrlKey && !event.metaKey) navigate('');
});

// ---------- tile stats (live, approved data) ----------

async function refreshStats() {
  const set = (module, text) => { document.querySelector(`[data-stat="${module}"]`).textContent = text; };
  const settle = async (module, fn) => { try { set(module, await fn()); } catch { set(module, ''); } };

  await Promise.all([
    settle('Election', async () => {
      const seats = (await getJson('/api/election/constituencies')) ?? [];
      const declared = seats.filter(s => s.leadingParty).length;
      return t.hub.declared(declared, seats.length);
    }),
    settle('Sports', async () => {
      const matches = (await getJson('/api/sports/matches')) ?? [];
      return t.hub.matches(matches.length);
    }),
    settle('War', async () => {
      const zones = (await getJson('/api/war/zones')) ?? [];
      return t.hub.zones(zones.length);
    }),
    settle('Budget', async () => {
      const years = (await getJson('/api/budget/fiscal-years')) ?? [];
      if (!years.length) return '';
      const sectors = (await getJson(`/api/budget/sectors?fiscalYear=${encodeURIComponent(years[0])}`)) ?? [];
      const total = sectors.reduce((sum, s) => sum + s.totalAllocation, 0);
      return t.hub.budget(years[0], total);
    })
  ]);
}

// ---------- sports picker: match, then player ----------

const teamBadge = (url, name) => url
  ? el('img', { class: 'picker-badge', src: url, alt: '' })
  : el('span', { class: 'picker-badge is-empty', 'aria-hidden': 'true' }, (name || '?').slice(0, 1));

async function renderPicker(matchId) {
  if (!matchId) {
    const matches = (await getJson('/api/sports/matches')) ?? [];
    setChildren(picker,
      el('h2', { class: 'picker-title' }, t.hub.chooseMatch),
      matches.length
        ? el('div', { class: 'picker-grid' }, matches.map(m =>
            el('button', { type: 'button', class: 'picker-card', onclick: () => navigate(`Sports/${m.id}`) },
              el('span', { class: 'picker-eyebrow' }, [t.sports.sports[m.sport] ?? m.sport, m.competition].filter(Boolean).join(' · ')),
              el('span', { class: 'picker-name' }, m.title),
              // Both teams with their badges, and the score once there is one.
              el('span', { class: 'picker-teams' },
                teamBadge(m.teamABadge, m.teamA), el('span', {}, m.teamA),
                el('strong', { class: 'picker-score' }, m.scoreA != null && m.scoreB != null
                  ? `${num(m.scoreA)} – ${num(m.scoreB)}` : t.admin.sports.versus),
                el('span', {}, m.teamB), teamBadge(m.teamBBadge, m.teamB)),
              // NOT_FOUND is the desk's problem (a wrong feed id), not something for the audience.
              m.feedStatus && m.feedStatus !== 'NOT_FOUND' ? el('span', { class: 'picker-sub' }, t.sports.status[m.feedStatus] ?? m.feedStatus) : null)))
        : el('p', { class: 'hint' }, t.hub.noMatches));
    return;
  }

  const [matches, players] = await Promise.all([
    getJson('/api/sports/matches'),
    getJson(`/api/sports/players?matchId=${matchId}`)
  ]);
  const match = (matches ?? []).find(m => m.id === matchId);
  setChildren(picker,
    el('button', { type: 'button', class: 'back', onclick: () => navigate('Sports') }, t.hub.allMatches),
    el('h2', { class: 'picker-title' }, t.hub.choosePlayer(match?.title)),
    // Whole match first: scoreboard, timeline and spotlight, no single player needed.
    el('div', { class: 'picker-grid' },
      el('button', { type: 'button', class: 'picker-card is-overview', onclick: () => navigate(`Sports/${matchId}/all`) },
        el('span', { class: 'picker-eyebrow' }, t.sports.timeline),
        el('span', { class: 'picker-name' }, t.sports.matchOverview),
        el('span', { class: 'picker-sub' }, t.sports.matchOverviewHint))),
    (players ?? []).length
      ? el('div', { class: 'picker-grid' }, players.map(p =>
          el('button', { type: 'button', class: 'picker-card', onclick: () => navigate(`Sports/${matchId}/${p.id}`) },
            el('span', { class: 'picker-eyebrow' }, p.team),
            el('span', { class: 'picker-name' }, p.name),
            p.role ? el('span', { class: 'picker-sub' }, p.role) : null)))
      : el('p', { class: 'hint' }, t.hub.noPlayers));
}

// ---------- start ----------

const setStatus = initChrome();
initFullscreen(document.getElementById('fullscreen-toggle'), t.fullscreen);

connectHub({
  tag: 'hub',
  // StateChanged (the producers' on-air switch) is deliberately not subscribed: the presenter drives.
  on: {
    DataChanged: message => {
      stage.dataChanged(message);
      if (document.body.dataset.view === 'menu') refreshStats();
    }
  },
  onStatus: setStatus,
  onConnected: () => stage.refreshAll()
});

route().catch(stage.showError);
