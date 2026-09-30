// Admin dashboard ("control room"). Staff log in; what they see follows their capabilities:
//  - Field reporters: a phone-friendly submission form only.
//  - Desk reporters: the election approval queue + election / war / budget editors.
//  - Sports desk: the sports feed queue + the sports editor.
//  - Admin: everything, plus user management.
// Every write goes through the REST API; the server broadcasts to all walls and other admin
// screens over SignalR, so several producers stay in sync.
import { UNAUTHORIZED_EVENT, connectHub, getJson, sendJson } from './api.js';
import { $, attempt, enableCardTables, fillSelect, flushPending, toast } from './admin-ui.js';
import { el, setChildren } from './dom.js';
import { createFieldForm } from './field.js';
import { badge, createFeedData, matchHeader } from './feeddata.js';
import { LANG, date, kickoff, languageToggle, localizeDom, num, t } from './i18n.js';
import { EVENT_COLORS, EVENT_TYPES, SPORTS, drawArrow, drawSurface, fitCanvas, fromPx, surfaceRect, toPx } from './pitch.js';
import { createElectionQueue, createSportsQueue } from './review.js';
import { createSettingsPanel } from './users.js';

const A = t.admin;

// The page's static text in the chosen language, and the switch (header + login card).
localizeDom();
document.querySelector('.user-chip').prepend(languageToggle('lang-toggle'));
document.querySelector('.login-card').append(languageToggle('lang-toggle is-login'));

let wallState = null;

// ---------- wall state ----------

async function pushState(changes, successMessage) {
  const { updatedAt, ...current } = wallState ?? {};
  const next = await attempt(() => sendJson('PUT', '/api/wall/state', { ...current, ...changes }), successMessage);
  if (next) setWallState(next);
}

function setWallState(state) {
  wallState = state;
  $('#on-air').textContent = A.modules[state.activeModule] ?? state.activeModule;
  for (const button of document.querySelectorAll('[data-module]')) {
    button.setAttribute('aria-pressed', String(button.dataset.module === state.activeModule));
  }
  for (const tab of document.querySelectorAll('[data-tab]')) {
    tab.classList.toggle('is-live', tab.dataset.tab === state.activeModule);
    tab.dataset.live = A.onAirTag;   // spelled out on the rail (a dot on the phone bar)
  }
}

for (const button of document.querySelectorAll('[data-module]')) {
  button.addEventListener('click', () => {
    pushState({ activeModule: button.dataset.module }, A.onAir(A.modules[button.dataset.module]));
    setDrawer(false);   // the drawer covers the page: close it once the choice is made (the pill shows the result)
  });
}

// ---------- the on-air controls live in a slide-in drawer (every width) ----------

const phoneQuery = matchMedia('(max-width: 768px)');
const isPhone = () => phoneQuery.matches;
const drawer = $('#sidebar');
const navToggle = $('#nav-toggle');

function setDrawer(open) {
  document.body.classList.toggle('drawer-open', open);
  navToggle.setAttribute('aria-expanded', String(open));
  $('#nav-backdrop').hidden = !open;
  if (open) {
    loadPreview();
    drawer.querySelector('[aria-pressed="true"]')?.focus();
  } else if (drawer.contains(document.activeElement)) {
    navToggle.focus();
  }
}

navToggle.addEventListener('click', () => setDrawer(!document.body.classList.contains('drawer-open')));
$('#nav-close').addEventListener('click', () => setDrawer(false));
$('#nav-backdrop').addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('drawer-open')) setDrawer(false);
});

// Swipe the drawer to the left to close it, like a native side menu.
let swipeStart = null;
drawer.addEventListener('touchstart', event => {
  const t = event.touches[0];
  swipeStart = { x: t.clientX, y: t.clientY };
}, { passive: true });
drawer.addEventListener('touchend', event => {
  if (!swipeStart) return;
  const t = event.changedTouches[0];
  const dx = t.clientX - swipeStart.x;
  if (dx < -60 && Math.abs(dx) > Math.abs(t.clientY - swipeStart.y) * 1.5) setDrawer(false);
  swipeStart = null;
}, { passive: true });

// Growing past phone width (rotating a tablet) puts the sidebar back in the page.
// The on-air pill opens the drawer too: it's where people look for "what's on air".
$('#on-air-pill').addEventListener('click', () => setDrawer(true));

// Sticky elements sit under the header; its height changes with the width (it wraps on phones).
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--header-h', `${Math.round(entry.target.getBoundingClientRect().height)}px`);
}).observe(document.querySelector('.topbar'));

// Table rows turn into cards on phones; label every cell with its column.
enableCardTables();

// ---------- tabs ----------

// Tabs the signed-in user may open (the rest are hidden by applyCapabilities).
const allowedTab = name => {
  const tab = document.querySelector(`[data-tab="${name}"]`);
  return tab && !tab.hidden;
};

const TAB_KEY = 'magicwall.tab';

