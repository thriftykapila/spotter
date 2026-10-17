import { memo, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import type { FeatureCollection, LineString, Point } from 'geojson';
import { MapPin, Maximize } from 'lucide-react';
import {
  forecastColorExpression,
  levelColorExpression,
  riskByScore,
  riskColors,
  riskNames,
} from './risk';
import { formatTime } from './time';
import type { Checkpoint, Corridor, RiskLevel, Trip } from './types';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// Vite relocates the library module; emit its module worker as a real asset.
maplibregl.setWorkerUrl(workerUrl);
maplibregl.setWorkerCount(2);

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const CITY_POINTS: FeatureCollection<Point> = {
  type: 'FeatureCollection',
  features: [
    ['Denver', -104.9903, 39.7392],
    ['Colorado Springs', -104.8214, 38.8339],
    ['Pueblo', -104.6091, 38.2544],
    ['Colby', -101.0524, 39.3958],
    ['Hays', -99.3268, 38.8792],
    ['Salina', -97.6114, 38.8403],
    ['Topeka', -95.6752, 39.0473],
    ['Kansas City', -94.5786, 39.0997],
    ['Lincoln', -96.7026, 40.8136],
    ['Omaha', -95.9345, 41.2565],
    ['Wichita', -97.3301, 37.6872],
    ['Fort Collins', -105.0844, 40.5853],
  ].map(([name, lon, lat]) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(lon), Number(lat)] },
    properties: { name },
  })),
};
// The keyless overview uses local public-domain geography and local system fonts.
// No style, tile, or glyph server is required to inspect a sample trip.
const LOCAL_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    land: {
      type: 'geojson',
      data: '/us-land.geojson',
      attribution: 'Geography: Natural Earth (public domain)',
    },
    states: { type: 'geojson', data: '/us-states.geojson' },
    cities: { type: 'geojson', data: CITY_POINTS },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#e8eef0' } },
    { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#f7f7f1' } },
    {
      id: 'land-outline',
      type: 'line',
      source: 'land',
      paint: { 'line-color': '#c7cfcb', 'line-width': 1.3 },
    },
    {
      id: 'state-boundaries',
      type: 'line',
      source: 'states',
      paint: { 'line-color': '#d1d6d1', 'line-width': 0.8 },
    },
    {
      id: 'city-points',
      type: 'circle',
      source: 'cities',
      paint: { 'circle-radius': 2.5, 'circle-color': '#7c8792' },
    },
    {
      id: 'city-labels',
      type: 'symbol',
      source: 'cities',
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 0.6],
      },
      paint: { 'text-color': '#5d6878', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    },
  ],
};
function baseStyle(): string | StyleSpecification {
  const key = import.meta.env.VITE_TOMTOM_MAP_KEY;
  if (!key) return LOCAL_STYLE;
  return {
    version: 8,
    sources: {
      tomtom: {
        type: 'raster',
        tiles: [
          `https://api.tomtom.com/maps/orbis/display/raster/tile/{z}/{x}/{y}?apiVersion=2&key=${encodeURIComponent(key)}&style=street-light&tileSize=256`,
        ],
        tileSize: 256,
        attribution: '© TomTom · © OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'tomtom' }],
  };
}
function source(map: maplibregl.Map, id: string, data: FeatureCollection) {
  const existing = map.getSource(id) as GeoJSONSource | undefined;
  if (existing) existing.setData(data);
  else map.addSource(id, { type: 'geojson', data });
}
function fitRoute(map: maplibregl.Map, trip: Trip, id: string) {
  const selected = trip.routes.find((item) => item.id === id);
  const routes = selected ? [selected] : trip.routes;
  if (!routes.some((route) => route.geometry.coordinates.length)) return;
  const bounds = new maplibregl.LngLatBounds();
  routes.forEach((route) =>
    route.geometry.coordinates.forEach((point) => bounds.extend([point[0], point[1]])),
  );
  map.fitBounds(bounds, {
    padding: { top: 70, right: 55, bottom: 55, left: 55 },
    maxZoom: 10,
    duration: 0,
  });
}
function riskTitleNode(level: RiskLevel, context: 'risk' | 'corridor risk') {
  const title = document.createElement('strong');
  title.className = `risk-badge risk-${level}`;
  const dot = document.createElement('span');
  dot.className = 'risk-dot';
  dot.setAttribute('aria-hidden', 'true');
  title.append(dot, `${riskNames[level]} ${context}`);
  return title;
}
function checkpointNode(checkpoint: Checkpoint, timezone: string) {
  const div = document.createElement('div');
  div.className = 'map-popup';
  div.append(riskTitleNode(checkpoint.risk.level, 'risk'));
  const eta = document.createElement('p');
  eta.textContent = `ETA ${formatTime(checkpoint.eta, timezone)}`;
  div.append(eta);
  if (checkpoint.weather) {
    const weather = document.createElement('p');
    weather.textContent = `Wind ${checkpoint.weather.wind_mph.toFixed(1)} mph · Gust ${checkpoint.weather.gust_mph?.toFixed(1) ?? 'unavailable'} mph`;
    div.append(weather);
    const precipitation = document.createElement('p');
    precipitation.textContent = `Rain ${checkpoint.weather.rain_in_hr.toFixed(2)} · Snow ${checkpoint.weather.snow_in_hr.toFixed(2)} in/hr`;
    div.append(precipitation);
  }
  const reason = document.createElement('p');
  reason.textContent = checkpoint.risk.reasons.join('; ') || 'Below all risk thresholds.';
  div.append(reason);
  return div;
}
type Props = {
  trip?: Trip;
  selectedId: string;
  selectedCheckpoint: Checkpoint | null;
  corridor?: Corridor;
  hour: number;
  showHeatmap: boolean;
  onRouteSelect: (id: string) => void;
  onCheckpointSelect: (checkpoint: Checkpoint) => void;
};
function TripMap({
  trip,
  selectedId,
  selectedCheckpoint,
  corridor,
  hour,
  showHeatmap,
  onRouteSelect,
  onCheckpointSelect,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const fittedTrip = useRef('');
  const latest = useRef({ trip, corridor, hour, onRouteSelect, onCheckpointSelect });
  latest.current = { trip, corridor, hour, onRouteSelect, onCheckpointSelect };
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [basemapFailed, setBasemapFailed] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: baseStyle(),
        center: [-100, 39.5],
        zoom: 4,
        attributionControl: { compact: true },
        maxZoom: 16,
        renderWorldCopies: false,
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: false, showCompass: false }),
      'top-right',
    );
    let loaded = false;
    let usedFallback = false;
    const fallback = () => {
      if (!loaded && !usedFallback) {
        usedFallback = true;
        setBasemapFailed(true);
        map.setStyle(LOCAL_STYLE, { diff: false });
      }
    };
    const timer = window.setTimeout(fallback, 8000);
    map.on('error', () => {
      if (!loaded) fallback();
      else setBasemapFailed(true);
    });
    map.on('load', () => {
      loaded = true;
      clearTimeout(timer);
      setReady(true);
      map.on('click', 'checkpoints', (event) => {
        const feature = event.features?.[0];
        const currentTrip = latest.current.trip;
        const route = currentTrip?.routes.find((item) => item.id === feature?.properties?.route_id);
        const checkpoint = route?.checkpoints.find(
          (item) => item.id === feature?.properties?.checkpoint_id,
        );
        if (route && checkpoint) {
          latest.current.onRouteSelect(route.id);
          latest.current.onCheckpointSelect(checkpoint);
        }
      });
      map.on('click', 'route-hit', (event) => {
        if (map.queryRenderedFeatures(event.point, { layers: ['checkpoints'] }).length) return;
        const id = event.features?.[0]?.properties?.route_id;
        if (typeof id === 'string') latest.current.onRouteSelect(id);
      });
      map.on('click', 'corridor-fill', (event) => {
        if (
          event.originalEvent.defaultPrevented ||
          map.queryRenderedFeatures(event.point, { layers: ['checkpoints', 'route-hit'] }).length
        )
          return;
        const cell = latest.current.corridor?.cells.features.find(
          (item) => item.properties.id === event.features?.[0]?.properties?.id,
        );
        if (!cell) return;
        popupRef.current?.remove();
        const index = latest.current.hour;
        const risk = cell.properties.risks[index];
        const level = risk === null ? 'unknown' : (riskByScore[risk] ?? 'unknown');
        const div = document.createElement('div');
        div.className = 'map-popup';
        div.append(riskTitleNode(level, 'corridor risk'));
        const text = document.createElement('p');
        text.textContent = `+${index} hr · Wind ${cell.properties.wind_mph[index]?.toFixed(1) ?? 'unknown'} mph · Rain ${cell.properties.rain_in_hr[index]?.toFixed(2) ?? 'unknown'} in/hr · Snow ${cell.properties.snow_in_hr[index]?.toFixed(2) ?? 'unknown'} in/hr`;
        div.append(text);
        popupRef.current = new maplibregl.Popup({ maxWidth: '300px' })
          .setLngLat(event.lngLat)
          .setDOMContent(div)
          .addTo(map);
        popupRef.current
          .getElement()
          .querySelector('button')
          ?.setAttribute('aria-label', 'Close corridor weather details');
      });
      map.on('mousemove', (event) => {
        const layers = ['checkpoints', 'route-hit', 'corridor-fill'].filter((id) =>
          Boolean(map.getLayer(id)),
        );
        map.getCanvas().style.cursor =
          layers.length && map.queryRenderedFeatures(event.point, { layers }).length
            ? 'pointer'
            : '';
      });
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const routeFeatures: FeatureCollection<LineString> = {
      type: 'FeatureCollection',
      features:
        trip?.routes.map((route) => ({
          type: 'Feature' as const,
          geometry: route.geometry,
          properties: { route_id: route.id },
        })) ?? [],
    };
    const segments: FeatureCollection<LineString> = {
      type: 'FeatureCollection',
      features: trip?.routes.flatMap((route) => route.segments.features) ?? [],
    };
    const checkpoints: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features:
        trip?.routes.flatMap((route) =>
          route.checkpoints.map((checkpoint, index) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [checkpoint.lon, checkpoint.lat] },
            properties: {
              route_id: route.id,
              checkpoint_id: checkpoint.id,
              level: checkpoint.risk.level,
              index,
            },
          })),
        ) ?? [],
    };
    source(map, 'corridor', EMPTY);
    source(map, 'routes', routeFeatures);
    source(map, 'segments', segments);
    source(map, 'points', checkpoints);
    if (!map.getLayer('corridor-fill')) {
      map.addLayer({
        id: 'corridor-fill',
        type: 'fill',
        source: 'corridor',
        paint: {
          'fill-color': forecastColorExpression(0),
          'fill-opacity': 0.2,
          'fill-outline-color': 'rgba(255,255,255,.2)',
        },
      });
      map.addLayer({
        id: 'route-base',
        type: 'line',
        source: 'routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#fff', 'line-width': 8 },
      });
      map.addLayer({
        id: 'selected-casing',
        type: 'line',
        source: 'routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#2563eb', 'line-width': 10, 'line-opacity': 0 },
      });
      map.addLayer({
        id: 'risk-segments',
        type: 'line',
        source: 'segments',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': levelColorExpression, 'line-width': 4, 'line-opacity': 0.85 },
      });
      map.addLayer({
        id: 'route-hit',
        type: 'line',
        source: 'routes',
        paint: { 'line-color': '#000', 'line-width': 17, 'line-opacity': 0 },
      });
      map.addLayer({
        id: 'checkpoints',
        type: 'circle',
        source: 'points',
        paint: {
          'circle-color': levelColorExpression,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 9, 6],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#fff',
        },
      });
    }
  }, [ready, trip]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getSource('corridor')) return;
    // Forecast geometry is uploaded only when a new corridor arrives.
    source(map, 'corridor', corridor?.cells ?? EMPTY);
    popupRef.current?.remove();
  }, [ready, corridor, trip?.id]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getLayer('corridor-fill')) return;
    // Scrubbing changes one GPU expression; it never refetches or rebuilds geometry.
    map.setPaintProperty('corridor-fill', 'fill-color', forecastColorExpression(hour));
    map.setLayoutProperty('corridor-fill', 'visibility', showHeatmap ? 'visible' : 'none');
    popupRef.current?.remove();
  }, [ready, hour, showHeatmap]);
  useEffect(() => {
    const map = mapRef.current;
    if (!trip) fittedTrip.current = '';
    if (!ready || !map || !trip || !map.getLayer('selected-casing')) return;
    map.setPaintProperty('selected-casing', 'line-opacity', [
      'case',
      ['==', ['get', 'route_id'], selectedId],
      1,
      0,
    ]);
    map.setPaintProperty('risk-segments', 'line-width', [
      'case',
      ['==', ['get', 'route_id'], selectedId],
      5,
      3,
    ]);
    map.setPaintProperty('risk-segments', 'line-opacity', [
      'case',
      ['==', ['get', 'route_id'], selectedId],
      1,
      0.6,
    ]);
    popupRef.current?.remove();
    fitRoute(map, trip, fittedTrip.current === trip.id ? selectedId : '');
    fittedTrip.current = trip.id;
  }, [ready, selectedId, trip]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selectedCheckpoint || !trip) return;
    popupRef.current?.remove();
    map.easeTo({ center: [selectedCheckpoint.lon, selectedCheckpoint.lat], duration: 0 });
    popupRef.current = new maplibregl.Popup({ maxWidth: '300px' })
      .setLngLat([selectedCheckpoint.lon, selectedCheckpoint.lat])
      .setDOMContent(checkpointNode(selectedCheckpoint, trip.origin.timezone))
      .addTo(map);
    popupRef.current
      .getElement()
      .querySelector('button')
      ?.setAttribute('aria-label', 'Close checkpoint weather details');
  }, [ready, selectedCheckpoint, trip]);
  return (
    <div className="map-stage" aria-label="Route map">
      <div ref={container} className="map-canvas" data-testid="route-map" data-map-ready={ready} />
      {failed ? (
        <div className="map-fallback" role="status">
          <MapPin size={28} aria-hidden="true" />
          <strong>Interactive map unavailable</strong>
          <p>Routes and checkpoints are still available below.</p>
        </div>
      ) : null}
      {!failed ? (
        <>
          <div className="map-location-label">
            <MapPin size={15} aria-hidden="true" />
            {trip ? `${trip.origin.label} → ${trip.destination.label}` : 'United States'}
          </div>
          <button
            className="map-fit"
            disabled={!trip}
            onClick={() => {
              if (mapRef.current && trip) fitRoute(mapRef.current, trip, selectedId);
            }}
            aria-label="Fit selected route to map"
            title="Fit selected route"
          >
            <Maximize size={17} aria-hidden="true" />
          </button>
        </>
      ) : null}
      <div className="map-legend" aria-label="Weather risk legend">
        {(['low', 'moderate', 'high', 'severe', 'no_travel', 'unknown'] as const).map((level) => (
          <span key={level}>
            <i style={{ background: riskColors[level] }} aria-hidden="true" />
            {riskNames[level]}
          </span>
        ))}
      </div>
      {basemapFailed ? <div className="basemap-note">Street map unavailable</div> : null}
    </div>
  );
}
export default memo(TripMap);
