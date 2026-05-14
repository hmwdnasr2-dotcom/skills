/**
 * Synthesized Ras Al Khaimah master dataset.
 *
 * Schema mirrors Master_Data_Template.xlsx (Stop / Route / Pattern /
 * Route-Pattern). Coordinates are approximate but geographically plausible
 * for RAK so the simulation visualizes against the real road network.
 *
 * When the live spreadsheet is dropped into the app, the parser replaces
 * this seed at runtime — this file is the fallback the MVP boots with.
 */

import type {
  Pattern,
  Route,
  RoutePatternStop,
  Stop,
} from '../types/transport';

export const ROUTE_COLORS: Record<string, string> = {
  R1: '#ef4444',
  B1: '#3b82f6',
  G1: '#22c55e',
  Y1: '#eab308',
};

export const SEED_STOPS: Stop[] = [
  // Central terminus (shared)
  { stopCode: 'NK01', stopName: 'Nakheel Bus Terminal', latitude: 25.7965, longitude: 55.9705, chargingPointFlag: true, publicHeading: 'Central', terminusCode: 'NK01', terminusName: 'Nakheel' },

  // R1 corridor (south-west, to Al Hamra)
  { stopCode: 'MN01', stopName: 'Manar Mall', latitude: 25.7820, longitude: 55.9540, chargingPointFlag: false, publicHeading: 'SW' },
  { stopCode: 'RM01', stopName: 'RAK Mall', latitude: 25.7530, longitude: 55.9290, chargingPointFlag: false, publicHeading: 'SW' },
  { stopCode: 'CQ01', stopName: 'Corniche Al-Qawasim', latitude: 25.7350, longitude: 55.9050, chargingPointFlag: false, publicHeading: 'SW' },
  { stopCode: 'KZ01', stopName: 'Khuzam', latitude: 25.7050, longitude: 55.8650, chargingPointFlag: false, publicHeading: 'SW' },
  { stopCode: 'HM01', stopName: 'Al Hamra Mall', latitude: 25.6920, longitude: 55.7980, chargingPointFlag: true, publicHeading: 'SW', terminusCode: 'HM01', terminusName: 'Al Hamra' },

  // B1 corridor (north along E11, to Sha'am)
  { stopCode: 'AG01', stopName: 'Al Ghob', latitude: 25.8075, longitude: 55.9820, chargingPointFlag: false, publicHeading: 'N' },
  { stopCode: 'JU01', stopName: 'Julphar', latitude: 25.8217, longitude: 55.9956, chargingPointFlag: false, publicHeading: 'N' },
  { stopCode: 'SE01', stopName: 'Shemal', latitude: 25.8460, longitude: 56.0030, chargingPointFlag: false, publicHeading: 'N' },
  { stopCode: 'RA01', stopName: 'Rams', latitude: 25.8720, longitude: 56.0400, chargingPointFlag: false, publicHeading: 'N' },
  { stopCode: 'SH01', stopName: "Sha'am Terminal", latitude: 25.9450, longitude: 56.0680, chargingPointFlag: true, publicHeading: 'N', terminusCode: 'SH01', terminusName: "Sha'am" },

  // G1 corridor (south, to RAK Airport)
  { stopCode: 'ID01', stopName: 'Industrial Area', latitude: 25.7480, longitude: 55.9430, chargingPointFlag: false, publicHeading: 'S' },
  { stopCode: 'BU01', stopName: 'Al Burairat', latitude: 25.7050, longitude: 55.9400, chargingPointFlag: false, publicHeading: 'S' },
  { stopCode: 'KT01', stopName: 'Khatt', latitude: 25.6580, longitude: 55.9520, chargingPointFlag: false, publicHeading: 'SE' },
  { stopCode: 'AP01', stopName: 'RAK International Airport', latitude: 25.6130, longitude: 55.9370, chargingPointFlag: true, publicHeading: 'S', terminusCode: 'AP01', terminusName: 'RAK Airport' },

  // Y1 corridor (Al Marjan ↔ Jabal Jais)
  { stopCode: 'MJ01', stopName: 'Al Marjan Island', latitude: 25.6830, longitude: 55.7900, chargingPointFlag: true, publicHeading: 'W', terminusCode: 'MJ01', terminusName: 'Al Marjan' },
  { stopCode: 'WB01', stopName: 'Wadi Bih Gate', latitude: 25.8350, longitude: 56.0220, chargingPointFlag: false, publicHeading: 'E' },
  { stopCode: 'JJ01', stopName: 'Jabal Jais Visitor', latitude: 25.9280, longitude: 56.1300, chargingPointFlag: true, publicHeading: 'E', terminusCode: 'JJ01', terminusName: 'Jabal Jais' },
];

export const SEED_ROUTES: Route[] = [
  { routeCode: 'R1', routeName: 'Red Line - Nakheel - Al Hamra', depot: 'RAKTA', color: ROUTE_COLORS.R1 },
  { routeCode: 'B1', routeName: "Blue Line - Nakheel - Sha'am", depot: 'RAKTA', color: ROUTE_COLORS.B1 },
  { routeCode: 'G1', routeName: 'Green Line - Nakheel - RAK Airport', depot: 'RAKTA', color: ROUTE_COLORS.G1 },
  { routeCode: 'Y1', routeName: 'Yellow Line - Al Marjan - Jabal Jais', depot: 'RAKTA', color: ROUTE_COLORS.Y1 },
];

