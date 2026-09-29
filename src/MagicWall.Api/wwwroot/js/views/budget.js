// Budget view: donut of sector allocations, ranked sector list, and mega-project cards
// for the selected sector.
//
// The donut shows the five largest sectors plus "Other": beyond ~6 slices a donut stops
// being readable at a glance. The ranked list beside it is the exact-numbers view and
// the legend, and every sector (including those inside "Other") is selectable there.
import { getJson } from '../api.js';
import { el, prefersReducedMotion } from '../dom.js';
import { bnDigits, num, pct, t, taka } from '../i18n.js';
import { NEUTRAL, categoricalScale } from '../palette.js';

// Vendored UMD build, loaded by magic-wall.html from lib/d3 (no CDN on air-gapped networks).
const { d3 } = window;

const TOP_SECTORS = 5;
const OTHER = 'Other';
const tx = t.budget;

export function createBudgetView() {
  const abort = new AbortController();

  let fiscalYear = null;
  let sectors = [];
  let slices = [];
  let colorOf = () => NEUTRAL;
  let selectedSectorId = null;
  let selectedProjectId = null;

  let donutSvg, donutGroup, centerLabel, title, sectorList, projectsPane, emptyMessage;
  let radius = 0;
  let resizeObserver;

  async function mount(container, state) {
    title = el('h2', { class: 'budget-title' });
    centerLabel = el('div', { class: 'donut-center' });
    emptyMessage = el('div', { class: 'stage-message', hidden: true });
    const donutPane = el('div', { class: 'donut-pane' }, centerLabel);
    sectorList = el('ol', { class: 'sector-list' });
    projectsPane = el('aside', { class: 'projects-pane side-panel glass' });

    container.append(el('div', { class: 'budget' },
      el('section', { class: 'budget-chart glass' }, title, donutPane, emptyMessage),
      el('section', { class: 'budget-sectors glass' }, el('p', { class: 'eyebrow' }, tx.sectors), sectorList),
      projectsPane));

    donutSvg = d3.select(donutPane).insert('svg', ':first-child').attr('class', 'donut').attr('role', 'img');
    donutGroup = donutSvg.append('g');

    resizeObserver = new ResizeObserver(() => layoutDonut(donutPane));
    resizeObserver.observe(donutPane);

    fiscalYear = state.fiscalYear || (await latestFiscalYear());
    await load();
  }

  async function update(state) {
    const next = state.fiscalYear || (await latestFiscalYear());
    if (next !== fiscalYear) {
      fiscalYear = next;
      selectedSectorId = null;
      selectedProjectId = null;
      await load();
    }
  }

  async function onData(keys) {
    if (keys.has('*') || keys.has(fiscalYear) || !fiscalYear) {
      await load();
      return;
    }
    console.log(`[wall] Budget: change was for fiscal year ${[...keys].join(', ')}, but ${fiscalYear} is on air — nothing to redraw`);
  }

  function unmount() {
    abort.abort();
    resizeObserver?.disconnect();
  }

  async function latestFiscalYear() {
    const years = (await getJson('/api/budget/fiscal-years', abort.signal)) ?? [];
    return years[0] ?? null;
  }

  async function load() {
    sectors = fiscalYear
      ? ((await getJson(`/api/budget/sectors?fiscalYear=${encodeURIComponent(fiscalYear)}`, abort.signal)) ?? [])
      : [];

    const total = d3.sum(sectors, s => s.totalAllocation);
    title.replaceChildren(
      el('span', { class: 'eyebrow' }, tx.total(fiscalYear)),
      el('span', { class: 'hero-value' }, num(total), el('small', {}, ` ${tx.crore}`)));

    emptyMessage.textContent = sectors.length ? '' : tx.empty;
    emptyMessage.hidden = sectors.length > 0;

    // Largest five get their own slice; the rest fold into "Other".
    const top = sectors.slice(0, sectors.length <= TOP_SECTORS + 1 ? sectors.length : TOP_SECTORS);
    const rest = sectors.slice(top.length);
    colorOf = categoricalScale(top.map(s => s.name));
    slices = [
      ...top.map(s => ({ key: s.name, value: s.totalAllocation, sectorIds: [s.id] })),
      ...(rest.length ? [{ key: OTHER, value: d3.sum(rest, s => s.totalAllocation), sectorIds: rest.map(s => s.id) }] : [])
    ].filter(s => s.value > 0);

    if (!sectors.some(s => s.id === selectedSectorId)) {
      // Open on the largest sector that has projects, so the projects panel isn't empty on air.
      selectedSectorId = (sectors.find(s => s.megaProjects.length) ?? sectors[0])?.id ?? null;
      selectedProjectId = null;
    }

    render();
  }

  function sectorColor(sector) {
    return slices.some(s => s.key === sector.name) ? colorOf(sector.name) : NEUTRAL;
  }

  function render() {
    renderDonut();
    renderCenter();
    renderSectorList();
    renderProjects();
  }

  function layoutDonut(pane) {
    const { width, height } = pane.getBoundingClientRect();
    radius = Math.max(40, Math.min(width, height) / 2 - 24);
    donutSvg.attr('viewBox', `${-width / 2} ${-height / 2} ${width} ${height}`);
    renderDonut(false);
  }

  function renderDonut(animate = true) {
    if (!radius) return;
    const pie = d3.pie().value(d => d.value).sort(null);
    // 2px surface gap between slices at the outer edge.
    const arc = d3.arc().innerRadius(radius * 0.62).cornerRadius(4).padAngle(2 / radius);
    const selectedSlice = slices.find(s => s.sectorIds.includes(selectedSectorId));
    const outer = d => (d.data === selectedSlice ? radius : radius - 14);

    donutSvg.attr('aria-label', `Allocation by sector: ${slices.map(s => s.key).join(', ')}`);

    donutGroup.selectAll('path')
      .data(pie(slices), d => d.data.key)
      .join(
        enter => enter.append('path')
          .attr('class', 'slice')
          .each(function (d) { this._current = { ...d, endAngle: d.startAngle }; }),
        updateSel => updateSel,
        exit => exit.remove())
      .attr('fill', d => (d.data.key === OTHER ? NEUTRAL : colorOf(d.data.key)))
      .classed('selected', d => d.data === selectedSlice)
      .on('click', (event, d) => selectSector(d.data.sectorIds[0]))
      .transition()
      .duration(animate && !prefersReducedMotion() ? 700 : 0)
      .attrTween('d', function (d) {
        const interpolate = d3.interpolate(this._current, d);
        const target = outer(d);
        const from = this._outer ?? target;
        this._current = d;
        this._outer = target;
        return t => arc.outerRadius(from + (target - from) * t)(interpolate(t));
      });
  }

  function renderCenter() {
    const sector = sectors.find(s => s.id === selectedSectorId);
    const total = d3.sum(sectors, s => s.totalAllocation);
    centerLabel.replaceChildren(...(sector
      ? [
          el('span', { class: 'donut-share' }, pct(total ? (sector.totalAllocation / total) * 100 : 0)),
          el('span', { class: 'donut-name' }, sector.name),
          el('span', { class: 'muted' }, taka(sector.totalAllocation))
        ]
      : []));
  }

  function renderSectorList() {
    const total = d3.sum(sectors, s => s.totalAllocation);
    const max = d3.max(sectors, s => s.totalAllocation) || 1;

    sectorList.replaceChildren(...sectors.map(sector =>
      el('li', {},
        el('button', {
          class: `sector-row${sector.id === selectedSectorId ? ' selected' : ''}`,
          type: 'button',
          'aria-pressed': String(sector.id === selectedSectorId),
          onclick: () => selectSector(sector.id)
        },
          el('span', { class: 'swatch', style: `background:${sectorColor(sector)}` }),
          el('span', { class: 'sector-name' }, sector.name),
          el('span', { class: 'sector-amount' }, num(sector.totalAllocation)),
          el('span', { class: 'sector-share muted' }, pct(total ? (sector.totalAllocation / total) * 100 : 0)),
          el('span', { class: 'sector-bar' },
            el('span', { style: `width:${(sector.totalAllocation / max) * 100}%;background:${sectorColor(sector)}` }))))));
  }

  function renderProjects() {
    const sector = sectors.find(s => s.id === selectedSectorId);
    if (!sector) {
      projectsPane.replaceChildren(el('p', { class: 'hint' }, tx.select));
      return;
    }

    const projects = sector.megaProjects;
    const share = sector.totalAllocation ? (sector.megaProjectsTotal / sector.totalAllocation) * 100 : 0;

    projectsPane.replaceChildren(
      el('p', { class: 'eyebrow' }, tx.megaProjects),
      el('h2', { class: 'panel-title' }, sector.name),
      el('p', { class: 'muted' },
        projects.length
          ? tx.projectsSummary(projects.length, sector.megaProjectsTotal, share)
          : tx.noProjects),
      el('ol', { class: 'project-list' }, projects.map(project => projectCard(sector, project))));
  }

  function projectCard(sector, project) {
    const expanded = project.id === selectedProjectId;
    const shareOfSector = sector.totalAllocation ? (project.budgetAmount / sector.totalAllocation) * 100 : 0;

    return el('li', {},
      el('button', {
        class: `project-card${expanded ? ' expanded' : ''}`,
        type: 'button',
        'aria-expanded': String(expanded),
        onclick: () => {
          selectedProjectId = expanded ? null : project.id;
          renderProjects();
        }
      },
        el('span', { class: 'project-head' },
          el('span', { class: 'project-name' }, project.name),
          el('span', { class: 'project-amount' }, taka(project.budgetAmount))),
        el('span', { class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': project.completionPercentage, 'aria-label': 'Completion' },
          el('span', { class: 'meter-fill', style: `width:${project.completionPercentage}%` })),
        el('span', { class: 'project-sub' },
          el('span', {}, tx.complete(project.completionPercentage)),
          project.geoLocation ? el('span', { class: 'muted' }, bnDigits(project.geoLocation)) : null),
        expanded
          ? el('span', { class: 'project-more' },
              el('span', {}, `${tx.shareOfSector} `, el('strong', {}, pct(shareOfSector))),
              el('span', {}, `${tx.remaining} `, el('strong', {}, pct(100 - project.completionPercentage))))
          : null));
  }

  function selectSector(id) {
    if (id === selectedSectorId) return;
    selectedSectorId = id;
    selectedProjectId = null;
    render();
  }

  return { mount, update, onData, unmount };
}
