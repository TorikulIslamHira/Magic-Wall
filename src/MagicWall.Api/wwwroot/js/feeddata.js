// Feed data (sports desk): what the live providers brought in — matches, teams and badges,
// players and photos, and the raw provider answer — visible and correctable directly, without
// the approval queue (that queue is for events that go on air; this is reference data).
import { getJson, sendJson } from './api.js';
import { el, setChildren } from './dom.js';
import { $, attempt, fillSelect, toast } from './admin-ui.js';
import { ago, num, parseUtc, t } from './i18n.js';

const A = t.admin;
const D = A.data;

/** A team badge, or its initial in a disc when there's none yet. */
export function badge(url, name, cls = 'mh-badge') {
  return url
    ? el('img', { class: cls, src: url, alt: '' })
    : el('span', { class: `${cls} is-empty`, 'aria-hidden': 'true' }, (name || '?').slice(0, 1));
}

/** "[badge] Arsenal 3 – 1 Chelsea [badge] · Live": the match as a header, used across the dashboard. */
export function matchHeader(m) {
  const hasScore = m.scoreA != null && m.scoreB != null;
  return el('div', { class: 'match-head-inner' },
    el('span', { class: 'mh-team' }, badge(m.teamABadge, m.teamA), el('strong', {}, m.teamA)),
    el('span', { class: 'mh-score' }, hasScore ? `${num(m.scoreA)} – ${num(m.scoreB)}` : A.sports.versus),
    el('span', { class: 'mh-team is-away' }, el('strong', {}, m.teamB), badge(m.teamBBadge, m.teamB)),
    m.feedStatus ? el('span', { class: `mh-status${['IN_PLAY', 'PAUSED', 'LIVE'].includes(m.feedStatus) ? ' is-live' : ''}` },
      t.sports.status[m.feedStatus] ?? m.feedStatus) : null);
}

