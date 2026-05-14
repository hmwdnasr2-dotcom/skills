/**
 * KPI engine.
 *
 * Consumes the rolling list of ActualStopEvent objects emitted by the
 * simulation engine and returns aggregate operational metrics. Pure
 * function so the UI can call it on every render without side effects.
 *
 * Metrics:
 *   - On-time performance: % of arrivals within ±120s of schedule.
 *   - Average delay (sec).
 *   - Bunching incidents: pairs of buses on the same pattern arriving
 *     within 25% of the headway at the same stop.
 *   - Headway adherence: stdev of actual headways at terminals.
 *   - Per-route breakdown.
 */

import type { ActualStopEvent, Bus } from '../types/transport';
import type { ScenarioParams } from '../scenarios/scenarios';

export const ON_TIME_WINDOW_SEC = 120;

export interface KPIBreakdown {
  routeCode: string;
  events: number;
  onTimePct: number;
  avgDelaySec: number;
  bunchingIncidents: number;
}

export interface KPIs {
  totalEvents: number;
  activeBuses: number;
  totalBusesDispatched: number;
  onTimePct: number;
  earlyPct: number;
  latePct: number;
  avgDelaySec: number;
  p90DelaySec: number;
  routeBreakdown: KPIBreakdown[];
  headwayAdherenceSec: number;
  bunchingIncidents: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

function stdev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(v);
}

export function computeKPIs(
  events: ActualStopEvent[],
  buses: Bus[],
  scenario: ScenarioParams,
  totalDispatched: number,
): KPIs {
  if (events.length === 0) {
    return {
      totalEvents: 0,
      activeBuses: buses.filter(b => b.status !== 'completed').length,
      totalBusesDispatched: totalDispatched,
      onTimePct: 100,
      earlyPct: 0,
      latePct: 0,
      avgDelaySec: 0,
      p90DelaySec: 0,
      routeBreakdown: [],
      headwayAdherenceSec: 0,
      bunchingIncidents: 0,
    };
  }

  const onTime = events.filter(e => Math.abs(e.delaySec) <= ON_TIME_WINDOW_SEC).length;
  const early = events.filter(e => e.delaySec < -ON_TIME_WINDOW_SEC).length;
  const late = events.filter(e => e.delaySec > ON_TIME_WINDOW_SEC).length;
  const delays = events.map(e => e.delaySec).sort((a, b) => a - b);
  const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;

  // Per-route breakdown.
  const byRoute = new Map<string, ActualStopEvent[]>();
  for (const e of events) {
    const arr = byRoute.get(e.routeCode) ?? [];
    arr.push(e);
    byRoute.set(e.routeCode, arr);
  }
  const routeBreakdown: KPIBreakdown[] = [...byRoute.entries()].map(([routeCode, evs]) => {
    const on = evs.filter(e => Math.abs(e.delaySec) <= ON_TIME_WINDOW_SEC).length;
    const avg = evs.reduce((a, e) => a + e.delaySec, 0) / evs.length;
    return {
      routeCode,
      events: evs.length,
      onTimePct: (on / evs.length) * 100,
      avgDelaySec: avg,
      bunchingIncidents: detectBunching(evs, scenario.headwayMinutes * 60),
    };
  });
  routeBreakdown.sort((a, b) => a.routeCode.localeCompare(b.routeCode));

  // Headway adherence at terminal arrivals (last stop per pattern).
  const headways: number[] = [];
  const byPatternStop = new Map<string, ActualStopEvent[]>();
  for (const e of events) {
    const key = `${e.patternCode}@${e.stopCode}`;
    const arr = byPatternStop.get(key) ?? [];
    arr.push(e);
    byPatternStop.set(key, arr);
  }
  for (const arr of byPatternStop.values()) {
    arr.sort((a, b) => a.actualArrival - b.actualArrival);
    for (let i = 1; i < arr.length; i++) {
      headways.push(arr[i].actualArrival - arr[i - 1].actualArrival);
    }
  }

  const totalBunching = routeBreakdown.reduce((a, r) => a + r.bunchingIncidents, 0);

  return {
    totalEvents: events.length,
    activeBuses: buses.filter(b => b.status !== 'completed').length,
    totalBusesDispatched: totalDispatched,
    onTimePct: (onTime / events.length) * 100,
    earlyPct: (early / events.length) * 100,
    latePct: (late / events.length) * 100,
    avgDelaySec: avgDelay,
    p90DelaySec: percentile(delays, 0.9),
    routeBreakdown,
    headwayAdherenceSec: stdev(headways),
    bunchingIncidents: totalBunching,
  };
}

function detectBunching(events: ActualStopEvent[], headwaySec: number): number {
  // Group by patternCode + stopCode then count pairs arriving within 25%
  // of the scheduled headway.
  const groups = new Map<string, number[]>();
  for (const e of events) {
    const key = `${e.patternCode}@${e.stopCode}`;
    const arr = groups.get(key) ?? [];
    arr.push(e.actualArrival);
    groups.set(key, arr);
  }
  let count = 0;
  for (const arr of groups.values()) {
    arr.sort((a, b) => a - b);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] - arr[i - 1] < headwaySec * 0.25) count++;
    }
  }
  return count;
}
