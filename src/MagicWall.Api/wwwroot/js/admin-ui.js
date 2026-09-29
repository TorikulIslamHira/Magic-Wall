// Small UI helpers shared by the admin dashboard's modules (admin.js, review.js, field.js, users.js).
import { el, setChildren } from './dom.js';

export const $ = selector => document.querySelector(selector);

let toastTimer = 0;
/** Success messages fade after a moment; errors stay until dismissed so a failed save can't go unnoticed. */
export function toast(message, kind = 'ok') {
  const node = $('#toast');
  const hide = () => { node.hidden = true; };
  setChildren(node,
    el('span', { class: 'toast-text' }, message),
    kind === 'error' ? el('button', { type: 'button', class: 'toast-close', 'aria-label': 'বন্ধ করুন', onclick: hide }, '✕') : null);
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

/** A small coloured status label ("অপেক্ষমাণ", "অনুমোদিত", …). */
export const statusChip = (status, label) => el('span', { class: `status-chip status-${status.toLowerCase()}` }, label);
