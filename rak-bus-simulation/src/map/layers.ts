/**
 * deck.gl layer factory.
 *
 * Builds the layer stack rendered on top of MapLibre: route polylines,
 * stop markers (3D columns at termini, flat icons otherwise), and the
 * moving bus icons. Layers are stateless — each render rebuilds them.
 */

import { ColumnLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Bus, TransportNetwork } from '../types/transport';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length !== 6) return [80, 80, 80];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export interface BuildLayersOpts {
  network: TransportNetwork;
  buses: Bus[];
  selectedRoute: string | null;
  selectedPattern: string | null;
  visiblePatterns: Set<string>;
}

export function buildLayers(opts: BuildLayersOpts) {
  const { network, buses, selectedRoute, selectedPattern, visiblePatterns } = opts;

  // ---- Route polylines (one per pattern) ------------------------------
  const pathData: {
    patternCode: string;
    route: string;
    path: [number, number][];
    color: [number, number, number, number];
    width: number;
  }[] = [];

  for (const [patternCode, geom] of network.patternGeometry) {
    if (!visiblePatterns.has(patternCode)) continue;
    if (geom.length < 2) continue;
    const pattern = network.patterns.get(patternCode);
    if (!pattern) continue;
    const route = network.routes.get(pattern.route);
    const rgb = hexToRgb(route?.color ?? '#888');
    const isSelected =
      (selectedRoute && pattern.route === selectedRoute) ||
      (selectedPattern && patternCode === selectedPattern);
    const dim = !!(selectedRoute || selectedPattern) && !isSelected;
    pathData.push({
      patternCode,
      route: pattern.route,
      path: geom,
      color: [...rgb, dim ? 60 : 220] as [number, number, number, number],
      width: pattern.direction === 'Up' ? 6 : 4,
    });
  }

  const routeLayer = new PathLayer({
    id: 'routes',
    data: pathData,
    getPath: (d) => d.path,
    getColor: (d) => d.color,
    getWidth: (d) => d.width,
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
    pickable: true,
  });

  // ---- Stops: scatterplot for normal stops, columns for termini -------
  const allStops = [...network.stops.values()].filter(
    s => Number.isFinite(s.latitude) && Number.isFinite(s.longitude),
  );

  const stopLayer = new ScatterplotLayer({
    id: 'stops',
    data: allStops,
    getPosition: (s) => [s.longitude, s.latitude],
    getRadius: () => 60,
    radiusUnits: 'meters',
    radiusMinPixels: 4,
    radiusMaxPixels: 10,
    getFillColor: (s) => (s.chargingPointFlag ? [34, 211, 238, 230] : [255, 255, 255, 230]),
    getLineColor: [15, 23, 42, 255],
    lineWidthMinPixels: 1.5,
    stroked: true,
    pickable: true,
  });

  const termini = allStops.filter(s => s.chargingPointFlag);
  const terminusColumns = new ColumnLayer({
    id: 'termini-columns',
    data: termini,
    diskResolution: 12,
    radius: 120,
    extruded: true,
    pickable: false,
    elevationScale: 1,
    getPosition: (s) => [s.longitude, s.latitude],
    getFillColor: [34, 211, 238, 200],
    getLineColor: [15, 23, 42, 255],
    getElevation: () => 180,
  });

  // ---- Buses: 3D columns colored by route, oriented by bearing --------
  const busData = buses.filter(b => b.status !== 'completed');
  const busLayer = new ColumnLayer({
    id: 'buses',
    data: busData,
    diskResolution: 6,
    radius: 70,
    extruded: true,
    elevationScale: 1,
    pickable: true,
    getPosition: (b: Bus) => b.position,
    getFillColor: (b: Bus) => {
      const rgb = hexToRgb(b.color);
      // tint deeper red as the bus runs later
      const lateness = Math.max(-1, Math.min(1, b.delaySec / 300));
      if (lateness > 0) {
        return [Math.min(255, rgb[0] + lateness * 50), rgb[1] * (1 - lateness * 0.3), rgb[2] * (1 - lateness * 0.3), 240];
      }
      return [...rgb, 240] as [number, number, number, number];
    },
    getLineColor: [15, 23, 42, 255],
    getElevation: () => 280,
  });

  // ---- Stop labels for termini ---------------------------------------
  const labelLayer = new TextLayer({
    id: 'terminus-labels',
    data: termini,
    getPosition: (s) => [s.longitude, s.latitude],
    getText: (s) => s.terminusName ?? s.stopName,
    getSize: 12,
    getColor: [248, 250, 252, 255],
    getPixelOffset: [0, -22],
    fontFamily: '-apple-system, system-ui, sans-serif',
    fontWeight: 600,
    background: true,
    getBackgroundColor: [15, 23, 42, 200],
    backgroundPadding: [6, 3, 6, 3],
    sizeUnits: 'pixels',
  });

  return [routeLayer, terminusColumns, stopLayer, busLayer, labelLayer];
}
