// The presenter screen's engine, shared by magic-wall.html (producer-driven: follows the
// admin's on-air state) and interactive-hub.html (presenter-driven: tiles on a touch screen).
//
// A view is { mount(container, state), update(state), onData(keys), unmount() }.
// Views are loaded on demand, so only the module on screen is downloaded, and a failing
// view can't take down the page. Every public endpoint a view reads returns APPROVED data only.
import { el } from './dom.js';
import { clock, t, today } from './i18n.js';

const VIEWS = {
  Election: () => import('./views/election.js').then(m => m.createElectionView()),
  Sports: () => import('./views/sports.js').then(m => m.createSportsView()),
  War: () => import('./views/war.js').then(m => m.createWarView()),
  Budget: () => import('./views/budget.js').then(m => m.createBudgetView())
};

export const MODULES = Object.keys(VIEWS);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param stageEl   element the module views are mounted into
 * @param options.tag         console prefix ("wall", "hub")
 * @param options.onModule    called with the module name (or null) whenever it changes
 */
export function createStage(stageEl, { tag = 'stage', onModule = () => {} } = {}) {
  let current = null;      // { module, view, container }
  let queue = Promise.resolve();

  // Every switch and refresh runs in order, so a quick Election → Sports → Election
  // can't interleave mounts.
  function enqueue(task) {
    queue = queue.then(task).catch(showError);
    return queue;
  }

  async function unmountCurrent() {
    if (!current) return;
    const leaving = current;
    current = null;
    leaving.container.classList.add('leaving');
    await wait(300);
    leaving.view.unmount?.();
    leaving.container.remove();
  }

  /** Shows a module, or just re-focuses it if it is already showing. */
  function show(module, state) {
    return enqueue(async () => {
      if (current?.module === module) {
        await current.view.update?.(state);
        console.log(`[${tag}] ${module} view updated to the new focus`);
        return;
      }
      const load = VIEWS[module];
      if (!load) throw new Error(`Unknown module "${module}"`);
      console.log(`[${tag}] switching to ${module}`);

      await unmountCurrent();
      stageEl.querySelectorAll(':scope > .wall-error').forEach(node => node.remove());
      const container = el('section', { class: 'module entering', 'data-module': module });
      stageEl.append(container);

      let view = null;
      try {
        view = await load();
        await view.mount(container, state);
        current = { module, view, container };
        onModule(module);
        requestAnimationFrame(() => container.classList.remove('entering'));
      } catch (error) {
        // Leave `current` empty so the next attempt retries this module.
        view?.unmount?.();
        container.remove();
        throw error;
      }
    });
  }

  /** Removes whatever module is showing (the hub's "back to menu"). */
  function clear() {
    return enqueue(async () => {
      await unmountCurrent();
      onModule(null);
    });
  }

  // Coalesce bursts of DataChanged (a producer typing several vote counts, a bulk approval),
  // per module. Nothing is dropped on arrival: the decision is made inside the queue, after
  // any switch in progress has finished.
  const pendingKeys = new Map();   // module -> Set of keys
  let flushTimer = 0;

  function dataChanged({ module, key }) {
    console.log(`[${tag}] DataChanged received: ${module} / ${key}`);
    if (!pendingKeys.has(module)) pendingKeys.set(module, new Set());
    pendingKeys.get(module).add(key);

    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      const batch = [...pendingKeys];
      pendingKeys.clear();
      enqueue(async () => {
        for (const [changedModule, keys] of batch) {
          if (current?.module !== changedModule) {
            console.log(`[${tag}] ignored ${changedModule} change (${[...keys].join(', ')}): ${current?.module ?? 'nothing'} is showing, `
              + `and ${changedModule} loads fresh data when opened`);
            continue;
          }
          const started = performance.now();
          console.log(`[${tag}] refreshing ${changedModule} for: ${[...keys].join(', ')}`);
          await current.view.onData?.(keys);
          console.log(`[${tag}] ${changedModule} refreshed in ${Math.round(performance.now() - started)} ms`);
        }
      });
    }, 150);
  }

  /** After a reconnect updates may have been missed; '*' tells the view to refetch everything. */
  function refreshAll() {
    return enqueue(async () => current?.view.onData?.(new Set(['*'])));
  }

  function showError(error) {
    console.error(error);
    const container = current?.container ?? stageEl;
    container.querySelector('.wall-error')?.remove();
    container.append(el('div', { class: 'wall-error', role: 'alert' }, `${t.error}: ${error.message}`));
  }

  return { show, clear, dataChanged, refreshAll, showError, get module() { return current?.module ?? null; } };
}

/** Header clock (Bangla, time of day) and the live-connection badge. */
export function initChrome() {
  const clockEl = document.getElementById('clock');
  const todayEl = document.getElementById('today');
  const statusEl = document.getElementById('hub-status');
  const tick = () => {
    const now = new Date();
    clockEl.textContent = clock(now);
    todayEl.textContent = today(now);
  };
  tick();
  setInterval(tick, 10_000);

  return status => {
    statusEl.dataset.status = status;
    statusEl.querySelector('.label').textContent = t.status[status] ?? status;
  };
}

/** Sets the header's module title and eyebrow (or the given fallback when nothing is open). */
export function setHeader(module, fallback) {
  document.getElementById('module-title').textContent = module ? t.modules[module].title : fallback.title;
  document.getElementById('module-eyebrow').textContent = module ? t.modules[module].eyebrow : fallback.eyebrow;
}
