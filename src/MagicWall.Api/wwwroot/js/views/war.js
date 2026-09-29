// War & Geopolitics view: world map with conflict zones coloured by controlling force,
// driven by a timeline slider.
//
// A zone's SvgPathId is a country code from maps/world.geojson (e.g. "UKR", "SDN"), or the
// `code` of a feature in the optional maps/war-regions.geojson for sub-national areas.
// All zone histories load once; scrubbing is computed client-side, so dragging stays smooth.
import { getJson } from '../api.js';
import { el, prefersReducedMotion, setChildren } from '../dom.js';
import { collection, createGeoMap, loadGeoJson } from '../geo.js';
import { date, num, t } from '../i18n.js';
import { NEUTRAL, categoricalScale } from '../palette.js';

// Vendored UMD build, loaded by magic-wall.html from lib/d3.
const { d3 } = window;

const DAY_MS = 86_400_000;
const PLAY_DURATION_MS = 12_000;   // full timeline playback length
const COUNTER_MS = 450;
const HATCH_PX = 9;                // stripe period on screen, kept constant while zooming

// "Contested" is an active battleground, not a force: diagonal stripes instead of a colour.
const CONTESTED = new Set(['contested', 'বিরোধপূর্ণ']);
const isContested = force => CONTESTED.has(force?.trim().toLowerCase());
const HATCH_CSS = `background: repeating-linear-gradient(45deg, ${NEUTRAL} 0 4px, rgba(255, 255, 255, 0.85) 4px 6px)`;

const toDay = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY_MS;

