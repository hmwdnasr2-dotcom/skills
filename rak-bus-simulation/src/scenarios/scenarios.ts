/**
 * Scenario manager.
 *
 * A "scenario" is the bundle of tunable parameters that re-shape the
 * simulation: service hours, frequency, dwell times, speed assumptions
 * and traffic variability. Presets compare "planned" vs "what-if"
 * conditions — additional ones can be added without touching the engine.
 */

export interface ScenarioParams {
  id: string;
  label: string;
  description: string;
  /** Hour-of-day at sim t=0 (e.g. 6 for 06:00). */
  startHour: number;
  /** Hour-of-day service ends. */
  endHour: number;
  /** Frequency between dispatches per pattern, in minutes. */
  headwayMinutes: number;
  /** Dwell time at each stop, in seconds. */
  dwellTimeSec: number;
  /** Multiplier applied to travel times (>1 = faster). */
  speedMultiplier: number;
  /** Stochastic travel-time variance per segment (0..1). */
  trafficDelayFactor: number;
  /** Patterns that participate in this scenario. */
  activePatterns: Set<string>;
  /** Deterministic PRNG seed. */
  seed: number;
}

const ALL_PATTERNS = new Set<string>([
  'R1-UP', 'R1-DOWN',
  'B1-UP', 'B1-DOWN',
  'G1-UP', 'G1-DOWN',
  'Y1-UP', 'Y1-DOWN',
]);

export const SCENARIO_PRESETS: Record<string, ScenarioParams> = {
  baseline: {
    id: 'baseline',
    label: 'Baseline Plan',
    description: 'Current operational plan: 20-min headway, 30s dwell, free-flow traffic.',
    startHour: 6,
    endHour: 22,
    headwayMinutes: 20,
    dwellTimeSec: 30,
    speedMultiplier: 1.0,
    trafficDelayFactor: 0.05,
    activePatterns: new Set(ALL_PATTERNS),
    seed: 1,
  },
  peakTraffic: {
    id: 'peakTraffic',
    label: 'Peak Traffic',
    description: 'Heavy congestion: 0.75× speed, ±25% segment variability.',
    startHour: 6,
    endHour: 22,
    headwayMinutes: 20,
    dwellTimeSec: 45,
    speedMultiplier: 0.75,
    trafficDelayFactor: 0.25,
    activePatterns: new Set(ALL_PATTERNS),
    seed: 7,
  },
  highFrequency: {
    id: 'highFrequency',
    label: 'High Frequency Proposal',
    description: '10-min headway across the network — doubles peak capacity.',
    startHour: 6,
    endHour: 22,
    headwayMinutes: 10,
    dwellTimeSec: 30,
    speedMultiplier: 1.0,
    trafficDelayFactor: 0.05,
    activePatterns: new Set(ALL_PATTERNS),
    seed: 11,
  },
  fastDwell: {
    id: 'fastDwell',
    label: 'Faster Boarding',
    description: 'Investment in level boarding cuts dwell from 30s to 15s.',
    startHour: 6,
    endHour: 22,
    headwayMinutes: 20,
    dwellTimeSec: 15,
    speedMultiplier: 1.0,
    trafficDelayFactor: 0.05,
    activePatterns: new Set(ALL_PATTERNS),
    seed: 17,
  },
};

export function cloneScenario(s: ScenarioParams): ScenarioParams {
  return { ...s, activePatterns: new Set(s.activePatterns) };
}
