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

/** A small coloured status label ("অপেক্ষমাণ", "অনুমোদিত", …). */
export const statusChip = (status, label) => el('span', { class: `status-chip status-${status.toLowerCase()}` }, label);