export function createWarView() {
  const abort = new AbortController();
  const tx = t.war;

  let zones = [];                 // [{ id, regionName, svgPathId, feature, events: [{ ..., day, cumulative }] }]
  let featureByCode = new Map();
  let colorOf = () => NEUTRAL;
  let minDay = 0;
  let maxDay = 0;
  let currentDay = 0;
  let selected = null;            // svgPathId
  let zoomLevel = 1;

  let map, hatch, zoneLayer, labelLayer, stage;
  let slider, dateLabel, ticks, heroValue, legend, detail, playButton, emptyMessage;
  let shownTotal = 0;
  let counterFrame = 0;
  let playFrame = 0;
  let hatchId = '';

  async function mount(container, state) {
    stage = el('div', { class: 'map-stage' });
    emptyMessage = el('div', { class: 'stage-message', hidden: true });
    heroValue = el('span', { class: 'hero-value danger' }, num(0));
    dateLabel = el('span', { class: 'timeline-date' });
    legend = el('div', { class: 'legend-row' });
    detail = el('div', { class: 'war-detail' });
    ticks = el('div', { class: 'timeline-ticks' });
    slider = el('input', { class: 'timeline-slider', type: 'range', min: 0, max: 0, step: 1, value: 0, 'aria-label': 'Timeline' });
    playButton = el('button', { class: 'chip', type: 'button', onclick: togglePlay }, `▶ ${tx.play}`);

    slider.addEventListener('input', () => {
      stopPlay();
      setDay(minDay + Number(slider.value));
    });

    container.append(el('div', { class: 'war' },
      el('div', { class: 'map-card glass' }, stage, emptyMessage, el('p', { class: 'map-credit' }, 'মানচিত্র: Natural Earth')),
      el('aside', { class: 'side-panel glass' },
        el('div', { class: 'hero' }, el('span', { class: 'eyebrow' }, tx.casualtiesAll), heroValue),
        detail),
      el('section', { class: 'timeline glass' },
        el('div', { class: 'timeline-head' },
          dateLabel,
          el('div', { class: 'timeline-buttons' },
            el('button', { class: 'chip', type: 'button', 'aria-label': tx.prev, onclick: () => jumpToEvent(-1) }, '◀'),
            playButton,
            el('button', { class: 'chip', type: 'button', 'aria-label': tx.next, onclick: () => jumpToEvent(1) }, '▶'))),
        el('div', { class: 'timeline-track' }, ticks, slider),
        legend)));

    const [world, regions] = await Promise.all([loadGeoJson('/maps/world.geojson'), loadGeoJson('/maps/war-regions.geojson')]);
    featureByCode = new Map([...world.features, ...(regions?.features ?? [])].map(f => [f.properties.code, f]));
    buildMap(world, regions);

    await reload();
    currentDay = state.date ? clampDay(toDay(state.date)) : maxDay;
    selected = findZone(state.regionName)?.svgPathId ?? null;
    render({ animate: false });
    frame(false);
  }

  async function update(state) {
    if (state.date) {
      stopPlay();
      setDay(clampDay(toDay(state.date)));
    }
    const zone = findZone(state.regionName);
    if (zone && zone.svgPathId !== selected) select(zone.svgPathId);
  }

  async function onData() {
    // A change may move the date range or add zones, so refetch everything. If the slider
    // sat at the latest date, keep following the newest events.
    const wasAtEnd = currentDay >= maxDay;
    await reload();
    currentDay = wasAtEnd ? maxDay : clampDay(currentDay);
    render({ animate: true });
  }

  function unmount() {
    abort.abort();
    stopPlay();
    cancelAnimationFrame(counterFrame);
  }

  // ---------- map ----------

  function buildMap(world, regions) {
    map = createGeoMap(stage, world, { projection: d3.geoNaturalEarth1(), maxZoom: 40, onZoom });

    hatchId = `${map.glowId}-hatch`;
    hatch = map.defs.append('pattern')
      .attr('id', hatchId)
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('patternTransform', 'rotate(45)');
    hatch.append('rect').attr('class', 'hatch-base').attr('fill', NEUTRAL);
    hatch.append('rect').attr('class', 'hatch-stripe').attr('fill', 'rgba(255, 255, 255, 0.85)');

    map.layer.append('g').attr('class', 'countries')
      .selectAll('path').data(world.features).join('path')
      .attr('d', map.path);
    if (regions) {
      map.layer.append('g').attr('class', 'countries sub-regions')
        .selectAll('path').data(regions.features).join('path')
        .attr('d', map.path);
    }
    zoneLayer = map.layer.append('g').attr('class', 'zones');
    labelLayer = map.layer.append('g').attr('class', 'zone-labels');

    map.svg.on('click', () => { if (selected) select(null); });
    onZoom(1);
  }

  // Keep stripes, borders and labels a constant size on screen at any zoom.
  function onZoom(k) {
    zoomLevel = k;
    const size = HATCH_PX / k;
    hatch?.attr('width', size).attr('height', size);
    hatch?.select('.hatch-base').attr('width', size).attr('height', size);
    hatch?.select('.hatch-stripe').attr('width', size / 3).attr('height', size);
    labelLayer?.selectAll('text').style('font-size', function () { return `${this.dataset.size / k}px`; }).style('stroke-width', `${3 / k}px`);
  }

  /** Frames all mapped zones (or the selected one) so the conflict fills the view. */
  function frame(animate = true) {
    const zone = zones.find(z => z.svgPathId === selected && z.feature);
    const target = zone ? zone.feature : collection(zones.filter(z => z.feature).map(z => z.feature));
    if (!target.features?.length && !zone) {
      map.reset(animate ? 750 : 0);
      return;
    }
    map.zoomTo(target, { maxScale: 30, ms: animate ? 900 : 0 });
  }

  function drawZones() {
    const mapped = zones.filter(z => z.feature);

    zoneLayer.selectAll('path')
      .data(mapped, z => z.svgPathId)
      .join('path')
      .attr('class', 'zone')
      .attr('d', z => map.path(z.feature))
      .attr('tabindex', 0)
      .attr('aria-label', z => z.regionName)
      .on('click', (event, z) => {
        event.stopPropagation();
        select(z.svgPathId === selected ? null : z.svgPathId);
      })
      .on('keydown', (event, z) => { if (event.key === 'Enter') select(z.svgPathId); });

    const groups = labelLayer.selectAll('g')
      .data(mapped, z => z.svgPathId)
      .join(enter => {
        const g = enter.append('g');
        g.append('text').attr('class', 'zone-name').attr('data-size', 15);
        g.append('text').attr('class', 'zone-force').attr('data-size', 12).attr('dy', '1.3em');
        return g;
      })
      .attr('transform', z => `translate(${map.path.centroid(z.feature)})`);
    groups.select('.zone-name').text(z => z.regionName);
    onZoom(zoomLevel);
  }

  // ---------- data ----------

  async function reload() {
    const raw = (await getJson('/api/war/zones', abort.signal)) ?? [];
    zones = raw.map(zone => {
      let cumulative = 0;
      const events = zone.events.map(e => ({ ...e, day: toDay(e.date), cumulative: (cumulative += e.casualties) }));
      return { ...zone, events, feature: featureByCode.get(zone.svgPathId) ?? null };
    });
    // Contested takes no palette slot, so real forces keep the validated first colours.
    colorOf = categoricalScale(zones.flatMap(z => z.events.map(e => e.controllingForce)).filter(f => !isContested(f)));

    const days = zones.flatMap(z => z.events.map(e => e.day));
    const today = Math.floor(Date.now() / DAY_MS);
    minDay = days.length ? Math.min(...days) : today;
    maxDay = days.length ? Math.max(...days) : today;
    slider.max = String(maxDay - minDay);
    renderTicks();
    drawZones();

    emptyMessage.textContent = zones.length ? '' : tx.empty;
    emptyMessage.hidden = zones.length > 0;
  }

  const fillFor = force => (isContested(force) ? `url(#${hatchId})` : colorOf(force));
  const swatchStyle = force => (isContested(force) ? HATCH_CSS : `background:${colorOf(force)}`);
  const forceLabel = force => (isContested(force) ? tx.contested : force);

  /** Latest event on or before `day`, which also carries the running casualty total. */
  function stateAt(zone, day) {
    let latest = null;
    for (const event of zone.events) {
      if (event.day > day) break;
      latest = event;
    }
    return latest;
  }

  function setDay(day) {
    if (day === currentDay) return;
    currentDay = day;
    render({ animate: false });
  }

  function select(svgPathId) {
    selected = svgPathId;
    render({ animate: false });
    frame();
  }

  // ---------- render ----------

  function render({ animate }) {
    slider.value = String(currentDay - minDay);
    slider.style.setProperty('--progress', `${((currentDay - minDay) / Math.max(1, maxDay - minDay)) * 100}%`);
    dateLabel.textContent = date(currentDay);

    const controlled = new Map();   // force -> zone count
    let noReports = 0;
    let total = 0;
    const latestById = new Map();

    for (const zone of zones) {
      const latest = stateAt(zone, currentDay);
      latestById.set(zone.svgPathId, latest);
      total += latest?.cumulative ?? 0;
      if (latest) controlled.set(latest.controllingForce, (controlled.get(latest.controllingForce) ?? 0) + 1);
      else noReports++;
    }

    zoneLayer.selectAll('path').each(function (z) {
      const latest = latestById.get(z.svgPathId);
      const fill = latest ? fillFor(latest.controllingForce) : NEUTRAL;
      const shape = d3.select(this).classed('selected', z.svgPathId === selected).classed('no-data', !latest);
      // A pattern can't be colour-interpolated, so changes into or out of the hatch switch instantly.
      const involvesPattern = fill.startsWith('url') || this.style.fill.startsWith('url');
      (animate && !involvesPattern && !prefersReducedMotion() ? shape.transition().duration(500) : shape.interrupt())
        .style('fill', fill);
    });
    labelLayer.selectAll('.zone-force').text(z => {
      const latest = latestById.get(z.svgPathId);
      return latest ? forceLabel(latest.controllingForce) : tx.noReports;
    });
    stage.classList.toggle('has-selection', Boolean(selected));

    renderLegend(controlled, noReports);
    animateCounter(total);
    renderDetail(latestById);
  }

  function renderLegend(controlled, noReports) {
    setChildren(legend,
      [...controlled].sort((a, b) => b[1] - a[1]).map(([force, count]) =>
        el('span', { class: 'legend-item' },
          el('span', { class: 'swatch', style: swatchStyle(force) }),
          `${forceLabel(force)} `, el('strong', {}, num(count)))),
      noReports ? el('span', { class: 'legend-item' }, el('span', { class: 'swatch', style: `background:${NEUTRAL}` }), `${tx.noReports} `, el('strong', {}, num(noReports))) : null);
  }

  function renderTicks() {
    const range = Math.max(1, maxDay - minDay);
    const eventDays = [...new Set(zones.flatMap(z => z.events.map(e => e.day)))].sort((a, b) => a - b);
    setChildren(ticks, eventDays.map(day =>
      el('button', {
        class: 'timeline-tick',
        type: 'button',
        style: `left:${((day - minDay) / range) * 100}%`,
        'aria-label': date(day),
        onclick: () => { stopPlay(); setDay(day); }
      })));
  }

  function renderDetail(latestById) {
    const zone = zones.find(z => z.svgPathId === selected);
    if (!zone) {
      renderOverview(latestById);
      return;
    }

    const latest = latestById.get(zone.svgPathId);
    setChildren(detail,
      el('button', { class: 'back', type: 'button', onclick: () => select(null) }, `← ${tx.allZones}`),
      el('h2', { class: 'panel-title' }, zone.regionName),
      el('div', { class: 'stats two' },
        statTile(tx.controlledBy, latest ? forceLabel(latest.controllingForce) : tx.noReports, latest ? swatchStyle(latest.controllingForce) : null),
        statTile(tx.casualtiesToDate, num(latest?.cumulative ?? 0))),
      zone.events.length
        ? el('ol', { class: 'war-events' }, zone.events.map(e =>
            el('li', { class: `war-event${e === latest ? ' current' : ''}${e.day > currentDay ? ' upcoming' : ''}` },
              el('div', { class: 'war-event-head' },
                el('span', { class: 'swatch', style: swatchStyle(e.controllingForce) }),
                el('strong', {}, forceLabel(e.controllingForce)),
                el('span', { class: 'muted' }, date(e.day))),
              e.description ? el('p', {}, e.description) : null,
              e.casualties ? el('p', { class: 'muted' }, tx.casualtiesReported(e.casualties)) : null)))
        : el('p', { class: 'muted' }, tx.noEvents));

    // Instant, not smooth: this runs on every slider tick while dragging.
    detail.querySelector('.war-event.current')?.scrollIntoView({ block: 'nearest' });
  }

  function renderOverview(latestById) {
    const rows = zones
      .map(zone => ({ zone, latest: latestById.get(zone.svgPathId) }))
      .sort((a, b) => (b.latest?.cumulative ?? 0) - (a.latest?.cumulative ?? 0));

    setChildren(detail,
      el('h2', { class: 'panel-title' }, tx.allZones),
      el('p', { class: 'hint' }, tx.tapHint),
      el('ol', { class: 'zone-list' }, rows.map(({ zone, latest }) =>
        el('li', {},
          el('button', { class: 'zone-row', type: 'button', onclick: () => select(zone.svgPathId) },
            el('span', { class: 'swatch lg', style: latest ? swatchStyle(latest.controllingForce) : `background:${NEUTRAL}` }),
            el('span', { class: 'zone-row-name' }, zone.regionName, el('small', {}, latest ? forceLabel(latest.controllingForce) : tx.noReports)),
            el('strong', {}, num(latest?.cumulative ?? 0)))))));
  }

  // The casualty figure rolls to its new value rather than jumping, so viewers see it move with the slider.
  function animateCounter(target) {
    cancelAnimationFrame(counterFrame);
    if (prefersReducedMotion()) {
      shownTotal = target;
      heroValue.textContent = num(target);
      return;
    }
    const from = shownTotal;
    const start = performance.now();
    const step = now => {
      const p = Math.min(1, (now - start) / COUNTER_MS);
      shownTotal = Math.round(from + (target - from) * (1 - (1 - p) ** 3));
      heroValue.textContent = num(shownTotal);
      if (p < 1) counterFrame = requestAnimationFrame(step);
    };
    counterFrame = requestAnimationFrame(step);
  }

  function jumpToEvent(direction) {
    stopPlay();
    const days = [...new Set(zones.flatMap(z => z.events.map(e => e.day)))].sort((a, b) => a - b);
    const target = direction > 0 ? days.find(d => d > currentDay) : days.reverse().find(d => d < currentDay);
    if (target !== undefined) setDay(target);
  }

  function togglePlay() {
    if (playFrame) {
      stopPlay();
      return;
    }
    if (currentDay >= maxDay) setDay(minDay);
    const startDay = currentDay;
    const duration = PLAY_DURATION_MS * ((maxDay - startDay) / Math.max(1, maxDay - minDay));
    const startTime = performance.now();
    playButton.textContent = `❚❚ ${tx.pause}`;

    const step = now => {
      const p = Math.min(1, (now - startTime) / Math.max(1, duration));
      setDay(Math.round(startDay + (maxDay - startDay) * p));
      if (p < 1) playFrame = requestAnimationFrame(step);
      else stopPlay();
    };
    playFrame = requestAnimationFrame(step);
  }

  function stopPlay() {
    cancelAnimationFrame(playFrame);
    playFrame = 0;
    if (playButton) playButton.textContent = `▶ ${tx.play}`;
  }

  function clampDay(day) {
    return Math.min(maxDay, Math.max(minDay, day));
  }

  function findZone(regionName) {
    const wanted = regionName?.trim().toLowerCase();
    return wanted ? zones.find(z => z.regionName.toLowerCase() === wanted) : undefined;
  }

  return { mount, update, onData, unmount };
}

function statTile(label, value, swatchStyle) {
  return el('div', { class: 'stat' },
    el('span', { class: 'stat-label' }, label),
    el('span', { class: 'stat-value' }, swatchStyle ? el('span', { class: 'swatch', style: swatchStyle }) : null, ` ${value}`));
}