function showTab(name) {
  if (!allowedTab(name)) name = document.querySelector('[data-tab]:not([hidden])')?.dataset.tab;
  try { sessionStorage.setItem(TAB_KEY, name); } catch { /* not remembered */ }
  for (const tab of document.querySelectorAll('[data-tab]')) tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== name;
  if (name === 'Sports') sports.resizePitch();
  // With many tabs (admin) the phone's bottom bar scrolls sideways: keep the active one in view.
  if (isPhone()) document.querySelector(`[data-tab="${name}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => {
    showTab(tab.dataset.tab);
    // Bottom-bar navigation on a phone: each tab starts at its top, like switching screens in an app.
    if (isPhone()) window.scrollTo({ top: 0 });
  });
}

// ---------- election editor ----------

const election = {
  candidates: [],
  current: null,

  async init() {
    const [constituencies, candidates, districts] = await Promise.all([
      getJson('/api/election/constituencies'),
      getJson('/api/election/candidates'),
      getJson('/maps/bd-districts.geojson')
    ]);
    this.candidates = candidates ?? [];
    fillSelect($('#el-constituency'), constituencies ?? [], {
      value: c => c.svgPathId,
      label: c => c.name,
      placeholder: A.election.chooseSeat
    });
    // New candidates are nominated in a seat, so field reporters find them before any votes exist.
    fillSelect($('#el-new-candidate-seat'), constituencies ?? [], {
      value: c => c.id,
      label: c => c.name,
      placeholder: A.election.chooseSeat
    });
    // Districts come from the map itself, so a seat can only be tied to a district the wall can draw.
    const districtOptions = (districts?.features ?? [])
      .map(f => f.properties)
      .sort((a, b) => a.name_en.localeCompare(b.name_en));
    fillSelect($('#el-new-seat-district'), districtOptions, {
      value: d => d.code,
      label: d => (LANG === 'en' ? d.name_en : `${d.name_bn} (${d.name_en})`),
      placeholder: A.election.chooseDistrict
    });
    const parties = [...new Set(this.candidates.map(c => c.partyName))].sort();
    setChildren($('#el-parties'), parties.map(p => el('option', { value: p })));
    this.render();
  },

  async addConstituency() {
    const totalVoters = Number($('#el-new-seat-voters').value);
    if (!Number.isInteger(totalVoters) || totalVoters < 0) return toast(A.wholeNumber(A.election.voters), 'error');

    const created = await attempt(() => sendJson('POST', '/api/election/constituencies', {
      name: $('#el-new-seat-name').value.trim(),
      svgPathId: $('#el-new-seat-path').value.trim(),
      districtCode: $('#el-new-seat-district').value,
      totalVoters
    }), A.election.seatAdded);

    if (created) {
      for (const id of ['#el-new-seat-name', '#el-new-seat-path']) $(id).value = '';
      await this.init();
      $('#el-constituency').value = created.svgPathId;
      await this.load(created.svgPathId);
    }
  },

  async addCandidate() {
    const created = await attempt(() => sendJson('POST', '/api/election/candidates', {
      name: $('#el-new-candidate-name').value.trim(),
      partyName: $('#el-new-candidate-party').value.trim(),
      symbol: $('#el-new-candidate-symbol').value.trim(),
      constituencyId: Number($('#el-new-candidate-seat').value) || null
    }), A.election.candidateAdded);

    if (created) {
      $('#el-new-candidate-name').value = '';
      await this.init();
    }
  },

  async load(svgPathId) {
    this.current = svgPathId ? await getJson(`/api/election/results/${encodeURIComponent(svgPathId)}`) : null;
    this.render();
  },

  render() {
    const dto = this.current;
    const tbody = $('#el-results');
    $('#el-add').hidden = !dto;
    $('#el-show').disabled = !dto;

    if (!dto) {
      $('#el-summary').textContent = '';
      tbody.replaceChildren(el('tr', {}, el('td', { colspan: 4, class: 'muted' }, A.election.pickSeatFirst)));
      return;
    }

    $('#el-summary').textContent =
      A.election.summary(dto.totalVotesCast, dto.totalVoters, dto.turnoutPercentage);

    tbody.replaceChildren(...dto.results.map(r => {
      const input = el('input', { type: 'number', min: 0, step: 1, value: r.votesReceived, 'aria-label': A.election.votesFor(r.candidateName) });
      const save = () => this.save(r.candidateId, input.value);
      input.addEventListener('keydown', event => { if (event.key === 'Enter') save(); });
      return el('tr', {},
        el('td', {}, r.candidateName),
        el('td', {}, r.partyName),
        el('td', { class: 'num' }, input),
        el('td', {}, el('button', { type: 'button', onclick: save }, A.save)));
    }));
    if (!dto.results.length) {
      tbody.append(el('tr', {}, el('td', { colspan: 4, class: 'muted' }, A.election.noCandidates)));
    }

    const inSeat = new Set(dto.results.map(r => r.candidateId));
    fillSelect($('#el-add-candidate'), this.candidates.filter(c => !inSeat.has(c.id)), {
      value: c => c.id,
      label: c => `${c.name} (${c.partyName})`,
      placeholder: A.election.chooseCandidate
    });
  },

  async save(candidateId, rawVotes) {
    const votes = Number(rawVotes);
    if (!Number.isInteger(votes) || votes < 0) {
      toast(A.wholeNumber(A.election.votes), 'error');
      return;
    }
    const updated = await attempt(() => sendJson('PUT', '/api/election/results', {
      constituencyId: this.current.constituencyId,
      candidateId: Number(candidateId),
      votesReceived: votes
    }), A.election.saved);
    if (updated) {
      this.current = updated;
      this.render();
    }
  }
};

$('#el-constituency').addEventListener('change', event => attempt(() => election.load(event.target.value)));

$('#el-show').addEventListener('click', () =>
  pushState({ activeModule: 'Election', svgPathId: election.current.svgPathId }, A.onWall(election.current.name)));

$('#el-add').addEventListener('submit', event => {
  event.preventDefault();
  const candidateId = $('#el-add-candidate').value;
  if (!candidateId) {
    toast(A.election.pickCandidate, 'error');
    return;
  }
  election.save(candidateId, $('#el-add-votes').value);
});

$('#el-new-seat').addEventListener('submit', event => {
  event.preventDefault();
  election.addConstituency();
});

$('#el-new-candidate').addEventListener('submit', event => {
  event.preventDefault();
  election.addCandidate();
});

// ---------- sports editor ----------

const sports = {
  matches: [],
  events: [],
  start: null,     // { x, y } in 0–100 surface coordinates
  end: null,
  dragging: false,
  rect: null,
  size: { w: 0, h: 0 },
  canvas: $('#sp-pitch'),

  get sport() {
    return $('#sp-sport').value || 'Football';
  },

  get match() {
    return this.matches.find(m => String(m.id) === $('#sp-match').value) ?? null;
  },

  get playerId() {
    return Number($('#sp-player').value) || null;
  },

  async init() {
    this.matches = (await getJson('/api/sports/matches')) ?? [];
    fillSelect($('#sp-sport'), SPORTS, { value: s => s, label: s => t.sports.sports[s] ?? s });
    // Open on the sport of the newest match, so there is something to pick straight away.
    if (!this.pitchBound && this.matches[0]) $('#sp-sport').value = this.matches[0].sport;
    if (!this.pitchBound) {
      this.bindPitch();
      this.pitchBound = true;
    }
    await this.onSportChange();
  },

  /** Sport drives everything below it: the match list, the field graphic and the event types. */
  async onSportChange() {
    const matches = this.matches.filter(m => m.sport === this.sport);
    fillSelect($('#sp-match'), matches, {
      value: m => m.id,
      label: m => `${m.title} (${m.teamA} ${A.sports.versus} ${m.teamB})`,
      placeholder: matches.length ? A.sports.chooseMatch : A.sports.noMatches
    });
    fillSelect($('#sp-type'), EVENT_TYPES[this.sport], { value: type => type, label: type => t.sports.events[type] ?? type });
    this.clearPosition();
    await this.onMatchChange();
  },

  async onMatchChange() {
    const match = this.match;
    const players = match ? (await getJson(`/api/sports/players?matchId=${match.id}`)) ?? [] : [];
    fillSelect($('#sp-player'), players, {
      value: p => p.id,
      label: p => `${p.name} (${p.team}${p.role ? `, ${p.role}` : ''})`,
      placeholder: A.sports.choosePlayer
    });
    fillSelect($('#sp-new-player-team'), match ? [match.teamA, match.teamB] : [], {
      value: team => team,
      label: team => team,
      placeholder: match ? null : A.sports.pickMatchFirst
    });
    this.renderFeed();
    this.draw();
    await this.loadEvents();
  },

  /** Live feed link for the chosen match: linked matches are polled and their events queued for review. */
  renderFeed() {
    const match = this.match;
    const row = $('#sp-feed-status').closest('.feed-row');
    row.hidden = !match;
    $('#sp-match-head').hidden = !match;
    if (!match) return;
    setChildren($('#sp-match-head'), matchHeader(match));
    const linked = Boolean(match.feedMatchId);
    const missing = linked && match.feedStatus === 'NOT_FOUND';
    $('#sp-feed-status').textContent = missing ? A.feed.notFound(match.feedMatchId) : linked ? A.feed.linked(match.feedMatchId) : A.feed.unlinked;
    $('#sp-feed-status').classList.toggle('is-on', linked && !missing);
    $('#sp-feed-status').classList.toggle('is-error', missing);
    $('#sp-feed-id').hidden = linked;
    if (!linked && !$('#sp-feed-id').value) $('#sp-feed-id').value = `live-${match.id}`;
    $('#sp-feed-toggle').textContent = linked ? A.feed.turnOff : A.feed.turnOn;
  },

  async toggleFeed() {
    const match = this.match;
    if (!match) return;
    const linking = !match.feedMatchId;
    const feedMatchId = linking ? ($('#sp-feed-id').value.trim() || `live-${match.id}`) : null;
    const ok = await attempt(async () => {
      await sendJson('PUT', `/api/sports/matches/${match.id}/feed`, { feedMatchId });
      return true;
    }, linking ? A.feed.linkedToast : A.feed.unlinkedToast);
    if (ok) {
      match.feedMatchId = feedMatchId;
      $('#sp-feed-id').value = '';
      this.renderFeed();
    }
  },

  async createMatch() {
    const created = await attempt(() => sendJson('POST', '/api/sports/matches', {
      title: $('#sp-new-match-title').value.trim(),
      sport: this.sport,
      matchDate: $('#sp-new-match-date').value,
      teamA: $('#sp-new-match-team-a').value.trim(),
      teamB: $('#sp-new-match-team-b').value.trim()
    }), A.sports.matchAdded);

    if (created) {
      for (const id of ['#sp-new-match-title', '#sp-new-match-team-a', '#sp-new-match-team-b']) $(id).value = '';
      this.matches = (await getJson('/api/sports/matches')) ?? [];
      await this.onSportChange();
      $('#sp-match').value = String(created.id);
      await this.onMatchChange();
    }
  },

  async createPlayer() {
    if (!this.match) return toast(A.sports.pickMatchFirst, 'error');
    const created = await attempt(() => sendJson('POST', '/api/sports/players', {
      name: $('#sp-new-player-name').value.trim(),
      team: $('#sp-new-player-team').value,
      role: $('#sp-new-player-role').value.trim()
    }), A.sports.playerAdded);

    if (created) {
      $('#sp-new-player-name').value = '';
      $('#sp-new-player-role').value = '';
      await this.onMatchChange();
      $('#sp-player').value = String(created.id);
      await this.loadEvents();
    }
  },

  async loadEvents() {
    const match = this.match;
    const playerId = this.playerId;
    this.events = match && playerId
      ? ((await getJson(`/api/sports/events/${match.id}/${playerId}`))?.events ?? [])
      : [];
    this.renderEvents();
    this.draw();
  },

  renderEvents() {
    const tbody = $('#sp-events');
    const point = (x, y) => (x == null ? '–' : `${x}, ${y}`);
    if (!this.events.length) {
      tbody.replaceChildren(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, A.sports.noEvents)));
      return;
    }
    tbody.replaceChildren(...[...this.events].reverse().map(e => el('tr', {},
      el('td', {}, num(e.minute)),
      el('td', {}, el('span', { class: 'swatch', style: `background:${EVENT_COLORS[e.eventType] ?? '#fff'}` }), ` ${t.sports.events[e.eventType] ?? e.eventType}`),
      el('td', {}, point(e.x, e.y)),
      el('td', {}, point(e.endX, e.endY)),
      el('td', {}, el('button', { type: 'button', class: 'danger', onclick: () => this.remove(e.id) }, A.remove)))));
  },

  async submit() {
    const match = this.match;
    const playerId = this.playerId;
    const minute = Number($('#sp-minute').value);
    if (!match || !playerId) return toast(A.sports.pickMatchPlayer, 'error');
    if (!this.start) return toast(A.sports.tapPitch, 'error');
    if (!Number.isInteger(minute) || minute < 0) return toast(A.wholeNumber(A.sports.minute), 'error');

    const created = await attempt(() => sendJson('POST', '/api/sports/events', {
      matchId: match.id,
      playerId,
      eventType: $('#sp-type').value,
      x: this.start.x,
      y: this.start.y,
      endX: this.end?.x ?? null,
      endY: this.end?.y ?? null,
      minute
    }), A.sports.added);

    if (created) {
      this.clearPosition();
      await this.loadEvents();
    }
  },

  async remove(id) {
    if (!confirm(A.sports.confirmDelete)) return;
    const ok = await attempt(async () => { await sendJson('DELETE', `/api/sports/events/${id}`); return true; }, A.sports.deleted);
    if (ok) await this.loadEvents();
  },

  clearPosition() {
    this.start = null;
    this.end = null;
    $('#sp-coords').textContent = A.sports.noPosition;
    this.draw();
  },

  // Tap = event position; drag = arrow from the press point to the release point.
  bindPitch() {
    const pointFor = event => {
      const bounds = this.canvas.getBoundingClientRect();
      return fromPx(this.rect, event.clientX - bounds.left, event.clientY - bounds.top);
    };

    this.canvas.addEventListener('pointerdown', event => {
      if (!this.rect) return;
      this.canvas.setPointerCapture(event.pointerId);
      this.dragging = true;
      this.start = pointFor(event);
      this.end = null;
      this.draw();
    });

    this.canvas.addEventListener('pointermove', event => {
      if (!this.dragging) return;
      this.end = pointFor(event);
      this.draw();
    });

    const finish = () => {
      if (!this.dragging) return;
      this.dragging = false;
      // A short drag is a tap with a shaky finger, not an arrow.
      if (this.end && Math.hypot(this.end.x - this.start.x, this.end.y - this.start.y) < 2) this.end = null;
      $('#sp-coords').textContent = this.end
        ? A.sports.fromTo(this.start.x, this.start.y, this.end.x, this.end.y)
        : A.sports.at(this.start.x, this.start.y);
      this.draw();
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', finish);

    new ResizeObserver(() => this.resizePitch()).observe(this.canvas);
  },

  resizePitch() {
    if (!this.canvas.offsetParent) return; // hidden tab: nothing to measure yet
    this.size = fitCanvas(this.canvas);
    this.draw();
  },

  draw() {
    const { w, h } = this.size;
    if (!w || !h) return;
    const ctx = this.canvas.getContext('2d');
    this.rect = surfaceRect(w, h, this.sport, 12);
    ctx.clearRect(0, 0, w, h);
    drawSurface(ctx, this.rect);

    // Existing events, faded, for context.
    ctx.save();
    ctx.globalAlpha = 0.45;
    for (const e of this.events) {
      if (e.x == null) continue;   // live-feed goals/cards have no position
      const p = toPx(this.rect, e.x, e.y);
      if (e.endX != null) drawArrow(ctx, p, toPx(this.rect, e.endX, e.endY), EVENT_COLORS[e.eventType] ?? '#fff', 2);
      dot(ctx, p, 4, EVENT_COLORS[e.eventType] ?? '#fff');
    }
    ctx.restore();

    if (this.start) {
      const color = EVENT_COLORS[$('#sp-type').value] ?? '#fff';
      const p = toPx(this.rect, this.start.x, this.start.y);
      if (this.end) drawArrow(ctx, p, toPx(this.rect, this.end.x, this.end.y), color, 3);
      dot(ctx, p, 7, color, '#0f172a');
    }
  }
};

function dot(ctx, p, radius, fill, stroke) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

$('#sp-sport').addEventListener('change', () => attempt(() => sports.onSportChange()));
$('#sp-match').addEventListener('change', () => attempt(() => sports.onMatchChange()));
$('#sp-new-match-date').value = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
$('#sp-new-match').addEventListener('submit', event => {
  event.preventDefault();
  sports.createMatch();
});
$('#sp-new-player').addEventListener('submit', event => {
  event.preventDefault();
  sports.createPlayer();
});
$('#sp-player').addEventListener('change', () => attempt(() => sports.loadEvents()));
$('#sp-type').addEventListener('change', () => sports.draw());
$('#sp-clear').addEventListener('click', () => sports.clearPosition());
$('#sp-form').addEventListener('submit', event => {
  event.preventDefault();
  sports.submit();
});
$('#sp-show').addEventListener('click', () => {
  const match = sports.match;
  if (!match) return toast(A.sports.pickMatchPlayer, 'error');
  // No player chosen: the whole match goes on air (scoreboard, timeline, spotlight).
  pushState({ activeModule: 'Sports', matchId: match.id, playerId: sports.playerId }, A.sports.onWall);
});

// ---------- live fixtures (providers that publish schedules) ----------

const fixtures = {
  async init() {
    const status = await getJson('/api/sports/feed/status');
    $('#sp-fixtures-card').hidden = !status?.canImport;
    if (!status?.canImport) return;
    fillSelect($('#sp-fixtures-competition'), status.competitions, {
      value: c => c,
      label: c => (A.feed.competitions[c] ? `${A.feed.competitions[c]} (${c})` : c)
    });
    $('#sp-fixtures-note').textContent = A.feed.note(status.provider, status.mediaProvider);
    setChildren($('#sp-fixtures'), el('tr', {}, el('td', { colspan: 4, class: 'muted' }, A.feed.pickCompetition)));
  },

  get competition() {
    return $('#sp-fixtures-competition').value;
  },

  async load() {
    const list = await getJson(`/api/sports/feed/fixtures?competition=${encodeURIComponent(this.competition)}`);
    setChildren($('#sp-fixtures'), list?.length
      ? list.map(f => el('tr', {},
          el('td', {}, kickoff(f.kickoffUtc)),
          el('td', {}, el('span', { class: 'fixture-teams' },
            badge(f.homeBadge, f.homeTeam, 'fx-badge'), el('strong', {}, f.homeTeam),
            el('span', { class: 'muted' }, A.sports.versus),
            el('strong', {}, f.awayTeam), badge(f.awayBadge, f.awayTeam, 'fx-badge'))),
          el('td', {}, [t.sports.status[f.status] ?? f.status,
            f.scoreHome != null ? ` · ${num(f.scoreHome)}–${num(f.scoreAway)}` : ''].join('')),
          el('td', {}, f.matchId
            ? el('button', { type: 'button', class: 'secondary', onclick: () => this.open(f.matchId) }, `${A.feed.imported} · ${A.feed.open}`)
            : el('button', { type: 'button', onclick: () => this.import(f) }, A.feed.importButton))))
      : el('tr', {}, el('td', { colspan: 4, class: 'muted' }, A.feed.noFixtures)));
  },

  async import(fixture) {
    const created = await attempt(
      () => sendJson('POST', '/api/sports/feed/import', { feedMatchId: fixture.feedMatchId, competition: this.competition }),
      match => A.feed.importedToast(match.title));
    if (!created) return;
    await this.open(created.id);
    await this.load();
  },

  /** Select an imported match in the editor above. */
  async open(matchId) {
    sports.matches = (await getJson('/api/sports/matches')) ?? [];
    $('#sp-sport').value = 'Football';
    await sports.onSportChange();
    $('#sp-match').value = String(matchId);
    await sports.onMatchChange();
    $('#sp-match').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

$('#sp-fixtures-load').addEventListener('click', () => attempt(() => fixtures.load()));

// ---------- war editor ----------

const war = {
  zones: [],

  get zone() {
    return this.zones.find(z => String(z.id) === $('#war-zone').value) ?? null;
  },

  async init() {
    this.zones = (await getJson('/api/war/zones')) ?? [];
    fillSelect($('#war-zone'), this.zones, {
      value: z => z.id,
      label: z => z.regionName,
      placeholder: A.war.allZones
    });
    const forces = [...new Set(this.zones.flatMap(z => z.events.map(e => e.controllingForce)))].sort();
    $('#war-forces').replaceChildren(...forces.map(force => el('option', { value: force })));
    this.render();
  },

  render() {
    const zone = this.zone;
    const tbody = $('#war-events');
    $('#war-event-form').hidden = !zone;

    if (!zone) {
      tbody.replaceChildren(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, A.war.pickZoneFirst)));
      return;
    }
    if (!zone.events.length) {
      tbody.replaceChildren(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, A.war.noEvents)));
      return;
    }
    tbody.replaceChildren(...[...zone.events].reverse().map(e => el('tr', {},
      el('td', {}, date(e.date)),
      el('td', {}, e.controllingForce),
      el('td', { class: 'num' }, num(e.casualties)),
      el('td', { class: 'wrap' }, e.description),
      el('td', {}, el('button', { type: 'button', class: 'danger', onclick: () => this.removeEvent(e.id) }, A.remove)))));
  },

  async addEvent() {
    const zone = this.zone;
    const casualties = Number($('#war-event-casualties').value);
    if (!zone) return toast(A.war.pickZone, 'error');
    if (!Number.isInteger(casualties) || casualties < 0) return toast(A.wholeNumber(A.war.casualties), 'error');

    const created = await attempt(() => sendJson('POST', '/api/war/events', {
      conflictZoneId: zone.id,
      date: $('#war-event-date').value,
      controllingForce: $('#war-event-force').value.trim(),
      casualties,
      description: $('#war-event-description').value.trim()
    }), A.war.added);

    if (created) {
      $('#war-event-casualties').value = '0';
      $('#war-event-description').value = '';
      await this.init();
    }
  },

  async removeEvent(id) {
    if (!confirm(A.war.confirmDelete)) return;
    const ok = await attempt(async () => { await sendJson('DELETE', `/api/war/events/${id}`); return true; }, A.war.deleted);
    if (ok) await this.init();
  },

  async addZone() {
    const created = await attempt(() => sendJson('POST', '/api/war/zones', {
      regionName: $('#war-zone-name').value.trim(),
      svgPathId: $('#war-zone-path').value.trim()
    }), A.war.zoneAdded);

    if (created) {
      $('#war-zone-name').value = '';
      $('#war-zone-path').value = '';
      await this.init();
      $('#war-zone').value = String(created.id);
      this.render();
    }
  }
};

$('#war-zone').addEventListener('change', () => war.render());
$('#war-event-date').value = new Date().toISOString().slice(0, 10);   // most entries are today's news

$('#war-focus').addEventListener('submit', event => {
  event.preventDefault();
  const zone = war.zone;
  pushState(
    { activeModule: 'War', regionName: zone?.regionName ?? null, date: $('#war-date').value || null },
    zone ? A.onWall(zone.regionName) : A.war.trackerOnAir);
});

$('#war-event-form').addEventListener('submit', event => {
  event.preventDefault();
  war.addEvent();
});

$('#war-zone-form').addEventListener('submit', event => {
  event.preventDefault();
  war.addZone();
});

// ---------- budget editor ----------

/** Parses a non-negative number field; returns null (after a toast) when invalid. */
function readAmount(input, label, max = Infinity) {
  const value = Number(input.value);
  if (input.value.trim() === '' || !Number.isFinite(value) || value < 0 || value > max) {
    toast(max === Infinity ? A.atLeastZero(label) : A.between(label, max), 'error');
    return null;
  }
  return value;
}

const budget = {
  sectors: [],

  get year() {
    return $('#budget-year').value || null;
  },

  get sector() {
    return this.sectors.find(s => String(s.id) === $('#budget-project-sector').value) ?? null;
  },

  async init() {
    const years = (await getJson('/api/budget/fiscal-years')) ?? [];
    fillSelect($('#budget-year'), years, { value: y => y, label: y => y, placeholder: years.length ? null : A.budget.noBudget });
    await this.loadSectors();
  },

  async loadSectors() {
    const year = this.year;
    this.sectors = year ? ((await getJson(`/api/budget/sectors?fiscalYear=${encodeURIComponent(year)}`)) ?? []) : [];
    if (year && !$('#budget-sector-year').value) $('#budget-sector-year').value = year;

    fillSelect($('#budget-project-sector'), this.sectors, {
      value: s => s.id,
      label: s => s.name,
      placeholder: this.sectors.length ? null : A.budget.addSectorFirst
    });
    this.renderSectors();
    this.renderProjects();
  },

  renderSectors() {
    const tbody = $('#budget-sectors');
    if (!this.sectors.length) {
      tbody.replaceChildren(el('tr', {}, el('td', { colspan: 4, class: 'muted' }, A.budget.noSectors)));
      return;
    }
    tbody.replaceChildren(...this.sectors.map(sector => {
      const allocation = el('input', { type: 'number', min: 0, step: 'any', value: sector.totalAllocation, 'aria-label': A.budget.allocationFor(sector.name) });
      return el('tr', {},
        el('td', {}, sector.name),
        el('td', { class: 'num' }, allocation),
        el('td', { class: 'num' }, num(sector.megaProjects.length)),
        el('td', {}, el('button', { type: 'button', onclick: () => this.saveSector(sector, allocation) }, A.save)));
    }));
  },

  renderProjects() {
    const sector = this.sector;
    const tbody = $('#budget-projects');
    $('#budget-project-form').hidden = !sector;

    if (!sector) {
      tbody.replaceChildren(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, A.budget.pickSector)));
      return;
    }
    if (!sector.megaProjects.length) {
      tbody.replaceChildren(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, A.budget.noProjects)));
      return;
    }
    tbody.replaceChildren(...sector.megaProjects.map(project => {
      const inputs = {
        amount: el('input', { type: 'number', min: 0, step: 'any', value: project.budgetAmount, 'aria-label': A.budget.amountFor(project.name) }),
        completion: el('input', { type: 'number', min: 0, max: 100, step: 'any', value: project.completionPercentage, 'aria-label': A.budget.completionFor(project.name) }),
        location: el('input', { type: 'text', maxlength: 100, value: project.geoLocation, 'aria-label': A.budget.locationFor(project.name) })
      };
      return el('tr', {},
        el('td', {}, project.name),
        el('td', { class: 'num' }, inputs.amount),
        el('td', { class: 'num' }, inputs.completion),
        el('td', {}, inputs.location),
        el('td', {}, el('div', { class: 'actions' },
          el('button', { type: 'button', onclick: () => this.saveProject(sector, project, inputs) }, A.save),
          el('button', { type: 'button', class: 'danger', onclick: () => this.removeProject(project) }, A.remove))));
    }));
  },

  async saveSector(sector, input) {
    const totalAllocation = readAmount(input, A.budget.allocation);
    if (totalAllocation === null) return;
    const ok = await attempt(async () => {
      await sendJson('PUT', `/api/budget/sectors/${sector.id}`, { name: sector.name, fiscalYear: sector.fiscalYear, totalAllocation });
      return true;
    }, A.budget.allocationSaved);
    if (ok) await this.loadSectors();
  },

  async addSector() {
    const totalAllocation = readAmount($('#budget-sector-allocation'), A.budget.allocation);
    if (totalAllocation === null) return;
    const fiscalYear = $('#budget-sector-year').value.trim();

    const created = await attempt(() => sendJson('POST', '/api/budget/sectors', {
      name: $('#budget-sector-name').value.trim(),
      fiscalYear,
      totalAllocation
    }), A.budget.sectorAdded);

    if (created) {
      $('#budget-sector-name').value = '';
      $('#budget-sector-allocation').value = '0';
      await this.init();
      $('#budget-year').value = fiscalYear;   // a new fiscal year appears in the list; switch to it
      await this.loadSectors();
    }
  },

  async saveProject(sector, project, inputs) {
    const budgetAmount = readAmount(inputs.amount, A.budget.amount);
    const completionPercentage = budgetAmount === null ? null : readAmount(inputs.completion, A.budget.completion, 100);
    if (budgetAmount === null || completionPercentage === null) return;

    const ok = await attempt(async () => {
      await sendJson('PUT', `/api/budget/projects/${project.id}`, {
        budgetSectorId: sector.id,
        name: project.name,
        budgetAmount,
        completionPercentage,
        geoLocation: inputs.location.value.trim()
      });
      return true;
    }, A.budget.projectSaved);
    if (ok) await this.loadSectors();
  },

  async addProject() {
    const sector = this.sector;
    if (!sector) return toast(A.budget.pickSectorFirst, 'error');
    const budgetAmount = readAmount($('#budget-project-amount'), A.budget.amount);
    const completionPercentage = budgetAmount === null ? null : readAmount($('#budget-project-completion'), A.budget.completion, 100);
    if (budgetAmount === null || completionPercentage === null) return;

    const created = await attempt(() => sendJson('POST', '/api/budget/projects', {
      budgetSectorId: sector.id,
      name: $('#budget-project-name').value.trim(),
      budgetAmount,
      completionPercentage,
      geoLocation: $('#budget-project-location').value.trim()
    }), A.budget.projectAdded);

    if (created) {
      for (const id of ['#budget-project-name', '#budget-project-location']) $(id).value = '';
      $('#budget-project-amount').value = '0';
      $('#budget-project-completion').value = '0';
      await this.loadSectors();
    }
  },

  async removeProject(project) {
    if (!confirm(A.budget.confirmDelete(project.name))) return;
    const ok = await attempt(async () => { await sendJson('DELETE', `/api/budget/projects/${project.id}`); return true; }, A.budget.projectDeleted);
    if (ok) await this.loadSectors();
  }
};

$('#budget-year').addEventListener('change', () => {
  $('#budget-sector-year').value = budget.year ?? '';
  attempt(() => budget.loadSectors());
});
$('#budget-project-sector').addEventListener('change', () => budget.renderProjects());
$('#budget-show').addEventListener('click', () =>
  pushState({ activeModule: 'Budget', fiscalYear: budget.year }, A.budget.onAir(budget.year)));
$('#budget-sector-form').addEventListener('submit', event => {
  event.preventDefault();
  budget.addSector();
});
$('#budget-project-form').addEventListener('submit', event => {
  event.preventDefault();
  budget.addProject();
});

$('#sp-feed-toggle').addEventListener('click', () => sports.toggleFeed());

// ---------- sign-in & capabilities ----------

let me = null;
let feedData = null;
let electionQueue = null;
let sportsQueue = null;
let fieldForm = null;

/**
 * Shows only what this user may do. Every [data-cap] element needs that capability;
 * "FieldOnly" = may submit election figures but not review them (the field reporter's view).
 */
function applyCapabilities(user) {
  const caps = new Set(user.capabilities);
  if (caps.has('SubmitElection') && !caps.has('ReviewElection')) caps.add('FieldOnly');
  for (const node of document.querySelectorAll('[data-cap]')) node.hidden = !caps.has(node.dataset.cap);
  for (const group of document.querySelectorAll('.tab-group')) group.hidden = !group.querySelector('[data-tab]:not([hidden])');
  document.body.classList.toggle('no-sidebar', !caps.has('ControlWall'));
  document.body.classList.toggle('field-mode', caps.has('FieldOnly'));
  $('#user-name').textContent = user.displayName;
  $('#user-role').textContent = A.roles[user.role] ?? user.role;
  return caps;
}

function showLogin(message) {
  $('#app').hidden = true;
  $('#login-screen').hidden = false;
  $('#login-error').textContent = message ?? '';
  $('#login-error').hidden = !message;
  $(($('#login-user').value ? '#login-password' : '#login-user')).focus();
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#login-submit');
  button.disabled = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: $('#login-user').value.trim(), password: $('#login-password').value })
    });
    if (!res.ok) {
      showLogin(res.status === 429 ? A.login.tooMany : A.login.failed);
      return;
    }
    const user = await res.json();
    $('#login-password').value = '';
    if (me && me.userName !== user.userName) {
      location.reload();   // someone else signed in: start clean, with none of the previous user's data
    } else if (me) {
      $('#login-screen').hidden = true;   // same user after an expired session: carry on
      $('#app').hidden = false;
    } else {
      await startApp(user);
    }
  } catch {
    showLogin(A.login.offline);
  } finally {
    button.disabled = false;
  }
});

$('#logout').addEventListener('click', async () => {
  await flushPending();   // an approval still in its undo window goes out first, while we're signed in
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();   // nothing of this user's session stays in memory
});

window.addEventListener(UNAUTHORIZED_EVENT, () => showLogin(A.login.expired));

// ---------- live wall preview ----------

// The iframe renders the real wall at 1920x1080; scale it to fill its box.
const preview = $('#preview');
const previewFrame = preview.querySelector('iframe');
new ResizeObserver(() => {
  previewFrame.style.transform = `scale(${preview.clientWidth / 1920})`;
}).observe(preview);

/** Loads the preview wall once. On phones that waits until the drawer is opened: it's a whole second wall. */
function loadPreview() {
  if (!previewFrame.getAttribute('src')) previewFrame.src = previewFrame.dataset.src;
}

// ---------- live sync ----------

function onDataChanged({ module, key }) {
  // Seeing this right after a save proves the server saved it AND broadcast it to every screen.
  console.log(`[admin] server broadcast DataChanged: ${module} / ${key}`);
  // Another producer edited what this screen is showing: refresh it.
  if (module === 'Election' && election.current?.svgPathId === key) attempt(() => election.load(key));
  if (module === 'Sports' && key === `${sports.match?.id}:${sports.playerId}`) attempt(() => sports.loadEvents());
  if (module === 'Sports' && feedData && !document.querySelector('[data-panel="FeedData"]').hidden) attempt(() => feedData.refresh());
  if (module === 'War') attempt(() => war.init());
  if (module === 'Budget') attempt(() => budget.init());
}

const STATUS_LABELS = A.status;

function startHub() {
  connectHub({
    tag: 'admin',
    on: {
      StateChanged: state => {
        console.log(`[admin] server broadcast StateChanged: ${state.activeModule}`, state);
        setWallState(state);
      },
      DataChanged: onDataChanged,
      // A submission arrived, the feed queued events, or someone approved/rejected: refresh queues live.
      QueueChanged: ({ module, pending }) => {
        console.log(`[admin] server broadcast QueueChanged: ${module} (${pending} pending)`);
        if (module === 'Election') {
          electionQueue?.refresh();
          fieldForm?.refreshMine();
        }
        if (module === 'Sports') sportsQueue?.refresh();
      }
    },
    onStatus: status => {
      const node = $('#hub-status');
      node.dataset.status = status;
      node.textContent = STATUS_LABELS[status] ?? status;
    },
    onConnected: () => attempt(async () => setWallState(await getJson('/api/wall/state')))
  });
}

// ---------- start ----------

// Opening the dashboard mid-show lands the editors on whatever is live.
async function focusEditorsOn(state) {
  const hasOption = (select, value) => [...select.options].some(o => o.value === value);

  const constituency = $('#el-constituency');
  if (state.svgPathId && hasOption(constituency, state.svgPathId)) {
    constituency.value = state.svgPathId;
    await election.load(state.svgPathId);
  }

  const liveMatch = sports.matches.find(m => m.id === state.matchId);
  if (liveMatch) {
    $('#sp-sport').value = liveMatch.sport;
    await sports.onSportChange();
    $('#sp-match').value = String(liveMatch.id);
    await sports.onMatchChange();
    const player = $('#sp-player');
    if (state.playerId && hasOption(player, String(state.playerId))) {
      player.value = String(state.playerId);
      await sports.loadEvents();
    }
  }

  const zone = war.zones.find(z => z.regionName.toLowerCase() === state.regionName?.toLowerCase());
  if (zone) {
    $('#war-zone').value = String(zone.id);
    war.render();
  }
  if (state.date) $('#war-date').value = state.date;

  const year = $('#budget-year');
  if (state.fiscalYear && hasOption(year, state.fiscalYear)) {
    year.value = state.fiscalYear;
    await budget.loadSectors();
  }
}

async function startApp(user) {
  me = user;
  const caps = applyCapabilities(user);
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  console.log(`[admin] signed in as ${user.userName} (${user.role}); capabilities: ${user.capabilities.join(', ')}`);

  const setBadge = (selector, n) => {
    const badge = $(selector);
    badge.textContent = num(n);
    badge.hidden = n === 0;
  };

  // Load only what this user can use.
  const jobs = [];
  if (caps.has('FieldOnly')) {
    fieldForm = createFieldForm();
    jobs.push(attempt(() => fieldForm.init()));
  }
  if (caps.has('ReviewElection')) {
    electionQueue = createElectionQueue(me, { onCount: n => setBadge('#badge-election', n) });
    jobs.push(attempt(() => electionQueue.refresh()));
  }
  if (caps.has('ManageSports')) {
    sportsQueue = createSportsQueue({ onCount: n => setBadge('#badge-sports', n) });
    feedData = createFeedData();
    jobs.push(attempt(() => sportsQueue.refresh()), attempt(() => sports.init()), attempt(() => fixtures.init()), attempt(() => feedData.refresh()));
  }
  if (caps.has('EditDesk')) {
    jobs.push(attempt(() => election.init()), attempt(() => war.init()), attempt(() => budget.init()));
  }
  if (caps.has('ManageUsers')) {
    const settings = createSettingsPanel(me);
    jobs.push(attempt(() => settings.init()));
  }

  const initial = await attempt(() => getJson('/api/wall/state'));
  if (initial) setWallState(initial);
  // Back where this person was (e.g. after switching language), else where their work is:
  // the form, the review queue, or the module on air.
  let savedTab = null;
  try { savedTab = sessionStorage.getItem(TAB_KEY); } catch { /* none */ }
  showTab(savedTab && allowedTab(savedTab) ? savedTab
    : caps.has('FieldOnly') ? 'Submit'
    : caps.has('ReviewElection') ? 'ElectionQueue'
    : caps.has('ManageSports') ? 'SportsQueue'
    : initial?.activeModule);

  await Promise.all(jobs);
  if (initial && caps.has('ControlWall')) await attempt(() => focusEditorsOn(initial));
  // The live preview is a whole second wall: only load it for people who see the sidebar
  // (and on phones only once they open the drawer).
  startHub();
}

// ---------- boot: signed in already (cookie), or show the login screen ----------

const current = await fetch('/api/auth/me').then(r => (r.ok ? r.json() : null)).catch(() => null);
if (current) await startApp(current);
else showLogin();
