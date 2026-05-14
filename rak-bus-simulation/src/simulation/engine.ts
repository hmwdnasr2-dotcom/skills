/**
 * Tick-based simulation engine.
 *
 * The engine is a pure(-ish) state transformer: `step(state, dt)` returns
 * the next state and accumulated stop events. The UI drives ticks via
 * requestAnimationFrame with `dt = elapsedRealMs * scenario.speed`.
 *
 * Bus movement model:
 *   - A bus is "on" segment i (= traveling stops[i] → stops[i+1]).
 *   - segmentDuration is computed once per segment from the scheduled
 *     travel time, the scenario speedMultiplier and a seeded stochastic
 *     traffic factor (so the same scenario reproduces deterministically).
 *   - When segmentProgress >= 1: snap to next stop, emit ActualStopEvent,
 *     start dwell. After dwell, advance segmentIndex.
 *
 * KPIs are NOT calculated here — the engine emits raw ActualStopEvent
 * objects; kpi/kpiEngine.ts turns them into headline metrics.
 */

import type {
  ActualStopEvent,
  Bus,
  Trip,
  TransportNetwork,
} from '../types/transport';
import type { ScenarioParams } from '../scenarios/scenarios';

export interface SimulationState {
  clock: number;
  buses: Bus[];
  trips: Trip[];
  pendingTripIndex: number; // next trip waiting to dispatch
  actualEvents: ActualStopEvent[];
}

interface StepContext {
  network: TransportNetwork;
  scenario: ScenarioParams;
}

// Mulberry32 — small deterministic PRNG so scenarios are reproducible.
function makePrng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const prngBySeed = new Map<number, () => number>();
function rngFor(seed: number) {
  let r = prngBySeed.get(seed);
  if (!r) {
    r = makePrng(seed);
    prngBySeed.set(seed, r);
  }
  return r;
}

export function resetEngineRng(seed: number) {
  prngBySeed.set(seed, makePrng(seed));
}

