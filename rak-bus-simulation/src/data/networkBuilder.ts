/**
 * Transport-network builder.
 *
 * Takes raw parsed rows and produces a denormalized, lookup-friendly
 * TransportNetwork object the simulation, map, and KPI engines consume.
 */

import type {
  Pattern,
  Route,
  RoutePatternStop,
  Stop,
  TransportNetwork,
} from '../types/transport';
import {
  SEED_PATTERNS,
  SEED_ROUTES,
  SEED_ROUTE_PATTERN_STOPS,
  SEED_STOPS,
} from './seedData';

export function buildNetwork(input: {
  stops: Stop[];
  routes: Route[];
  patterns: Pattern[];
  routePatternStops: RoutePatternStop[];
}): TransportNetwork {
  const stops = new Map(input.stops.map(s => [s.stopCode, s] as const));
  const routes = new Map(input.routes.map(r => [r.routeCode, r] as const));
  const patterns = new Map(input.patterns.map(p => [p.patternCode, p] as const));

  // Group route-pattern rows by their effective pattern code:
  // prefer the explicit pathPattern column; fall back to "<route>-<DIRECTION>".
  const patternStops = new Map<string, RoutePatternStop[]>();
  for (const rp of input.routePatternStops) {
    const direction = rp.direction === 'Down' ? 'DOWN' : 'UP';
    const key = rp.pathPattern && patterns.has(rp.pathPattern)
      ? rp.pathPattern
      : `${rp.route}-${direction}`;
    const arr = patternStops.get(key) ?? [];
    arr.push(rp);
    patternStops.set(key, arr);
  }

  // Sort each pattern by sequence and synthesize geometry from stop coords.
  const patternGeometry = new Map<string, [number, number][]>();
  for (const [code, rows] of patternStops) {
    rows.sort((a, b) => a.sequence - b.sequence);
    const coords: [number, number][] = [];
    for (const row of rows) {
      const stop = stops.get(row.stopCode);
      if (stop && Number.isFinite(stop.longitude) && Number.isFinite(stop.latitude)) {
        coords.push([stop.longitude, stop.latitude]);
      }
    }
    patternGeometry.set(code, coords);
  }

  return {
    stops,
    routes,
    patterns,
    routePatternStops: input.routePatternStops,
    patternStops,
    patternGeometry,
  };
}

/**
 * Build the default network from baked-in seed data. Used on first boot
 * and as a fallback if a parsed workbook is incomplete.
 */
export function buildSeedNetwork(): TransportNetwork {
  return buildNetwork({
    stops: SEED_STOPS,
    routes: SEED_ROUTES,
    patterns: SEED_PATTERNS,
    routePatternStops: SEED_ROUTE_PATTERN_STOPS,
  });
}

/**
 * Centroid of every stop (lng,lat) — useful for camera framing.
 */
export function networkCentroid(net: TransportNetwork): [number, number] {
  const stops = [...net.stops.values()].filter(
    s => Number.isFinite(s.latitude) && Number.isFinite(s.longitude),
  );
  if (stops.length === 0) return [55.95, 25.78];
  const lng = stops.reduce((a, s) => a + s.longitude, 0) / stops.length;
  const lat = stops.reduce((a, s) => a + s.latitude, 0) / stops.length;
  return [lng, lat];
}
