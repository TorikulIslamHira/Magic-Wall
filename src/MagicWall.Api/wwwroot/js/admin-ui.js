// Small UI helpers shared by the admin dashboard's modules (admin.js, review.js, field.js, users.js).
import { el, setChildren } from './dom.js';
import { num, t } from './i18n.js';

export const $ = selector => document.querySelector(selector);

let toastTimer = 0;
/** Success messages fade after a moment; errors stay until dismissed so a failed save can't go unnoticed. */
export function toast(message, kind = 'ok') {
  const node = $('#toast');
  const hide = () => { node.hidden = true; };
  setChildren(node,
    el('span', { class: 'toast-text' }, message),
    kind === 'error' ? el('button', { type: 'button', class: 'toast-close', 'aria-label': t.close, onclick: hide }, '✕') : null);
  node.dataset.kind = kind;
  node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  node.hidden = false;
  clearTimeout(toastTimer);
  if (kind !== 'error') toastTimer = setTimeout(hide, 2500);
}

/** Runs an action, reporting failure as a toast instead of an unhandled rejection. */
export async function attempt(action, successMessage) {
  try {
    const result = await action();
    if (successMessage) toast(typeof successMessage === 'function' ? successMessage(result) : successMessage);
    return result;
  } catch (error) {
    toast(error.message, 'error');
    return undefined;
  }
}

/** Replaces a <select>'s options, keeping the current choice when it still exists. */
export function fillSelect(select, items, { value, label, placeholder }) {
  const previous = select.value;
  setChildren(select,
    placeholder ? el('option', { value: '' }, placeholder) : null,
    items.map(item => el('option', { value: String(value(item)) }, label(item))));
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
}

/**
 * Phones show table rows as cards (admin.css). Each cell gets its column's heading as
 * data-label so the card can say what each value is. Rows are re-rendered all the time
 * (live queues, edits), so every table.data is watched and relabelled on change.
 */
export function enableCardTables(root = document) {
  const label = table => {
    const headers = [];
    for (const th of table.querySelectorAll('thead tr:first-child th')) {
      for (let i = 0; i < th.colSpan; i++) headers.push(th.textContent.trim());
    }
    for (const row of table.tBodies[0]?.rows ?? []) {
      let column = 0;
      for (const cell of row.cells) {
        const heading = cell.colSpan > 1 ? '' : headers[column] ?? '';
        if (heading) cell.dataset.label = heading; else delete cell.dataset.label;
        cell.classList.toggle('cell-full', cell.colSpan > 1);
        // A lone checkbox (row selection) sits in the card's corner.
        const only = cell.children.length === 1 ? cell.firstElementChild : null;
        cell.classList.toggle('cell-check', !!only?.matches('input[type="checkbox"]') && !cell.textContent.trim());
        column += cell.colSpan;
      }
    }
  };
  for (const table of root.querySelectorAll('table.data')) {
    let queued = false;
    const relabel = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; label(table); });
    };
    new MutationObserver(relabel).observe(table, { childList: true, subtree: true });
    label(table);
  }
}

// ---------- undo: approvals and rejections wait a few seconds before they're sent ----------

let pending = null;   // the one action waiting to be sent

/**
 * Shows "message · 5 · Undo" and sends the action only when the time is up. Undo cancels it
 * (nothing reached the server). One action waits at a time: starting another sends the first.
 * Leaving the page sends a waiting action immediately (keepalive), so nothing is lost.
 * @param commit  async (keepalive) => …, the actual request(s)
 * @param onUndo  restores the screen when the user undoes
 */
export function deferWithUndo({ message, commit, onUndo, seconds = 5 }) {
  flushPending();
  const node = $('#toast');
  let left = seconds;
  const count = el('span', { class: 'toast-count', 'aria-hidden': 'true' }, num(left));
  const undo = el('button', { type: 'button', class: 'secondary sm toast-undo' }, t.admin.queue.undo);
  setChildren(node, el('span', { class: 'toast-text' }, message), count, undo);
  node.dataset.kind = 'pending';
  node.setAttribute('role', 'status');
  node.hidden = false;
  clearTimeout(toastTimer);

  const entry = { commit, done: false };
  const tick = setInterval(() => { left = Math.max(0, left - 1); count.textContent = num(left); }, 1000);
  entry.stop = () => { clearTimeout(entry.timer); clearInterval(tick); };
  entry.timer = setTimeout(() => run(entry), seconds * 1000);
  undo.addEventListener('click', () => {
    if (entry.done) return;
    entry.done = true;
    entry.stop();
    if (pending === entry) pending = null;
    toast(t.admin.queue.undone);
    onUndo?.();
  });
  pending = entry;
}

async function run(entry, keepalive = false) {
  if (entry.done) return;
  entry.done = true;
  entry.stop();
  if (pending === entry) pending = null;
  try {
    await entry.commit(keepalive);
  } catch (error) {
    toast(error.message, 'error');
  }
}

/** Sends the waiting action now (before signing out, or when the page goes away). */
export function flushPending(keepalive = false) {
  return pending ? run(pending, keepalive) : Promise.resolve();
}

window.addEventListener('pagehide', () => { flushPending(true); });

// ---------- a small "⋯" menu for secondary actions ----------

/** A "⋯" button that opens a short list of actions: [{ label, onSelect, disabled?, danger? }]. */
export function moreMenu(label, items) {
  const button = el('button', { type: 'button', class: 'secondary sm more-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label, title: label }, '⋯');
  const menu = el('div', { class: 'menu', role: 'menu', hidden: true },
    items.map(item => el('button', {
      type: 'button', role: 'menuitem', class: item.danger ? 'menu-item is-danger' : 'menu-item', disabled: item.disabled,
      title: item.title ?? null,
      onclick: () => { close(); item.onSelect(); }
    }, item.label)));
  const wrap = el('div', { class: 'menu-wrap' }, button, menu);

  const onOutside = event => { if (!wrap.contains(event.target)) close(); };
  const onKey = event => { if (event.key === 'Escape') { close(); button.focus(); } };
  function open() {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('.menu-item:not(:disabled)')?.focus();
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
  }
  function close() {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
  }
  button.addEventListener('click', () => (menu.hidden ? open() : close()));
  return wrap;
}

/** A small coloured status label ("অপেক্ষমাণ", "অনুমোদিত", …). */
export const statusChip = (status, label) => el('span', { class: `status-chip status-${status.toLowerCase()}` }, label);
