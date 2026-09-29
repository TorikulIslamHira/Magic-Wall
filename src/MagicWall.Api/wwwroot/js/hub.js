// Interactive Hub: the presenter drives the screen. A full-screen menu of module tiles; a tap
// opens the module, "মেনু" (or H / browser Back) returns. Isolated from the admin side: it
// ignores the producers' on-air switching and reads only public, approved-only endpoints,
// but still receives live DataChanged pushes so approved figures update in place.
import { connectHub, getJson } from './api.js';
import { el, setChildren } from './dom.js';
import { initFullscreen } from './fullscreen.js';
import { bnDigits, num, t } from './i18n.js';
import { MODULES, createStage, initChrome, setHeader } from './stage.js';

const MENU_HEADER = { title: 'প্রধান মেনু', eyebrow: 'ইন্টারঅ্যাক্টিভ হাব' };

const menu = document.getElementById('hub-menu');
const picker = document.getElementById('hub-picker');
const stageEl = document.getElementById('stage');
const backButton = document.getElementById('hub-back');

const stage = createStage(stageEl, {
  tag: 'hub',
  onModule: module => setHeader(module, MENU_HEADER)
});

// ---------- routing: #Election, #Sports/3/7, #War, #Budget; empty = menu ----------

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
    playerId: playerId ? Number(playerId) : null
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
      return `${num(declared)} / ${num(seats.length)} আসনে ফলাফল`;
    }),
    settle('Sports', async () => {
      const matches = (await getJson('/api/sports/matches')) ?? [];
      return `${num(matches.length)}টি ম্যাচ`;
    }),
    settle('War', async () => {
      const zones = (await getJson('/api/war/zones')) ?? [];
      return `${num(zones.length)}টি সংঘাতপূর্ণ অঞ্চল`;
    }),
    settle('Budget', async () => {
      const years = (await getJson('/api/budget/fiscal-years')) ?? [];
      if (!years.length) return '';
      const sectors = (await getJson(`/api/budget/sectors?fiscalYear=${encodeURIComponent(years[0])}`)) ?? [];
      const total = sectors.reduce((sum, s) => sum + s.totalAllocation, 0);
      return `${bnDigits(years[0])} · ${num(total)} কোটি টাকা`;
    })
  ]);
}

// ---------- sports picker: match, then player ----------

async function renderPicker(matchId) {
  if (!matchId) {
    const matches = (await getJson('/api/sports/matches')) ?? [];
    setChildren(picker,
      el('h2', { class: 'picker-title' }, 'একটি ম্যাচ বেছে নিন'),
      matches.length
        ? el('div', { class: 'picker-grid' }, matches.map(m =>
            el('button', { type: 'button', class: 'picker-card', onclick: () => navigate(`Sports/${m.id}`) },
              el('span', { class: 'picker-eyebrow' }, t.sports.sports[m.sport] ?? m.sport),
              el('span', { class: 'picker-name' }, m.title),
              el('span', { class: 'picker-sub' }, `${m.teamA} বনাম ${m.teamB}`))))
        : el('p', { class: 'hint' }, 'এখনো কোনো ম্যাচ নেই।'));
    return;
  }

  const [matches, players] = await Promise.all([
    getJson('/api/sports/matches'),
    getJson(`/api/sports/players?matchId=${matchId}`)
  ]);
  const match = (matches ?? []).find(m => m.id === matchId);
  setChildren(picker,
    el('button', { type: 'button', class: 'back', onclick: () => navigate('Sports') }, '← সব ম্যাচ'),
    el('h2', { class: 'picker-title' }, match ? `${match.title}: একজন খেলোয়াড় বেছে নিন` : 'একজন খেলোয়াড় বেছে নিন'),
    (players ?? []).length
      ? el('div', { class: 'picker-grid' }, players.map(p =>
          el('button', { type: 'button', class: 'picker-card', onclick: () => navigate(`Sports/${matchId}/${p.id}`) },
            el('span', { class: 'picker-eyebrow' }, p.team),
            el('span', { class: 'picker-name' }, p.name),
            p.role ? el('span', { class: 'picker-sub' }, p.role) : null)))
      : el('p', { class: 'hint' }, 'এই ম্যাচে কোনো খেলোয়াড় নেই।'));
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