/** A UTC timestamp as the value of a datetime-local input (the viewer's local time). */
const toLocalInput = value => {
  const d = parseUtc(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const hostOf = url => { try { return new URL(url).host; } catch { return url; } };

export function createFeedData() {
  const select = $('#dt-match-select');
  let data = null;

  const current = () => data?.matches.find(m => String(m.id) === select.value) ?? null;

  async function refresh() {
    data = await getJson('/api/sports/data');
    const matches = data?.matches ?? [];
    fillSelect(select, matches, {
      value: m => m.id,
      label: m => [m.title, m.competition].filter(Boolean).join(' · '),
      placeholder: matches.length ? null : D.noMatches
    });
    renderTeams();
    await renderMatch();
  }

  // ---------- the chosen match ----------

  async function renderMatch() {
    const m = current();
    if (!m) {
      setChildren($('#dt-match'), el('p', { class: 'empty' }, D.noMatches));
      setChildren($('#dt-players'), el('tr', {}, el('td', { colspan: 7, class: 'muted' }, D.noPlayers)));
      return;
    }
    const linked = Boolean(m.feedMatchId);

    const title = el('input', { type: 'text', value: m.title, maxlength: 200, required: true });
    const competition = el('input', { type: 'text', value: m.competition ?? '', maxlength: 100 });
    const kickoff = el('input', { type: 'datetime-local', value: toLocalInput(m.matchDate), required: true });
    const score = (value, team) => el('input', {
      type: 'number', min: 0, max: 999, step: 1, value: value ?? '', disabled: linked,
      'aria-label': D.score(team), title: linked ? D.feedOwned : null
    });
    const scoreA = score(m.scoreA, m.teamA);
    const scoreB = score(m.scoreB, m.teamB);

    const form = el('form', { class: 'data-form' },
      el('label', {}, D.title, title),
      el('label', {}, D.competition, competition),
      el('label', {}, D.kickoff, kickoff),
      el('div', { class: 'data-score' },
        el('label', {}, D.score(m.teamA), scoreA),
        el('label', {}, D.score(m.teamB), scoreB),
        el('p', { class: 'hint' }, linked ? D.feedOwned : D.manualScore)),
      el('div', { class: 'button-row' }, el('button', { type: 'submit' }, A.save)));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const toScore = input => (input.value === '' ? null : Number(input.value));
      const ok = await attempt(async () => {
        await sendJson('PUT', `/api/sports/data/matches/${m.id}`, {
          title: title.value.trim(),
          competition: competition.value.trim() || null,
          matchDate: new Date(kickoff.value).toISOString(),
          scoreA: toScore(scoreA),
          scoreB: toScore(scoreB)
        });
        return true;
      }, D.matchSaved);
      if (ok) await refresh();
    });

    const raw = el('pre', { class: 'raw-json', hidden: true });
    const rawButton = el('button', { type: 'button', class: 'secondary', hidden: !linked }, D.raw);
    rawButton.addEventListener('click', async () => {
      if (!raw.hidden) {
        raw.hidden = true;
        rawButton.textContent = D.raw;
        return;
      }
      const payload = await attempt(() => getJson(`/api/sports/data/raw/${m.id}`));
      if (payload === undefined) return;   // error already shown
      setChildren(raw, payload
        ? [el('strong', {}, D.rawTitle(payload.provider, ago(payload.fetchedAt))), '\n\n', prettyJson(payload.json)]
        : D.noRaw);
      raw.hidden = false;
      rawButton.textContent = D.hideRaw;
    });

    setChildren($('#dt-match'),
      el('div', { class: 'match-head' }, matchHeader(m)),
      el('p', { class: 'data-meta' },
        [linked ? `${A.data.source}: ${m.feedMatchId}` : D.manual,
         D.updated(m.feedUpdatedAt ? ago(m.feedUpdatedAt) : D.never),
         D.events(m.approvedEvents, m.pendingEvents)].join(' · ')),
      form,
      rawButton,
      raw);

    await renderPlayers(m);
  }

  async function renderPlayers(m) {
    const players = (await getJson(`/api/sports/data/players?matchId=${m.id}`)) ?? [];
    setChildren($('#dt-players'), players.length ? players.map(p => {
      const name = el('input', { type: 'text', value: p.name, maxlength: 150, 'aria-label': A.users.displayNameOf(p.name) });
      const role = el('input', { type: 'text', value: p.role, maxlength: 50, 'aria-label': A.users.roleOf(p.name) });
      const save = el('button', { type: 'button', class: 'primary', disabled: true }, A.save);
      const dirty = () => { save.disabled = name.value.trim() === p.name && role.value.trim() === p.role || !name.value.trim(); };
      name.addEventListener('input', dirty);
      role.addEventListener('input', dirty);
      save.addEventListener('click', async () => {
        const ok = await attempt(async () => {
          await sendJson('PUT', `/api/sports/data/players/${p.id}`, { name: name.value.trim(), role: role.value.trim() });
          return true;
        }, D.playerSaved(name.value.trim()));
        if (ok) await renderPlayers(m);
      });
      const refetch = el('button', { type: 'button', class: 'secondary' }, D.refetch);
      refetch.addEventListener('click', async () => {
        const ok = await attempt(async () => { await sendJson('POST', `/api/sports/data/players/${p.id}/refresh-photo`); return true; }, D.photoRefresh(p.name));
        if (ok) await renderPlayers(m);
      });
      return el('tr', {},
        el('td', {}, p.photo ? el('img', { class: 'data-photo', src: p.photo, alt: '' }) : el('span', { class: 'data-photo is-empty', title: p.mediaCheckedAt ? D.noPicture : D.notChecked }, '—')),
        el('td', {}, name),
        el('td', {}, p.team),
        el('td', {}, role),
        el('td', {}, p.externalId ? el('code', {}, p.externalId) : el('span', { class: 'muted' }, D.manual),
          p.photoSource ? el('small', { class: 'data-source', title: p.photoSource }, `${D.source}: ${hostOf(p.photoSource)}`) : null),
        el('td', { class: 'num' }, num(p.events)),
        el('td', {}, el('div', { class: 'actions' }, save, refetch)));
    }) : el('tr', {}, el('td', { colspan: 7, class: 'muted' }, D.noPlayers)));
  }

  // ---------- teams & badges ----------

  function renderTeams() {
    const teams = data?.teams ?? [];
    setChildren($('#dt-teams'), teams.length ? teams.map(team => {
      const nameCell = el('td', {}, el('strong', {}, team.team));
      const rename = el('button', { type: 'button', class: 'secondary' }, D.rename);
      rename.addEventListener('click', () => {
        const input = el('input', { type: 'text', value: team.team, maxlength: 100, 'aria-label': D.renamePrompt(team.team) });
        const ok = el('button', { type: 'button' }, A.save);
        const cancel = el('button', { type: 'button', class: 'secondary' }, A.users.cancel);
        setChildren(nameCell, el('div', { class: 'rename-row' }, input, ok, cancel));
        input.focus();
        input.select();
        cancel.addEventListener('click', renderTeams);
        ok.addEventListener('click', async () => {
          const to = input.value.trim();
          if (!to || to === team.team) return renderTeams();
          if (!confirm(D.confirmRename(team.team, to))) return;
          const done = await attempt(async () => {
            await sendJson('POST', '/api/sports/data/teams/rename', { from: team.team, to });
            return true;
          }, D.teamRenamed(team.team, to));
          if (done) await refresh();
        });
      });
      const refetch = el('button', { type: 'button', class: 'secondary' }, D.refetch);
      refetch.addEventListener('click', async () => {
        const ok = await attempt(async () => { await sendJson('POST', '/api/sports/data/teams/refresh-badge', { team: team.team }); return true; }, D.badgeRefresh(team.team));
        if (ok) await refresh();
      });
      return el('tr', {},
        el('td', {}, badge(team.badge, team.team, 'data-badge')),
        nameCell,
        el('td', { class: 'num' }, num(team.matches)),
        el('td', { class: 'num' }, num(team.players)),
        el('td', {}, team.badgeSource
          ? el('small', { class: 'data-source', title: team.badgeSource }, hostOf(team.badgeSource))
          : el('small', { class: 'muted' }, team.checkedAt ? D.noPicture : D.notChecked)),
        el('td', {}, el('div', { class: 'actions' }, rename, refetch)));
    }) : el('tr', {}, el('td', { colspan: 6, class: 'muted' }, D.noMatches)));
  }

  select.addEventListener('change', () => attempt(() => renderMatch()));

  return { refresh };
}

/** The provider's JSON, indented for reading (as it came, if it isn't valid JSON). */
function prettyJson(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}
