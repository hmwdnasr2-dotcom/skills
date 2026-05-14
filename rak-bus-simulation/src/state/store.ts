/**
 * Central application store.
 *
 * Holds the parsed network, current scenario, simulation state, and UI
 * selections. The ticker (see App.tsx) drives `tick(dt)` on every frame.
 */

import { create } from 'zustand';
import type { ParsedDataset } from '../data/parser';
import { buildNetwork, buildSeedNetwork } from '../data/networkBuilder';
import { generateTrips } from '../simulation/scheduler';
import {
  initialState,
  resetEngineRng,
  step,
  type SimulationState,
} from '../simulation/engine';
import {
  SCENARIO_PRESETS,
  cloneScenario,
  type ScenarioParams,
} from '../scenarios/scenarios';
import type { TransportNetwork } from '../types/transport';

interface StoreState {
  network: TransportNetwork;
  scenario: ScenarioParams;
  sim: SimulationState;
  running: boolean;
  speed: number;
  selectedRoute: string | null;
  selectedPattern: string | null;
  parseWarnings: string[];

  // actions
  loadDataset: (data: ParsedDataset) => void;
  setScenario: (id: string) => void;
  updateScenario: (patch: Partial<ScenarioParams>) => void;
  togglePattern: (code: string) => void;
  setSelectedRoute: (code: string | null) => void;
  setSelectedPattern: (code: string | null) => void;
  setRunning: (running: boolean) => void;
  toggleRunning: () => void;
  setSpeed: (s: number) => void;
  reset: () => void;
  tick: (dt: number) => void;
}

function freshSim(network: TransportNetwork, scenario: ScenarioParams): SimulationState {
  resetEngineRng(scenario.seed);
  const trips = generateTrips(network, scenario);
  return initialState(trips);
}

const initialNetwork = buildSeedNetwork();
const initialScenario = cloneScenario(SCENARIO_PRESETS.baseline);

export const useStore = create<StoreState>((set, get) => ({
  network: initialNetwork,
  scenario: initialScenario,
  sim: freshSim(initialNetwork, initialScenario),
  running: false,
  speed: 60, // sim seconds per real second
  selectedRoute: null,
  selectedPattern: null,
  parseWarnings: [],

  loadDataset: (data) => {
    const network = buildNetwork(data);
    const scenario = get().scenario;
    // Filter active patterns to those that actually exist.
    const valid = new Set<string>();
    for (const code of scenario.activePatterns) {
      if (network.patterns.has(code) && network.patternStops.has(code)) valid.add(code);
    }
    const adjusted = { ...scenario, activePatterns: valid };
    set({
      network,
      scenario: adjusted,
      sim: freshSim(network, adjusted),
      running: false,
      parseWarnings: data.warnings,
      selectedRoute: null,
      selectedPattern: null,
    });
  },

  setScenario: (id) => {
    const preset = SCENARIO_PRESETS[id];
    if (!preset) return;
    const scenario = cloneScenario(preset);
    set({
      scenario,
      sim: freshSim(get().network, scenario),
      running: false,
    });
  },

  updateScenario: (patch) => {
    const scenario = { ...get().scenario, ...patch };
    set({
      scenario,
      sim: freshSim(get().network, scenario),
      running: false,
    });
  },

  togglePattern: (code) => {
    const scenario = get().scenario;
    const next = new Set(scenario.activePatterns);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    const updated = { ...scenario, activePatterns: next };
    set({
      scenario: updated,
      sim: freshSim(get().network, updated),
      running: false,
    });
  },

  setSelectedRoute: (code) => set({ selectedRoute: code }),
  setSelectedPattern: (code) => set({ selectedPattern: code }),
  setRunning: (running) => set({ running }),
  toggleRunning: () => set({ running: !get().running }),
  setSpeed: (speed) => set({ speed }),

  reset: () => {
    const { network, scenario } = get();
    set({ sim: freshSim(network, scenario), running: false });
  },

  tick: (dt) => {
    const { sim, network, scenario, running } = get();
    if (!running || dt <= 0) return;
    const next = step(sim, dt, { network, scenario });
    set({ sim: next });
  },
}));
