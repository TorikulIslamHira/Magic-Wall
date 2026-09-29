// Presenter wall shell: follows the active module over SignalR and swaps views.
//
// A view is { mount(container, state), update(state), onData(keys), unmount() }.
// Views are loaded on demand, so only the module on air is downloaded, and a
// failing view can't take down the shell.
import { connectHub, getJson } from './api.js';
import { el } from './dom.js';
import { clock, t, today } from './i18n.js';

const VIEWS = {
  Election: { load: () => import('./views/election.js').then(m => m.createElectionView()) },
  Sports: { load: () => import('./views/sports.js').then(m => m.createSportsView()) },
  War: { load: () => import('./views/war.js').then(m => m.createWarView()) },
  Budget: { load: () => import('./views/budget.js').then(m => m.createBudgetView()) }
};

const stage = document.getElementById('stage');
const titleEl = document.getElementById('module-title');
const eyebrowEl = document.getElementById('module-eyebrow');
const statusEl = document.getElementById('hub-status');

let current = null;      // { module, view, container }
let queue = Promise.resolve();

// Every state change and data refresh runs in order, so a quick
// Election → Sports → Election from the admin can't interleave mounts.
function enqueue(task) {
  queue = queue.then(task).catch(showError);
  return queue;
}

function applyState(state) {
  return enqueue(async () => {
    if (current?.module === state.activeModule) {
      await current.view.update?.(state);
      return;
    }

    const definition = VIEWS[state.activeModule];
    if (!definition) throw new Error(`Unknown module "${state.activeModule}"`);

    if (current) {
      const leaving = current;
      current = null;
      leaving.container.classList.add('leaving');
      await wait(300);
      leaving.view.unmount?.();
      leaving.container.remove();
    }

    titleEl.textContent = t.modules[state.activeModule].title;
    eyebrowEl.textContent = t.modules[state.activeModule].eyebrow;
    stage.querySelectorAll(':scope > .wall-error').forEach(node => node.remove());
    const container = el('section', { class: 'module entering', 'data-module': state.activeModule });
    stage.append(container);

    let view = null;
    try {
      view = await definition.load();
      await view.mount(container, state);
      current = { module: state.activeModule, view, container };
      requestAnimationFrame(() => container.classList.remove('entering'));
    } catch (error) {
      // Leave `current` empty so the next StateChanged or reconnect retries this module.
      view?.unmount?.();
      container.remove();
      throw error;
    }
  });
}

// Coalesce bursts of DataChanged (e.g. a producer typing several vote counts).
let pendingKeys = new Set();
let pendingModule = null;
let flushTimer = 0;

function onDataChanged({ module, key }) {
  if (current?.module !== module) return;
  if (pendingModule !== module) pendingKeys = new Set();
  pendingModule = module;
  pendingKeys.add(key);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    const keys = pendingKeys;
    pendingKeys = new Set();
    enqueue(async () => {
      if (current?.module === module) await current.view.onData?.(keys);
    });
  }, 150);
}

async function resync() {
  const state = await getJson('/api/wall/state');
  if (!state) return;
  await applyState(state);
  // Updates may have been missed while disconnected; '*' tells the view to refetch everything.
  enqueue(async () => current?.view.onData?.(new Set(['*'])));
}

function showError(error) {
  console.error(error);
  const container = current?.container ?? stage;
  container.querySelector('.wall-error')?.remove();
  container.append(el('div', { class: 'wall-error', role: 'alert' }, `${t.error}: ${error.message}`));
}

function setStatus(status) {
  statusEl.dataset.status = status;
  statusEl.querySelector('.label').textContent = t.status[status] ?? status;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function startClock() {
  const clockEl = document.getElementById('clock');
  const todayEl = document.getElementById('today');
  const tick = () => {
    const now = new Date();
    clockEl.textContent = clock(now);
    todayEl.textContent = today(now);
  };
  tick();
  setInterval(tick, 10_000);
}

startClock();
// The hub's onConnected also resyncs; loading state first means the wall shows
// something even if the hub is slow to connect.
resync().catch(showError);
connectHub({
  on: { StateChanged: applyState, DataChanged: onDataChanged },
  onStatus: setStatus,
  onConnected: () => resync().catch(showError)
});
