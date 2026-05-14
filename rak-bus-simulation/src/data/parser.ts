/**
 * Master_Data_Template.xlsx parser.
 *
 * The parser is intentionally schema-tolerant: header names are normalized
 * (case + whitespace + punctuation insensitive) so small spreadsheet edits
 * don't break ingestion. Future formats (CSV, JSON, GTFS, REST API) can plug
 * in by emitting the same intermediate structure.
 */

import * as XLSX from 'xlsx';
import type {
  Direction,
  Pattern,
  Route,
  RoutePatternStop,
  Stop,
} from '../types/transport';
import { ROUTE_COLORS } from './seedData';

export interface ParsedDataset {
  stops: Stop[];
  routes: Route[];
  patterns: Pattern[];
  routePatternStops: RoutePatternStop[];
  warnings: string[];
}

const normalize = (s: string) =>
  s.toLowerCase().replace(/[\s_\-()]+/g, '').replace(/[^\w]/g, '');

const pickColumn = (
  row: Record<string, unknown>,
  candidates: string[],
): unknown => {
  const keys = Object.keys(row);
  const norm = keys.map(k => [normalize(k), k] as const);
  for (const candidate of candidates) {
    const c = normalize(candidate);
    const hit = norm.find(([n]) => n === c);
    if (hit) return row[hit[1]];
  }
  return undefined;
};

const toStr = (v: unknown): string =>
  v === undefined || v === null ? '' : String(v).trim();

const toNum = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
};

const toBool = (v: unknown): boolean => {
  const s = toStr(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
};

const toDirection = (v: unknown): Direction => {
  const s = toStr(v).toLowerCase();
  return s.startsWith('d') ? 'Down' : 'Up';
};

function pickSheet(wb: XLSX.WorkBook, names: string[]): XLSX.WorkSheet | undefined {
  const wanted = names.map(normalize);
  for (const name of wb.SheetNames) {
    if (wanted.includes(normalize(name))) return wb.Sheets[name];
  }
  return undefined;
}

function colorForRoute(code: string): string {
  if (ROUTE_COLORS[code]) return ROUTE_COLORS[code];
  // Deterministic fallback hue from code hash.
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) % 360;
  return `hsl(${h}, 70%, 55%)`;
}

export function parseWorkbook(wb: XLSX.WorkBook): ParsedDataset {
  const warnings: string[] = [];

  const stopSheet = pickSheet(wb, ['Stop', 'Stops']);
  const patternSheet = pickSheet(wb, ['Pattern', 'Patterns']);
  const routeSheet = pickSheet(wb, ['Route', 'Routes']);
  const rpSheet = pickSheet(wb, ['Route-Pattern', 'RoutePattern', 'Route_Pattern']);

  if (!stopSheet) warnings.push('Missing "Stop" sheet');
  if (!patternSheet) warnings.push('Missing "Pattern" sheet');
  if (!routeSheet) warnings.push('Missing "Route" sheet');
  if (!rpSheet) warnings.push('Missing "Route-Pattern" sheet');

  const stops: Stop[] = stopSheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(stopSheet).map(r => {
        const lat = toNum(pickColumn(r, ['latitude', 'lat']));
        const lng = toNum(pickColumn(r, ['longitude', 'lng', 'lon']));
        return {
          stopCode: toStr(pickColumn(r, ['Stop Code', 'stop_code', 'code'])),
          stopName: toStr(pickColumn(r, ['Stop Name', 'stop_name', 'name'])),
          latitude: lat,
          longitude: lng,
          chargingPointFlag: toBool(pickColumn(r, ['charging_point_flag', 'charging', 'charge'])),
          publicHeading: toStr(pickColumn(r, ['public_heading', 'heading'])) || undefined,
          terminusCode: toStr(pickColumn(r, ['terminus_code'])) || undefined,
          terminusName: toStr(pickColumn(r, ['Terminus Name', 'terminus_name'])) || undefined,
        };
      })
    : [];

  const routes: Route[] = routeSheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(routeSheet).map(r => {
        const code = toStr(pickColumn(r, ['route_code', 'code']));
        return {
          routeCode: code,
          routeName: toStr(pickColumn(r, ['route_name', 'name'])),
          depot: toStr(pickColumn(r, ['Depot', 'depot'])),
          color: colorForRoute(code),
        };
      })
    : [];

  const patterns: Pattern[] = patternSheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(patternSheet).map(r => ({
        depot: toStr(pickColumn(r, ['Depot', 'depot'])),
        patternCode: toStr(pickColumn(r, ['Pattern_code', 'pattern_code', 'code'])),
        patternName: toStr(pickColumn(r, ['Pattern_name', 'pattern_name', 'name'])),
        route: toStr(pickColumn(r, ['route', 'route_code'])),
        direction: toDirection(pickColumn(r, ['Direction', 'direction'])),
      }))
    : [];

  const routePatternStops: RoutePatternStop[] = rpSheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(rpSheet).map(r => ({
        route: toStr(pickColumn(r, ['Route', 'route', 'route_code'])),
        direction: toDirection(pickColumn(r, ['direction', 'Direction'])),
        stopName: toStr(pickColumn(r, ['stop_name', 'Stop Name'])),
        stopCode: toStr(pickColumn(r, ['stop_code', 'Stop Code'])),
        sequence: toNum(pickColumn(r, ['sequence', 'seq'])) || 0,
        distance: (() => {
          const v = toNum(pickColumn(r, ['Distance', 'distance']));
          return Number.isFinite(v) ? v : undefined;
        })(),
        pathPattern: toStr(pickColumn(r, ['path(Pattern)', 'path_pattern', 'pattern_code'])) || undefined,
        depot: toStr(pickColumn(r, ['depot', 'Depot'])) || undefined,
        travelTime: (() => {
          const v = toNum(pickColumn(r, ['travel_time', 'travelTime']));
          return Number.isFinite(v) ? v : undefined;
        })(),
      }))
    : [];

  validateRelations({ stops, routes, patterns, routePatternStops }, warnings);

  return { stops, routes, patterns, routePatternStops, warnings };
}

function validateRelations(
  data: {
    stops: Stop[];
    routes: Route[];
    patterns: Pattern[];
    routePatternStops: RoutePatternStop[];
  },
  warnings: string[],
): void {
  const stopCodes = new Set(data.stops.map(s => s.stopCode));
  const routeCodes = new Set(data.routes.map(r => r.routeCode));
  const patternCodes = new Set(data.patterns.map(p => p.patternCode));

  for (const rp of data.routePatternStops) {
    if (!stopCodes.has(rp.stopCode)) {
      warnings.push(`Route-Pattern references missing stop ${rp.stopCode}`);
    }
    if (!routeCodes.has(rp.route)) {
      warnings.push(`Route-Pattern references missing route ${rp.route}`);
    }
    if (rp.pathPattern && !patternCodes.has(rp.pathPattern)) {
      warnings.push(`Route-Pattern references missing pattern ${rp.pathPattern}`);
    }
  }
}

export async function parseFile(file: File): Promise<ParsedDataset> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  return parseWorkbook(wb);
}
