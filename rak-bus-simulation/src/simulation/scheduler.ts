/**
 * Trip scheduler.
 *
 * Given a network and scenario parameters, produces a flat list of Trips
 * (one per scheduled bus dispatch) for the simulated service day. Each
 * Trip carries the scheduled arrival/departure timing for every stop on
 * its pattern — this is the ground truth that the actual simulation is
 * compared against by the KPI engine.
 */

import type {
  ScheduledStopEvent,
  TransportNetwork,
  Trip,
} from '../types/transport';
import type { ScenarioParams } from '../scenarios/scenarios';

let TRIP_SEQ = 0;
const nextTripId = (route: string, pattern: string, dispatch: number) =>
  `${pattern}-${dispatch}-${++TRIP_SEQ}`;

export function generateTrips(
  network: TransportNetwork,
  scenario: ScenarioParams,
): Trip[] {
  const trips: Trip[] = [];
  TRIP_SEQ = 0;

  // Service window expressed in sim seconds (0 = start of service day).
  const serviceStart = 0;
  const serviceEnd = (scenario.endHour - scenario.startHour) * 3600;
  const headwaySec = scenario.headwayMinutes * 60;
  const dwell = scenario.dwellTimeSec;

  for (const patternCode of scenario.activePatterns) {
    const stops = network.patternStops.get(patternCode);
    const pattern = network.patterns.get(patternCode);
    if (!stops || stops.length < 2 || !pattern) continue;

    for (let t = serviceStart; t < serviceEnd; t += headwaySec) {
      const scheduledStops: ScheduledStopEvent[] = [];
      let cursor = t;

      for (let i = 0; i < stops.length; i++) {
        const rp = stops[i];
        const travel = i === 0 ? 0 : (rp.travelTime ?? 300) / scenario.speedMultiplier;
        const arrival = cursor + travel;
        const departure = i === stops.length - 1 ? arrival : arrival + dwell;
        scheduledStops.push({
          stopCode: rp.stopCode,
          scheduledArrival: arrival,
          scheduledDeparture: departure,
        });
        cursor = departure;
      }

      trips.push({
        id: nextTripId(pattern.route, patternCode, t),
        routeCode: pattern.route,
        patternCode,
        scheduledStart: t,
        stops: scheduledStops,
      });
    }
  }

  trips.sort((a, b) => a.scheduledStart - b.scheduledStart);
  return trips;
}

export function formatSimClock(sec: number, startHour = 6): string {
  const total = Math.max(0, Math.floor(sec));
  const totalMins = total / 60;
  const h = Math.floor(startHour + totalMins / 60) % 24;
  const m = Math.floor(totalMins) % 60;
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