export const SEED_PATTERNS: Pattern[] = [
  { depot: 'RAKTA', patternCode: 'R1-UP', patternName: 'Nakheel - Al Hamra', route: 'R1', direction: 'Up' },
  { depot: 'RAKTA', patternCode: 'R1-DOWN', patternName: 'Al Hamra - Nakheel', route: 'R1', direction: 'Down' },
  { depot: 'RAKTA', patternCode: 'B1-UP', patternName: "Nakheel - Sha'am", route: 'B1', direction: 'Up' },
  { depot: 'RAKTA', patternCode: 'B1-DOWN', patternName: "Sha'am - Nakheel", route: 'B1', direction: 'Down' },
  { depot: 'RAKTA', patternCode: 'G1-UP', patternName: 'Nakheel - RAK Airport', route: 'G1', direction: 'Up' },
  { depot: 'RAKTA', patternCode: 'G1-DOWN', patternName: 'RAK Airport - Nakheel', route: 'G1', direction: 'Down' },
  { depot: 'RAKTA', patternCode: 'Y1-UP', patternName: 'Al Marjan - Jabal Jais', route: 'Y1', direction: 'Up' },
  { depot: 'RAKTA', patternCode: 'Y1-DOWN', patternName: 'Jabal Jais - Al Marjan', route: 'Y1', direction: 'Down' },
];

/**
 * One-way orderings — DOWN patterns are generated from these by reversing
 * sequence and recomputing travelTime offsets in buildSeedRoutePatterns().
 */
const ONE_WAY_PATTERNS: Record<string, { stopCode: string; travelTime: number; distance: number }[]> = {
  R1: [
    { stopCode: 'NK01', travelTime: 0, distance: 0 },
    { stopCode: 'MN01', travelTime: 240, distance: 2000 },
    { stopCode: 'RM01', travelTime: 360, distance: 4000 },
    { stopCode: 'CQ01', travelTime: 240, distance: 3000 },
    { stopCode: 'KZ01', travelTime: 360, distance: 5000 },
    { stopCode: 'HM01', travelTime: 600, distance: 10000 },
  ],
  B1: [
    { stopCode: 'NK01', travelTime: 0, distance: 0 },
    { stopCode: 'AG01', travelTime: 180, distance: 1500 },
    { stopCode: 'JU01', travelTime: 180, distance: 2000 },
    { stopCode: 'SE01', travelTime: 240, distance: 3000 },
    { stopCode: 'RA01', travelTime: 360, distance: 5000 },
    { stopCode: 'SH01', travelTime: 600, distance: 9000 },
  ],
  G1: [
    { stopCode: 'NK01', travelTime: 0, distance: 0 },
    { stopCode: 'ID01', travelTime: 420, distance: 5000 },
    { stopCode: 'BU01', travelTime: 360, distance: 4500 },
    { stopCode: 'KT01', travelTime: 480, distance: 6000 },
    { stopCode: 'AP01', travelTime: 360, distance: 5000 },
  ],
  Y1: [
    { stopCode: 'MJ01', travelTime: 0, distance: 0 },
    { stopCode: 'HM01', travelTime: 180, distance: 1500 },
    { stopCode: 'KZ01', travelTime: 600, distance: 10000 },
    { stopCode: 'KT01', travelTime: 600, distance: 10000 },
    { stopCode: 'WB01', travelTime: 1500, distance: 25000 },
    { stopCode: 'JJ01', travelTime: 1500, distance: 15000 },
  ],
};

function buildSeedRoutePatterns(): RoutePatternStop[] {
  const stopMap = new Map(SEED_STOPS.map(s => [s.stopCode, s]));
  const result: RoutePatternStop[] = [];

  for (const [route, sequence] of Object.entries(ONE_WAY_PATTERNS)) {
    const upPattern = `${route}-UP`;
    const downPattern = `${route}-DOWN`;

    // Up direction
    sequence.forEach((s, idx) => {
      const stop = stopMap.get(s.stopCode);
      if (!stop) throw new Error(`Seed inconsistency: missing stop ${s.stopCode}`);
      result.push({
        route,
        direction: 'Up',
        stopName: stop.stopName,
        stopCode: s.stopCode,
        sequence: idx + 1,
        distance: s.distance,
        pathPattern: upPattern,
        depot: 'RAKTA',
        travelTime: s.travelTime,
      });
    });

    // Down direction - reverse sequence; travelTime[i] becomes original travelTime[i+1] of reversed
    const reversed = [...sequence].reverse();
    reversed.forEach((s, idx) => {
      const stop = stopMap.get(s.stopCode);
      if (!stop) throw new Error(`Seed inconsistency: missing stop ${s.stopCode}`);
      // travel time to reach this stop in DOWN direction = original travelTime of the
      // stop that came AFTER this one in the UP direction.
      const origIdx = sequence.findIndex(x => x.stopCode === s.stopCode);
      const tt = idx === 0 ? 0 : sequence[origIdx + 1]?.travelTime ?? 300;
      const dd = idx === 0 ? 0 : sequence[origIdx + 1]?.distance ?? 1000;
      result.push({
        route,
        direction: 'Down',
        stopName: stop.stopName,
        stopCode: s.stopCode,
        sequence: idx + 1,
        distance: dd,
        pathPattern: downPattern,
        depot: 'RAKTA',
        travelTime: tt,
      });
    });
  }

  return result;
}

export const SEED_ROUTE_PATTERN_STOPS: RoutePatternStop[] = buildSeedRoutePatterns();
