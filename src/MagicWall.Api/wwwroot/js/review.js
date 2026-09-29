// Approval queues (the "checker" side of maker-checker).
//  - Election: field reporters' vote submissions, old → new, approve / reject with reason.
//  - Sports: events fetched by the live feed, previewed on a mini pitch, approved in bulk.
// Both refresh live when the server broadcasts QueueChanged.
import { getJson, sendJson } from './api.js';
import { el, setChildren } from './dom.js';
import { $, attempt, fillSelect, statusChip } from './admin-ui.js';
import { ago, num, t } from './i18n.js';
import { EVENT_COLORS, drawArrow, drawSurface, fitCanvas, surfaceRect, toPx } from './pitch.js';

const A = t.admin;

// ---------- election ----------

export function createElectionQueue(me, { onCount }) {
  const list = $('#eq-list');
  const recent = $('#eq-recent');

  async function refresh() {
    const all = (await getJson('/api/election/submissions')) ?? [];
    const pending = all.filter(s => s.status === 'Pending');
    onCount(pending.length);
    $('#eq-count').textContent = num(pending.length);
    setChildren(list, pending.length ? pending.map(card) : el('p', { class: 'empty' }, A.queue.emptyElection));

    const decided = all.filter(s => s.status !== 'Pending').slice(0, 15);
    setChildren(recent, decided.length ? decided.map(recentRow) : el('li', { class: 'empty' }, A.queue.noRecent));
  }

  function card(s) {
    const own = s.submittedBy === me.userName;
    const delta = s.previousVotes == null ? null : s.votesReceived - s.previousVotes;

    const reason = el('input', { type: 'text', maxlength: 500, class: 'reason-input', placeholder: A.queue.reasonPlaceholder, 'aria-label': A.queue.reasonPlaceholder });
    const rejectRow = el('div', { class: 'reject-row', hidden: true },
      reason,
      el('button', { type: 'button', class: 'danger', onclick: () => reject(s.id, reason.value) }, A.queue.confirmReject),
      el('button', { type: 'button', class: 'secondary', onclick: () => { rejectRow.hidden = true; } }, A.queue.cancel));
    reason.addEventListener('keydown', event => { if (event.key === 'Enter') reject(s.id, reason.value); });

    return el('article', { class: `queue-card${delta != null && delta < 0 ? ' is-warning' : ''}` },
      el('header', { class: 'queue-card-head' },
        el('div', {},
          el('h3', {}, s.constituencyName),
          el('p', { class: 'muted' }, `${s.candidateName} · ${s.partyName}`)),
        el('span', { class: 'queue-when' }, ago(s.submittedAt))),
      el('div', { class: 'vote-change' },
        el('span', { class: 'vote-old' }, s.previousVotes == null ? A.queue.firstCount : num(s.previousVotes)),
        el('span', { class: 'vote-arrow', 'aria-hidden': 'true' }, '→'),
        el('span', { class: 'vote-new' }, num(s.votesReceived)),
        delta == null ? null : el('span', { class: `vote-delta ${delta < 0 ? 'down' : 'up'}` }, `${delta < 0 ? '−' : '+'}${num(Math.abs(delta))}`)),
      delta != null && delta < 0 ? el('p', { class: 'queue-warning' }, `⚠ ${A.queue.decreased}`) : null,
      s.note ? el('p', { class: 'queue-note' }, `“${s.note}”`) : null,
      el('p', { class: 'queue-meta' }, A.queue.submittedBy(s.submittedByName, ago(s.submittedAt))),
      el('div', { class: 'queue-actions' },
        el('button', { type: 'button', disabled: own, title: own ? A.queue.ownItem : null, onclick: () => approve(s.id) }, `✓ ${A.queue.approve}`),
        el('button', { type: 'button', class: 'danger', onclick: () => { rejectRow.hidden = false; reason.focus(); } }, `✕ ${A.queue.reject}`)),
      own ? el('p', { class: 'queue-meta' }, A.queue.ownItem) : null,
      rejectRow);
  }

  function recentRow(s) {
    return el('li', { class: 'recent-row' },
      statusChip(s.status, A.statuses[s.status] ?? s.status),
      el('span', { class: 'recent-text' },
        `${s.constituencyName} · ${s.candidateName}: ${num(s.votesReceived)}`,
        el('small', {}, A.queue.reviewedBy(s.reviewedByName ?? '', s.reviewedAt ? ago(s.reviewedAt) : ''))),
      s.reviewNote ? el('span', { class: 'recent-note' }, s.reviewNote) : null);
  }

  async function approve(id) {
    const ok = await attempt(() => sendJson('POST', `/api/election/submissions/${id}/approve`, {}), A.queue.approved);
    if (ok) await refresh();
  }

  async function reject(id, note) {
    const ok = await attempt(() => sendJson('POST', `/api/election/submissions/${id}/reject`, { note: note.trim() }), A.queue.rejected);
    if (ok) await refresh();
  }

  return { refresh };
}

// ---------- sports ----------

