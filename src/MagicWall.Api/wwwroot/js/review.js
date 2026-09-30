// Approval queues (the "checker" side of maker-checker). Both work the same way: a table with a
// checkbox per row, a bulk bar (sticky once something is selected), per-row actions, and a few
// seconds to undo before an approval or rejection is actually sent (see deferWithUndo).
//  - Election: field reporters' counts, grouped by seat + candidate (the latest count is what
//    gets approved; the server marks older pending counts for that pair as superseded).
//  - Sports: events fetched by the live feed, previewed on a mini pitch.
// Both refresh live when the server broadcasts QueueChanged.
import { getJson, sendJson } from './api.js';
import { el, setChildren } from './dom.js';
import { $, deferWithUndo, fillSelect, statusChip, toast } from './admin-ui.js';
import { ago, formatDetail, num, shortDateTime, t } from './i18n.js';
import { matchHeader } from './feeddata.js';
import { EVENT_COLORS, drawArrow, drawSurface, fitCanvas, surfaceRect, toPx } from './pitch.js';

const A = t.admin;
const Q = A.queue;

/** Sticky bulk bar only while something is selected (it follows you down a long list). */
// Pitch coordinates are 0–100: whole numbers are plenty (feeds send float noise like 36.600002).
const point = (x, y) => `${num(x)}, ${num(y)}`;
const markSelection = (bar, n) => bar.classList.toggle('has-selection', n > 0);

// ---------- election ----------

