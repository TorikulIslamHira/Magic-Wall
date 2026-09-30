// Producer-driven presenter wall: follows the admin dashboard's on-air state over SignalR.
// (The presenter-driven alternative, with a touch menu, is interactive-hub.html.)
import { connectHub, getJson } from './api.js';
import { initFullscreen } from './fullscreen.js';
import { localizeDom, t } from './i18n.js';

localizeDom();   // the page's static text in the chosen language (?lang=en or the saved choice)
import { createStage, initChrome, setHeader } from './stage.js';

const stage = createStage(document.getElementById('stage'), {
  tag: 'wall',
  onModule: module => setHeader(module, { title: '', eyebrow: '' })
});

function applyState(state) {
  console.log('[wall] StateChanged received', state);
  return stage.show(state.activeModule, state);
}

async function resync() {
  const state = await getJson('/api/wall/state');
  if (!state) return;
  await applyState(state);
  await stage.refreshAll();
}

const setStatus = initChrome();
initFullscreen(document.getElementById('fullscreen-toggle'), t.fullscreen);

// The hub's onConnected also resyncs; loading state first means the wall shows
// something even if the hub is slow to connect.
resync().catch(stage.showError);
connectHub({
  on: { StateChanged: applyState, DataChanged: stage.dataChanged },
  onStatus: setStatus,
  onConnected: () => resync().catch(stage.showError),
  tag: 'wall'
});
