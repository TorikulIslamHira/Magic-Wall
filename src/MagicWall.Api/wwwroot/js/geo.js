// Geographic maps (D3 + GeoJSON) shared by the Election and War views.
import { prefersReducedMotion } from './dom.js';

// Vendored UMD build, loaded by magic-wall.html from lib/d3 (no CDN on air-gapped networks).
const { d3 } = window;

const cache = new Map();
let nextId = 0;

/** Fetches a GeoJSON FeatureCollection once per page load; resolves to null if the file is missing. */
export function loadGeoJson(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url)
      .then(r => (r.ok ? r.json() : null))
      .then(geo => (geo ? rewindForD3(geo) : null))
      .catch(() => null));
  }
  return cache.get(url);
}

/**
 * D3 treats polygons as spherical, with exterior rings wound clockwise; standard GeoJSON
 * (RFC 7946) winds them anticlockwise. D3 reads such a ring as "the whole globe except
 * this shape" and fills the entire map. Any feature covering more than a hemisphere is
 * therefore wound the wrong way round, and gets its rings reversed.
 */
function rewindForD3(collection) {
  for (const feature of collection.features) {
    if (!feature.geometry || d3.geoArea(feature) <= 2 * Math.PI) continue;
    const { type, coordinates } = feature.geometry;
    const polygons = type === 'Polygon' ? [coordinates] : type === 'MultiPolygon' ? coordinates : [];
    for (const polygon of polygons) for (const ring of polygon) ring.reverse();
  }
  return collection;
}

/**
 * Creates a zoomable SVG map in `container`, with the projection fitted to `fitTo`.
 * The viewBox is fixed at creation, so the map scales with the container without re-projecting.
 */
export function createGeoMap(container, fitTo, { projection = d3.geoMercator(), padding = 28, maxZoom = 14, onZoom } = {}) {
  const bounds = container.getBoundingClientRect();
  const width = Math.max(320, bounds.width);
  const height = Math.max(240, bounds.height);

  const svg = d3.select(container).append('svg')
    .attr('class', 'geo')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const defs = svg.append('defs');
  const glowId = `geo-glow-${++nextId}`;
  const glow = defs.append('filter').attr('id', glowId).attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%');
  glow.append('feGaussianBlur').attr('stdDeviation', 8).attr('result', 'blur');
  const merge = glow.append('feMerge');
  merge.append('feMergeNode').attr('in', 'blur');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');

  projection.fitExtent([[padding, padding], [width - padding, height - padding]], fitTo);
  const path = d3.geoPath(projection);
  const layer = svg.append('g').attr('class', 'geo-layer');

  const zoom = d3.zoom()
    .scaleExtent([1, maxZoom])
    .translateExtent([[-width * 0.5, -height * 0.5], [width * 1.5, height * 1.5]])
    .on('zoom', event => {
      layer.attr('transform', event.transform);
      onZoom?.(event.transform.k);
    });
  svg.call(zoom).on('dblclick.zoom', null);

  const duration = ms => (prefersReducedMotion() ? 0 : ms);

  /** Smoothly frames a feature (or FeatureCollection), filling ~80% of the view. */
  function zoomTo(target, { maxScale = 8, ms = 900 } = {}) {
    const [[x0, y0], [x1, y1]] = path.bounds(target);
    const k = Math.min(maxScale, 0.8 / Math.max((x1 - x0) / width, (y1 - y0) / height));
    const transform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(Math.max(1, k))
      .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    svg.transition().duration(duration(ms)).ease(d3.easeCubicInOut).call(zoom.transform, transform);
  }

  function reset(ms = 750) {
    svg.transition().duration(duration(ms)).ease(d3.easeCubicInOut).call(zoom.transform, d3.zoomIdentity);
  }

  return { svg, defs, layer, path, width, height, glowId, zoomTo, reset };
}

export const collection = features => ({ type: 'FeatureCollection', features });