function interp(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function bearing(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const f1 = toRad(a[1]);
  const f2 = toRad(b[1]);
  const dl = toRad(b[0] - a[0]);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function initialState(
  trips: Trip[],
): SimulationState {
  return {
    clock: 0,
    buses: [],
    trips,
    pendingTripIndex: 0,
    actualEvents: [],
  };
}

function segmentDurationFor(
  baseTravelSec: number,
  scenario: ScenarioParams,
  rng: () => number,
): number {
  const base = Math.max(15, baseTravelSec) / Math.max(0.1, scenario.speedMultiplier);
  // ±trafficDelayFactor variance (Gaussian-ish via avg of two uniforms).
  const variance = scenario.trafficDelayFactor;
  const r = (rng() + rng()) / 2 - 0.5; // -0.5..+0.5
  return Math.max(10, base * (1 + r * 2 * variance));
}

function spawnBus(
  trip: Trip,
  network: TransportNetwork,
  scenario: ScenarioParams,
  clock: number,
): Bus | null {
  const stops = network.patternStops.get(trip.patternCode);
  if (!stops || stops.length < 2) return null;
  const route = network.routes.get(trip.routeCode);
  const first = network.stops.get(stops[0].stopCode);
  const second = network.stops.get(stops[1].stopCode);
  if (!first || !second) return null;

  const rng = rngFor(scenario.seed);
  const dur = segmentDurationFor(stops[1].travelTime ?? 300, scenario, rng);

  return {
    id: `bus-${trip.id}`,
    routeCode: trip.routeCode,
    patternCode: trip.patternCode,
    tripId: trip.id,
    position: [first.longitude, first.latitude],
    bearing: bearing([first.longitude, first.latitude], [second.longitude, second.latitude]),
    segmentIndex: 0,
    segmentProgress: 0,
    status: 'in-transit',
    currentStopCode: stops[0].stopCode,
    scheduledStart: trip.scheduledStart,
    actualStart: clock,
    delaySec: clock - trip.scheduledStart,
    color: route?.color ?? '#22d3ee',
    // Augmented runtime fields below (kept off the type surface to keep
    // the interface tidy; cast on access).
    ...({
      __segmentDuration: dur,
      __segmentElapsed: 0,
      __dwellRemaining: 0,
    } as object),
  };
}

interface RuntimeBus extends Bus {
  __segmentDuration: number;
  __segmentElapsed: number;
  __dwellRemaining: number;
}

export function step(
  state: SimulationState,
  dt: number,
  ctx: StepContext,
): SimulationState {
  const nextClock = state.clock + dt;
  const buses = state.buses.slice() as RuntimeBus[];
  const events: ActualStopEvent[] = [];
  const rng = rngFor(ctx.scenario.seed);

  // 1. Dispatch any trips whose scheduled start has passed.
  let pendingIdx = state.pendingTripIndex;
  while (pendingIdx < state.trips.length) {
    const trip = state.trips[pendingIdx];
    if (trip.scheduledStart > nextClock) break;
    const bus = spawnBus(trip, ctx.network, ctx.scenario, nextClock) as RuntimeBus | null;
    if (bus) buses.push(bus);
    pendingIdx++;
  }

  // 2. Advance every active bus.
  const surviving: RuntimeBus[] = [];
  for (const bus of buses) {
    if (bus.status === 'completed') continue;
    const stops = ctx.network.patternStops.get(bus.patternCode);
    if (!stops || stops.length < 2) {
      bus.status = 'completed';
      continue;
    }

    let remaining = dt;
    let safety = 0; // guard against pathological dt
    while (remaining > 0 && (bus as Bus).status !== 'completed' && safety++ < 50) {
      if (bus.status === 'at-stop') {
        const consumed = Math.min(remaining, bus.__dwellRemaining);
        bus.__dwellRemaining -= consumed;
        remaining -= consumed;
        if (bus.__dwellRemaining > 0) break;
        // Dwell complete — advance to next segment.
        bus.segmentIndex += 1;
        if (bus.segmentIndex >= stops.length - 1) {
          bus.status = 'completed';
          break;
        }
        const fromStop = ctx.network.stops.get(stops[bus.segmentIndex].stopCode);
        const toStop = ctx.network.stops.get(stops[bus.segmentIndex + 1].stopCode);
        if (!fromStop || !toStop) {
          bus.status = 'completed';
          break;
        }
        bus.segmentProgress = 0;
        bus.__segmentElapsed = 0;
        bus.__segmentDuration = segmentDurationFor(
          stops[bus.segmentIndex + 1].travelTime ?? 300,
          ctx.scenario,
          rng,
        );
        bus.position = [fromStop.longitude, fromStop.latitude];
        bus.bearing = bearing(
          [fromStop.longitude, fromStop.latitude],
          [toStop.longitude, toStop.latitude],
        );
        bus.status = 'in-transit';
        bus.currentStopCode = undefined;
        continue;
      }

      // in-transit
      const segNeeded = bus.__segmentDuration - bus.__segmentElapsed;
      const consumed = Math.min(remaining, segNeeded);
      bus.__segmentElapsed += consumed;
      remaining -= consumed;
      bus.segmentProgress = bus.__segmentElapsed / bus.__segmentDuration;

      const fromStop = ctx.network.stops.get(stops[bus.segmentIndex].stopCode);
      const toStop = ctx.network.stops.get(stops[bus.segmentIndex + 1].stopCode);
      if (!fromStop || !toStop) {
        bus.status = 'completed';
        break;
      }
      bus.position = interp(
        [fromStop.longitude, fromStop.latitude],
        [toStop.longitude, toStop.latitude],
        Math.min(1, bus.segmentProgress),
      );

      if (bus.segmentProgress >= 1) {
        // Arrived at next stop.
        bus.status = 'at-stop';
        bus.currentStopCode = stops[bus.segmentIndex + 1].stopCode;
        bus.__dwellRemaining = ctx.scenario.dwellTimeSec;
        bus.position = [toStop.longitude, toStop.latitude];

        const trip = ctx.network.patterns.get(bus.patternCode)
          ? state.trips.find(t => t.id === bus.tripId)
          : undefined;
        if (trip) {
          const sched = trip.stops[bus.segmentIndex + 1];
          const actual = state.clock + (dt - remaining);
          const delay = actual - sched.scheduledArrival;
          bus.delaySec = delay;
          events.push({
            tripId: trip.id,
            routeCode: trip.routeCode,
            patternCode: trip.patternCode,
            stopCode: sched.stopCode,
            scheduledArrival: sched.scheduledArrival,
            actualArrival: actual,
            delaySec: delay,
            simTime: actual,
          });
        }
      }
    }
    surviving.push(bus);
  }

  return {
    clock: nextClock,
    buses: surviving,
    trips: state.trips,
    pendingTripIndex: pendingIdx,
    actualEvents: state.actualEvents.concat(events).slice(-5000),
  };
}