export function createElectionQueue(me, { onCount }) {
  const list = $('#eq-list');
  const recent = $('#eq-recent');
  const bulkBar = $('#eq-bulk');
  const selectAll = $('#eq-select-all');
  const approveButton = $('#eq-approve');
  const rejectButton = $('#eq-reject');
  const bulkReason = $('#eq-bulk-reason');
  const bulkReasonInput = $('#eq-bulk-reason-input');

  let submissions = [];
  let groups = [];                       // [{ key, latest, items }] newest first
  const selected = new Set();            // group keys
  const expanded = new Set();            // group keys showing every submission
  const committing = new Set();          // submission ids waiting for their undo window
  let rejecting = null;                  // group key with its reason row open

  const keyOf = s => `${s.constituencyId}:${s.candidateId}`;

  async function refresh() {
    submissions = (await getJson('/api/election/submissions')) ?? [];
    render();
    const decided = submissions.filter(s => s.status !== 'Pending').slice(0, 15);
    setChildren(recent, decided.length ? decided.map(recentRow) : el('li', { class: 'empty' }, Q.noRecent));
  }

  function buildGroups() {
    const byKey = new Map();
    for (const s of submissions) {
      if (s.status !== 'Pending' || committing.has(s.id)) continue;
      if (!byKey.has(keyOf(s))) byKey.set(keyOf(s), []);
      byKey.get(keyOf(s)).push(s);
    }
    groups = [...byKey].map(([key, items]) => {
      items.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
      return { key, latest: items[0], items };
    }).sort((a, b) => (a.latest.submittedAt < b.latest.submittedAt ? 1 : -1));
    for (const key of [...selected]) if (!groups.some(g => g.key === key)) selected.delete(key);
  }

  function render() {
    buildGroups();
    const pendingCount = groups.reduce((n, g) => n + g.items.length, 0);
    onCount(pendingCount);
    $('#eq-count').textContent = num(pendingCount);
    setChildren(list, groups.length
      ? groups.flatMap(groupRows)
      : el('tr', {}, el('td', { colspan: 8, class: 'muted' }, Q.emptyElection)));
    selectAll.checked = groups.length > 0 && groups.every(g => selected.has(g.key));
    updateBulk();
  }

  function groupRows(g) {
    const s = g.latest;
    const own = s.submittedBy === me.userName;
    const delta = s.previousVotes == null ? null : s.votesReceived - s.previousVotes;

    const box = el('input', { type: 'checkbox', 'aria-label': `${s.constituencyName} · ${s.candidateName}` });
    box.checked = selected.has(g.key);
    box.addEventListener('change', () => { box.checked ? selected.add(g.key) : selected.delete(g.key); updateBulk(); });

    const isOpen = expanded.has(g.key);
    const toggle = el('button', {
      type: 'button', class: 'secondary sm expand-button', 'aria-expanded': String(isOpen),
      'aria-label': isOpen ? Q.hideAll : Q.showAll, title: isOpen ? Q.hideAll : Q.showAll,
      onclick: () => { isOpen ? expanded.delete(g.key) : expanded.add(g.key); render(); }
    }, el('span', { class: 'expand-text' }, isOpen ? Q.hideAll : Q.showAll), isOpen ? '▴' : '▾');   // text only on the phone card

    const row = el('tr', { class: `${selected.has(g.key) ? 'is-selected' : ''}${delta != null && delta < 0 ? ' is-warning' : ''}`.trim() || null },
      el('td', {}, box),
      el('td', {}, el('strong', {}, s.constituencyName)),
      el('td', {}, s.candidateName, el('small', { class: 'muted' }, ` · ${s.partyName}`)),
      el('td', { class: 'num muted' }, s.previousVotes == null ? Q.firstCount : num(s.previousVotes)),
      el('td', { class: 'num' },
        el('strong', { class: 'vote-new' }, num(s.votesReceived)),
        delta == null ? null : el('span', { class: `vote-delta ${delta < 0 ? 'down' : 'up'}` }, `${delta < 0 ? '−' : '+'}${num(Math.abs(delta))}`),
        delta != null && delta < 0 ? el('span', { class: 'queue-warning', title: Q.decreased, 'aria-label': Q.decreased }, ' ⚠') : null),
      el('td', {},
        el('span', { class: 'queue-count' }, Q.submissions(g.items.length)),
        el('small', { class: 'muted queue-by' }, Q.latestBy(s.submittedByName), own ? el('span', { class: 'you-tag' }, A.users.you) : null)),
      el('td', { class: 'muted' }, ago(s.submittedAt)),
      el('td', {}, el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'primary approve', disabled: own, title: own ? Q.ownLatest : Q.approve, onclick: () => approveGroups([g.key]) }, `✓ ${Q.approve}`),
        el('button', { type: 'button', class: 'danger', onclick: () => { rejecting = rejecting === g.key ? null : g.key; render(); } }, `✕ ${Q.reject}`),
        toggle)));

    const extra = [];
    if (isOpen) {
      extra.push(el('tr', { class: 'detail-row' }, el('td', { colspan: 8 },
        el('ul', { class: 'submission-list' }, g.items.map(item => el('li', {},
          el('strong', {}, num(item.votesReceived)),
          el('span', { class: 'muted' }, ` · ${item.submittedByName} · ${ago(item.submittedAt)}`),
          item.note ? el('span', { class: 'queue-note' }, ` “${item.note}”`) : null))))));
    }
    if (rejecting === g.key) {
      const reason = el('input', { type: 'text', maxlength: 500, class: 'reason-input', placeholder: Q.reasonPlaceholder, 'aria-label': Q.reasonPlaceholder });
      const confirmReject = () => rejectGroups([g.key], reason.value);
      reason.addEventListener('keydown', event => { if (event.key === 'Enter') confirmReject(); });
      extra.push(el('tr', { class: 'detail-row' }, el('td', { colspan: 8 },
        el('div', { class: 'reject-row' },
          reason,
          el('button', { type: 'button', class: 'danger', onclick: confirmReject }, Q.confirmReject),
          el('button', { type: 'button', class: 'secondary', onclick: () => { rejecting = null; render(); } }, Q.cancel)))));
      queueMicrotask(() => reason.focus());
    }
    return [row, ...extra];
  }

  function updateBulk() {
    const n = [...selected].length;
    approveButton.textContent = `✓ ${Q.approveSelected(n)}`;
    rejectButton.textContent = `✕ ${Q.rejectSelected(n)}`;
    approveButton.disabled = rejectButton.disabled = n === 0;
    if (n === 0) bulkReason.hidden = true;
    markSelection(bulkBar, n);
    for (const row of list.querySelectorAll('tr')) {
      const box = row.querySelector('td:first-child input[type=checkbox]');
      if (box) row.classList.toggle('is-selected', box.checked);
    }
  }

  /** Approve each group's latest count (not your own), after the undo window. */
  function approveGroups(keys) {
    const chosen = groups.filter(g => keys.includes(g.key));
    const approvable = chosen.filter(g => g.latest.submittedBy !== me.userName);
    const skipped = chosen.length - approvable.length;
    if (!approvable.length) return toast(Q.ownLatest, 'error');

    const ids = approvable.flatMap(g => g.items.map(s => s.id));   // the older ones get superseded
    hold(ids, keys);
    deferWithUndo({
      message: Q.approving(approvable.length),
      onUndo: () => release(ids),
      commit: async keepalive => {
        let done = 0;
        try {
          for (const g of approvable) {
            await sendJson('POST', `/api/election/submissions/${g.latest.id}/approve`, {}, { keepalive });
            done++;
          }
        } finally {
          release(ids, false);
          toast(done ? [Q.groupsApproved(done), skipped ? Q.skippedOwn(skipped) : null].filter(Boolean).join(' · ') : Q.ownLatest, done ? 'ok' : 'error');
          await refresh();
        }
      }
    });
  }

  /** Reject every pending submission in the groups, with one reason, after the undo window. */
  function rejectGroups(keys, note) {
    const reason = (note ?? '').trim();
    if (!reason) return toast(Q.reasonRequired, 'error');
    const ids = groups.filter(g => keys.includes(g.key)).flatMap(g => g.items.map(s => s.id));
    hold(ids, keys);
    rejecting = null;
    bulkReason.hidden = true;
    bulkReasonInput.value = '';
    deferWithUndo({
      message: Q.rejecting(ids.length),
      onUndo: () => release(ids),
      commit: async keepalive => {
        let done = 0;
        try {
          for (const id of ids) {
            await sendJson('POST', `/api/election/submissions/${id}/reject`, { note: reason }, { keepalive });
            done++;
          }
        } finally {
          release(ids, false);
          toast(Q.groupsRejected(done));
          await refresh();
        }
      }
    });
  }

  /** Rows waiting for their undo window leave the list (and come back on Undo). */
  function hold(ids, keys) {
    ids.forEach(id => committing.add(id));
    keys.forEach(key => selected.delete(key));
    render();
  }

  function release(ids, rerender = true) {
    ids.forEach(id => committing.delete(id));
    if (rerender) render();
  }

  function recentRow(s) {
    return el('li', { class: 'recent-row' },
      statusChip(s.status, A.statuses[s.status] ?? s.status),
      el('span', { class: 'recent-text' },
        `${s.constituencyName} · ${s.candidateName}: ${num(s.votesReceived)}`,
        el('small', {}, Q.reviewedBy(s.reviewedByName ?? '', s.reviewedAt ? ago(s.reviewedAt) : ''))),
      s.reviewNote ? el('span', { class: 'recent-note' }, s.reviewNote) : null);
  }

  selectAll.addEventListener('change', () => {
    for (const g of groups) selectAll.checked ? selected.add(g.key) : selected.delete(g.key);
    render();
  });
  approveButton.addEventListener('click', () => approveGroups([...selected]));
  rejectButton.addEventListener('click', () => { bulkReason.hidden = false; bulkReasonInput.focus(); });
  $('#eq-bulk-reason-confirm').addEventListener('click', () => rejectGroups([...selected], bulkReasonInput.value));
  $('#eq-bulk-reason-cancel').addEventListener('click', () => { bulkReason.hidden = true; bulkReasonInput.value = ''; });
  bulkReasonInput.addEventListener('keydown', event => { if (event.key === 'Enter') rejectGroups([...selected], bulkReasonInput.value); });

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
  const bulkBar = approveButton.closest('.bulk-bar');

  let items = [];
  let summaries = [];
  let selected = new Set();
  const committing = new Set();
  let hovered = null;
  let size = { w: 0, h: 0 };

  const waiting = () => items.filter(e => !committing.has(e.id));
  const visible = () => waiting().filter(e => String(e.matchId) === matchSelect.value);

  async function refresh() {
    [items, summaries] = await Promise.all([
      getJson('/api/sports/queue?status=Pending').then(x => x ?? []),
      getJson('/api/sports/matches').then(x => x ?? [])   // badges, score and kick-off for the labels
    ]);
    fillMatches();
    const stillThere = new Set(items.map(e => e.id));
    selected = new Set([...selected].filter(id => stillThere.has(id)));
    render();
  }

  /** "Sport · title · kick-off · #id — n pending": two matches with the same title can't be confused. */
  function fillMatches() {
    const pending = waiting();
    onCount(pending.length);
    $('#sq-count').textContent = num(pending.length);
    const matches = [...new Map(pending.map(e => [e.matchId, e])).values()];
    fillSelect(matchSelect, matches, {
      value: e => e.matchId,
      label: e => {
        const summary = summaries.find(m => m.id === e.matchId);
        return Q.matchOption(t.sports.sports[e.sport] ?? e.sport, e.matchTitle,
          summary ? shortDateTime(summary.matchDate) : '', e.matchId, pending.filter(i => i.matchId === e.matchId).length);
      }
    });
    if (!matchSelect.value && matches[0]) matchSelect.value = String(matches[0].matchId);
  }

  function render() {
    const rows = visible();
    const summary = summaries.find(m => String(m.id) === matchSelect.value);
    $('#sq-match-head').hidden = !summary;
    if (summary) setChildren($('#sq-match-head'), matchHeader(summary));
    if (!rows.length) {
      setChildren(list, el('tr', {}, el('td', { colspan: 6, class: 'muted' }, Q.emptySports)));
    } else {
      setChildren(list, rows.map(e => {
        const box = el('input', { type: 'checkbox', 'aria-label': `${e.playerName} ${e.minute}'` });
        box.checked = selected.has(e.id);
        box.addEventListener('change', () => { box.checked ? selected.add(e.id) : selected.delete(e.id); updateButtons(); draw(); });
        const row = el('tr', { class: selected.has(e.id) ? 'is-selected' : null },
          el('td', {}, box),
          el('td', { class: 'num' }, num(e.minute)),
          el('td', {}, el('span', { class: 'swatch', style: `background:${EVENT_COLORS[e.eventType] ?? '#fff'}` }), ` ${t.sports.events[e.eventType] ?? e.eventType}`),
          el('td', {}, el('span', { class: 'queue-player' },
            e.playerPhoto ? el('img', { class: 'queue-photo', src: e.playerPhoto, alt: '' }) : null,
            el('span', {}, e.playerName, el('small', { class: 'muted' }, ` · ${e.team}`),
              e.detail ? el('small', { class: 'queue-detail' }, formatDetail(e.detail)) : null))),
          // Live score feeds send goals and cards without a pitch position.
          el('td', {}, e.x == null ? '—' : e.endX == null ? point(e.x, e.y) : `${point(e.x, e.y)} → ${point(e.endX, e.endY)}`),
          el('td', { class: 'muted' }, ago(e.submittedAt)));
        // The whole row (a card on phones) toggles the selection: a far bigger target than the checkbox.
        row.addEventListener('click', event => {
          if (event.target !== box) box.click();
        });
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
    approveButton.textContent = `✓ ${Q.approveSelected(n)}`;
    rejectButton.textContent = `✕ ${Q.rejectSelected(n)}`;
    approveButton.disabled = rejectButton.disabled = n === 0;
    markSelection(bulkBar, n);
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
      if (e.x == null) continue;   // no position to show
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

  /** Approve / reject the selection after the undo window; the rows step aside meanwhile. */
  function review(action) {
    const ids = visible().filter(e => selected.has(e.id)).map(e => e.id);
    if (!ids.length) return;
    ids.forEach(id => { committing.add(id); selected.delete(id); });
    fillMatches();
    render();
    const release = () => { ids.forEach(id => committing.delete(id)); };
    deferWithUndo({
      message: action === 'approve' ? Q.approving(ids.length) : Q.rejecting(ids.length),
      onUndo: () => { release(); fillMatches(); render(); },
      commit: async keepalive => {
        try {
          const result = await sendJson('POST', `/api/sports/queue/${action}`, { ids }, { keepalive });
          toast(action === 'approve' ? Q.bulkApproved(result?.updated ?? 0) : Q.bulkRejected(result?.updated ?? 0));
        } finally {
          release();
          await refresh();
        }
      }
    });
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
