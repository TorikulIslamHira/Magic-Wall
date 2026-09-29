// Election view: Bangladesh map coloured by leading party, seat race bar, and a
// drill-down panel (national -> district -> seat).
//
// Map level: seat-level when maps/bd-constituencies.geojson exists (feature `code` =
// SvgPathId), otherwise the 64-district map, where each district takes the colour of
// the party leading most of its seats.
import { getJson } from '../api.js';
import { el, setChildren } from '../dom.js';
import { collection, createGeoMap, loadGeoJson } from '../geo.js';
import { num, pct, t } from '../i18n.js';
import { partyColorScale } from '../parties.js';

// Vendored UMD build, loaded by magic-wall.html from lib/d3.
const { d3 } = window;

const NO_RESULT = '#1f2b45';     // land with no results yet: recedes into the background
const TIE = '#64748b';           // district where two parties lead the same number of seats
const LABEL_ZOOM = 1.7;          // district names appear once zoomed in this far
const DISTRICT_ZOOM = 3.5;       // cap when framing a district, so its neighbours stay in view

export function createElectionView() {
  const abort = new AbortController();
  const tx = t.election;

  let seats = [];                 // ConstituencySummaryDto[]
  let seatsById = new Map();
  let districts = null;           // district FeatureCollection
  let districtByCode = new Map();
  let seatMap = null;             // optional seat-level FeatureCollection
  let colorOf = () => NO_RESULT;

  let map, regions, labels, panel, race, stage;
  let selectedDistrict = null;
  let selectedSeat = null;
  let detailRequest = 0;
  let zoomLevel = 1;

  async function mount(container, state) {
    stage = el('div', { class: 'map-stage' });
    panel = el('aside', { class: 'side-panel glass' });
    race = el('section', { class: 'race glass' });
    container.append(el('div', { class: 'election' },
      el('div', { class: 'map-card glass' }, stage, el('p', { class: 'map-credit' }, 'সীমানা: BBS / OCHA (geoBoundaries)')),
      panel,
      race));

    const [summaries, candidates, districtGeo, divisionGeo, seatGeo] = await Promise.all([
      getJson('/api/election/constituencies', abort.signal),
      getJson('/api/election/candidates', abort.signal),
      loadGeoJson('/maps/bd-districts.geojson'),
      loadGeoJson('/maps/bd-divisions.geojson'),
      loadGeoJson('/maps/bd-constituencies.geojson')
    ]);

    districts = districtGeo;
    districtByCode = new Map(districts.features.map(f => [f.properties.code, f]));
    seatMap = seatGeo;
    colorOf = await partyColorScale((candidates ?? []).map(c => c.partyName));

    buildMap(divisionGeo);
    setSeats(summaries ?? []);

    if (state.svgPathId) await selectSeat(state.svgPathId);
    else renderPanel();
  }

  async function update(state) {
    if (state.svgPathId && state.svgPathId !== selectedSeat) await selectSeat(state.svgPathId);
  }

  async function onData(keys) {
    setSeats((await getJson('/api/election/constituencies', abort.signal)) ?? []);
    if (selectedSeat && (keys.has('*') || keys.has(selectedSeat))) await loadSeatDetail(selectedSeat, false);
    else if (!selectedSeat) renderPanel();
  }

  function unmount() {
    abort.abort();
  }

  // ---------- map ----------

  function buildMap(divisionGeo) {
    const shapes = seatMap ?? districts;
    map = createGeoMap(stage, districts, { onZoom: k => { zoomLevel = k; styleLabels(); } });

    // Soft glow under the whole country lifts the map off the background.
    map.layer.append('g').attr('class', 'country-glow')
      .selectAll('path').data(districts.features).join('path')
      .attr('d', map.path)
      .attr('filter', `url(#${map.glowId})`);

    regions = map.layer.append('g').attr('class', 'regions')
      .selectAll('path').data(shapes.features).join('path')
      .attr('class', 'region')
      .attr('d', map.path)
      .attr('tabindex', 0)
      .attr('aria-label', f => f.properties.name_bn ?? f.properties.code)
      .on('click', (event, f) => {
        event.stopPropagation();
        if (seatMap) selectSeat(f.properties.code);
        else selectDistrict(f.properties.code === selectedDistrict ? null : f.properties.code);
      })
      .on('keydown', (event, f) => {
        if (event.key !== 'Enter') return;
        if (seatMap) selectSeat(f.properties.code);
        else selectDistrict(f.properties.code);
      });

    if (divisionGeo) {
      map.layer.append('g').attr('class', 'division-lines')
        .selectAll('path').data(divisionGeo.features).join('path')
        .attr('d', map.path);
    }

    labels = map.layer.append('g').attr('class', 'region-labels')
      .selectAll('text').data(districts.features).join('text')
      .attr('transform', f => `translate(${map.path.centroid(f)})`)
      .text(f => f.properties.name_bn);

    // Tapping the sea returns to the national view.
    map.svg.on('click', () => { if (selectedDistrict || selectedSeat) selectDistrict(null); });
    styleLabels();
  }

  function styleLabels() {
    labels
      ?.classed('visible', f => zoomLevel >= LABEL_ZOOM || f.properties.code === selectedDistrict)
      .style('font-size', `${14 / zoomLevel}px`)
      .style('stroke-width', `${3 / zoomLevel}px`);
  }

  function setSeats(list) {
    seats = list;
    seatsById = new Map(seats.map(s => [s.svgPathId, s]));
    paintMap();
    renderRace();
  }

  /**
   * District colour = party leading most of its seats; opacity = how dominant that lead is.
   * Equal seat counts (common in 2-seat districts) are broken by the parties' combined
   * winning margins there, so grey only means a genuinely exact tie.
   */
  function districtStanding(code) {
    const inDistrict = seats.filter(s => s.districtCode === code);
    const tally = d3.rollup(
      inDistrict.filter(s => s.leadingParty),
      v => ({ seats: v.length, margin: d3.sum(v, s => s.leadMargin) }),
      s => s.leadingParty);
    const ranked = [...tally].sort((a, b) => b[1].seats - a[1].seats || b[1].margin - a[1].margin);
    if (!ranked.length) return { color: NO_RESULT, share: 0 };
    const [first, second] = ranked;
    const tie = second && first[1].seats === second[1].seats && first[1].margin === second[1].margin;
    return { color: tie ? TIE : colorOf(first[0]), share: first[1].seats / Math.max(1, inDistrict.length) };
  }

  function paintMap() {
    if (!regions) return;
    regions
      .classed('selected', f => (seatMap ? f.properties.code === selectedSeat : f.properties.code === selectedDistrict))
      .transition().duration(600)
      .style('fill', f => {
        if (seatMap) return colorOf(seatsById.get(f.properties.code)?.leadingParty ?? null) ?? NO_RESULT;
        return districtStanding(f.properties.code).color;
      })
      .style('fill-opacity', f => (seatMap ? 1 : 0.55 + 0.45 * districtStanding(f.properties.code).share));
    stage.classList.toggle('has-selection', Boolean(selectedDistrict || selectedSeat));
  }

  // ---------- selection ----------

  function selectDistrict(code) {
    selectedDistrict = code;
    selectedSeat = null;
    detailRequest++;
    const feature = code && districtByCode.get(code);
    if (feature) map.zoomTo(feature, { maxScale: DISTRICT_ZOOM });
    else map.reset();
    paintMap();
    styleLabels();
    renderPanel();
  }

  async function selectSeat(svgPathId) {
    const seat = seatsById.get(svgPathId);
    selectedSeat = svgPathId;
    const code = seat?.districtCode ?? null;
    if (code !== selectedDistrict) {
      selectedDistrict = code;
      const feature = code && districtByCode.get(code);
      if (feature) map.zoomTo(feature, { maxScale: DISTRICT_ZOOM });
    }
    paintMap();
    styleLabels();
    await loadSeatDetail(svgPathId, true);
  }

  async function loadSeatDetail(svgPathId, animate) {
    const request = ++detailRequest;
    const dto = await getJson(`/api/election/results/${encodeURIComponent(svgPathId)}`, abort.signal);
    if (request !== detailRequest) return;   // a newer tap won the race
    if (!dto) {
      setChildren(panel, el('p', { class: 'muted' }, tx.notFound));
      return;
    }
    renderSeat(dto, animate);
  }

  // ---------- side panel ----------

  function renderPanel() {
    if (selectedDistrict) renderDistrict(selectedDistrict);
    else renderNational();
  }

  function partyTally() {
    const tally = d3.rollup(seats.filter(s => s.leadingParty), v => v.length, s => s.leadingParty);
    return [...tally].sort((a, b) => b[1] - a[1]);
  }

  function renderNational() {
    const tally = partyTally();
    const declared = d3.sum(tally, d => d[1]);
    const majority = Math.floor(seats.length / 2) + 1;

    setChildren(panel,
      el('p', { class: 'eyebrow' }, tx.national),
      el('div', { class: 'hero' },
        el('span', { class: 'hero-value' }, num(declared)),
        el('span', { class: 'hero-caption' }, tx.declared(declared, seats.length))),
      el('ol', { class: 'standings' }, tally.map(([party, count]) =>
        el('li', { class: 'standing' },
          el('span', { class: 'swatch lg', style: `background:${colorOf(party)}` }),
          el('span', { class: 'standing-name' }, party),
          el('span', { class: 'standing-seats' }, num(count)),
          el('span', { class: 'standing-bar' },
            el('span', { style: `width:${Math.min(100, (count / majority) * 100)}%;background:${colorOf(party)}` }))))),
      el('p', { class: 'hint' }, tx.tapHint));
  }

  function renderDistrict(code) {
    const feature = districtByCode.get(code);
    const inDistrict = seats
      .filter(s => s.districtCode === code)
      .sort((a, b) => a.name.localeCompare(b.name, 'bn', { numeric: true }));

    setChildren(panel,
      el('button', { class: 'back', type: 'button', onclick: () => selectDistrict(null) }, `← ${tx.national}`),
      el('p', { class: 'eyebrow' }, `${feature?.properties.division_bn ?? ''} বিভাগ`),
      el('h2', { class: 'panel-title' }, feature?.properties.name_bn ?? code),
      el('p', { class: 'muted' }, tx.seats(inDistrict.length)),
      el('ol', { class: 'seat-list' }, inDistrict.map(seat =>
        el('li', {},
          el('button', { class: 'seat-row', type: 'button', onclick: () => selectSeat(seat.svgPathId) },
            el('span', { class: 'swatch lg', style: `background:${seat.leadingParty ? colorOf(seat.leadingParty) : NO_RESULT}` }),
            el('span', { class: 'seat-name' }, seat.name,
              el('small', {}, seat.leadingParty ? `${seat.leadingCandidate} · ${seat.leadingParty}` : tx.undeclared)),
            seat.leadingParty ? el('span', { class: 'seat-margin' }, `+${num(seat.leadMargin)}`) : null)))));
  }

  function renderSeat(dto, animate) {
    const leader = dto.results[0];
    const runnerUp = dto.results[1];
    const hasVotes = dto.totalVotesCast > 0;
    const district = dto.districtCode && districtByCode.get(dto.districtCode);

    const rows = dto.results.map((r, i) => {
      const fill = el('span', { class: 'bar-fill', style: `background:${colorOf(r.partyName)};width:${animate ? 0 : r.voteSharePercentage}%` });
      return {
        fill,
        share: r.voteSharePercentage,
        node: el('li', { class: `result${i === 0 && hasVotes ? ' leading' : ''}` },
          el('div', { class: 'result-head' },
            el('span', { class: 'swatch lg', style: `background:${colorOf(r.partyName)}` }),
            el('span', { class: 'candidate' }, r.candidateName),
            el('span', { class: 'votes' }, num(r.votesReceived))),
          el('div', { class: 'result-sub' },
            el('span', {}, r.symbol ? `${r.partyName} · ${r.symbol}` : r.partyName),
            el('span', {}, pct(r.voteSharePercentage))),
          el('div', { class: 'bar' }, fill))
      };
    });

    setChildren(panel,
      district
        ? el('button', { class: 'back', type: 'button', onclick: () => selectDistrict(dto.districtCode) }, `← ${district.properties.name_bn}`)
        : el('button', { class: 'back', type: 'button', onclick: () => selectDistrict(null) }, `← ${tx.national}`),
      el('p', { class: 'eyebrow' }, district ? `${district.properties.name_bn} জেলা` : tx.national),
      el('h2', { class: 'panel-title' }, dto.name),
      el('div', { class: 'stats' },
        stat(tx.turnout, pct(dto.turnoutPercentage)),
        stat(tx.votesCast, num(dto.totalVotesCast)),
        stat(tx.registered, num(dto.totalVoters))),
      hasVotes && leader && runnerUp
        ? el('p', { class: 'lead-line' }, tx.leadsBy(leader.partyName, leader.votesReceived - runnerUp.votesReceived))
        : null,
      rows.length ? el('ol', { class: 'results' }, rows.map(r => r.node)) : el('p', { class: 'muted' }, tx.noCandidates));

    if (animate) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        for (const r of rows) r.fill.style.width = `${r.share}%`;
      }));
    }
  }

  // ---------- seat race bar ----------

  function renderRace() {
    const total = Math.max(1, seats.length);
    const majority = Math.floor(seats.length / 2) + 1;
    const tally = partyTally();
    const declared = d3.sum(tally, d => d[1]);

    setChildren(race,
      el('div', { class: 'race-head' },
        el('span', { class: 'race-title' }, tx.raceTitle),
        el('span', { class: 'muted' }, tx.declared(declared, seats.length))),
      el('div', { class: 'race-track' },
        tally.map(([party, count]) =>
          el('span', { class: 'race-seg', style: `width:${(count / total) * 100}%;background:${colorOf(party)}`, title: `${party}: ${num(count)}` },
            count / total > 0.06 ? el('span', { class: 'race-seg-label' }, num(count)) : null)),
        el('span', { class: 'race-majority', style: `left:${(majority / total) * 100}%` },
          el('span', {}, tx.majority(majority)))),
      el('div', { class: 'race-legend' },
        tally.map(([party, count]) =>
          el('span', { class: 'legend-item' }, el('span', { class: 'swatch', style: `background:${colorOf(party)}` }), `${party} `, el('strong', {}, num(count)))),
        seats.length - declared
          ? el('span', { class: 'legend-item muted' }, el('span', { class: 'swatch', style: `background:${NO_RESULT}` }), `${tx.undeclared} `, el('strong', {}, num(seats.length - declared)))
          : null));
  }

  return { mount, update, onData, unmount };
}

function stat(label, value) {
  return el('div', { class: 'stat' }, el('span', { class: 'stat-label' }, label), el('span', { class: 'stat-value' }, value));
}