export function createSportsQueue({ onCount }) {
  const canvas = $('#sq-pitch');
  const list = $('#sq-list');
  const matchSelect = $('#sq-match');
  const approveButton = $('#sq-approve');
  const rejectButton = $('#sq-reject');
  const selectAll = $('#sq-select-all');

  let items = [];
  let selected = new Set();
  let hovered = null;
  let size = { w: 0, h: 0 };

  const visible = () => items.filter(e => String(e.matchId) === matchSelect.value);

  async function refresh() {
    items = (await getJson('/api/sports/queue?status=Pending')) ?? [];
    onCount(items.length);
    $('#sq-count').textContent = num(items.length);

    const matches = [...new Map(items.map(e => [e.matchId, e])).values()];
    fillSelect(matchSelect, matches, {
      value: e => e.matchId,
      label: e => `${t.sports.sports[e.sport] ?? e.sport} · ${e.matchTitle} (${num(items.filter(i => i.matchId === e.matchId).length)})`
    });
    if (!matchSelect.value && matches[0]) matchSelect.value = String(matches[0].matchId);

    const stillThere = new Set(items.map(e => e.id));
    selected = new Set([...selected].filter(id => stillThere.has(id)));
    render();
  }

  function render() {
    const rows = visible();
    if (!rows.length) {
      setChildren(list, el('tr', {}, el('td', { colspan: 6, class: 'muted' }, A.queue.emptySports)));
    } else {
      setChildren(list, rows.map(e => {
        const box = el('input', { type: 'checkbox', 'aria-label': `${e.playerName} ${e.minute}'` });
        box.checked = selected.has(e.id);
        box.addEventListener('change', () => { box.checked ? selected.add(e.id) : selected.delete(e.id); updateButtons(); draw(); });
        const row = el('tr', { class: selected.has(e.id) ? 'is-selected' : null },
          el('td', {}, box),
          el('td', { class: 'num' }, num(e.minute)),
          el('td', {}, el('span', { class: 'swatch', style: `background:${EVENT_COLORS[e.eventType] ?? '#fff'}` }), ` ${t.sports.events[e.eventType] ?? e.eventType}`),
          el('td', {}, e.playerName, el('small', { class: 'muted' }, ` · ${e.team}`)),
          el('td', {}, e.endX == null ? `${e.x}, ${e.y}` : `${e.x}, ${e.y} → ${e.endX}, ${e.endY}`),
          el('td', { class: 'muted' }, ago(e.submittedAt)));
        row.addEventListener('mouseenter', () => { hovered = e.id; draw(); });
        row.addEventListener('mouseleave', () => { hovered = null; draw(); });
        return row;
      }));
    }
    selectAll.checked = rows.length > 0 && rows.every(e => selected.has(e.id));
    updateButtons();
    draw();
  }

  function updateButtons() {
    const n = visible().filter(e => selected.has(e.id)).length;
    approveButton.textContent = `✓ ${A.queue.approveSelected(n)}`;
    rejectButton.textContent = `✕ ${A.queue.rejectSelected(n)}`;
    approveButton.disabled = rejectButton.disabled = n === 0;
    for (const row of list.querySelectorAll('tr')) {
      const box = row.querySelector('input[type=checkbox]');
      if (box) row.classList.toggle('is-selected', box.checked);
    }
  }

  // Pending events of the chosen match: selected/hovered ones bright, the rest faded.
  function draw() {
    if (!size.w) return;
    const rows = visible();
    const ctx = canvas.getContext('2d');
    const rect = surfaceRect(size.w, size.h, rows[0]?.sport ?? 'Football', 12);
    ctx.clearRect(0, 0, size.w, size.h);
    drawSurface(ctx, rect);
    for (const e of rows) {
      const focus = e.id === hovered || selected.has(e.id);
      ctx.save();
      ctx.globalAlpha = focus || selected.size === 0 ? 1 : 0.35;
      const p = toPx(rect, e.x, e.y);
      const color = EVENT_COLORS[e.eventType] ?? '#fff';
      if (e.endX != null) drawArrow(ctx, p, toPx(rect, e.endX, e.endY), color, focus ? 3 : 2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, e.id === hovered ? 9 : 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = e.id === hovered ? '#fff' : 'rgba(15, 23, 42, 0.9)';
      ctx.stroke();
      ctx.restore();
    }
  }

  async function review(action) {
    const ids = visible().filter(e => selected.has(e.id)).map(e => e.id);
    if (!ids.length) return;
    const result = await attempt(() => sendJson('POST', `/api/sports/queue/${action}`, { ids }),
      r => (action === 'approve' ? A.queue.bulkApproved(r.updated) : A.queue.bulkRejected(r.updated)));
    if (result) {
      ids.forEach(id => selected.delete(id));
      await refresh();
    }
  }

  matchSelect.addEventListener('change', () => { selected.clear(); render(); });
  selectAll.addEventListener('change', () => {
    for (const e of visible()) selectAll.checked ? selected.add(e.id) : selected.delete(e.id);
    render();
  });
  approveButton.addEventListener('click', () => review('approve'));
  rejectButton.addEventListener('click', () => review('reject'));
  new ResizeObserver(() => {
    if (!canvas.offsetParent) return;
    size = fitCanvas(canvas);
    draw();
  }).observe(canvas);

  return { refresh };
}
