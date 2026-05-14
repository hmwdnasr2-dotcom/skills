/**
 * Central application store.
 *
 * Holds the parsed network, current scenario, simulation state, UI
 * selections, in-app navigation, and persisted KPI report history.
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
import { computeKPIs, type KPIs } from '../kpi/kpiEngine';
import type { TransportNetwork } from '../types/transport';

export type Page = 'portal' | 'simulation' | 'data' | 'reports';

export interface SavedReport {
  id: string;
  savedAt: number;       // Date.now()
  scenarioId: string;
  scenarioLabel: string;
  simClockSec: number;
  kpis: KPIs;
}

interface StoreState {
  page: Page;
  network: TransportNetwork;
  scenario: ScenarioParams;
  sim: SimulationState;
  running: boolean;
  speed: number;
  selectedRoute: string | null;
  selectedPattern: string | null;
  parseWarnings: string[];
  savedReports: SavedReport[];

  // navigation
  setPage: (p: Page) => void;

  // data / network
  loadDataset: (data: ParsedDataset) => void;

  // scenario
  setScenario: (id: string) => void;
  updateScenario: (patch: Partial<ScenarioParams>) => void;
  togglePattern: (code: string) => void;

  // map selections
  setSelectedRoute: (code: string | null) => void;
  setSelectedPattern: (code: string | null) => void;

  // simulation controls
  setRunning: (running: boolean) => void;
  toggleRunning: () => void;
  setSpeed: (s: number) => void;
  reset: () => void;
  tick: (dt: number) => void;

  // reports
  saveReport: () => void;
  deleteReport: (id: string) => void;
  clearReports: () => void;
}

function freshSim(network: TransportNetwork, scenario: ScenarioParams): SimulationState {
  resetEngineRng(scenario.seed);
  const trips = generateTrips(network, scenario);
  return initialState(trips);
}

const initialNetwork = buildSeedNetwork();
const initialScenario = cloneScenario(SCENARIO_PRESETS.baseline);

function loadPersistedReports(): SavedReport[] {
  try {
    const raw = localStorage.getItem('rak-sim-reports');
    if (!raw) return [];
    return JSON.parse(raw) as SavedReport[];
  } catch {
    return [];
  }
}

function persistReports(reports: SavedReport[]) {
  try {
    localStorage.setItem('rak-sim-reports', JSON.stringify(reports.slice(-50)));
  } catch { /* storage quota */ }
}

export const useStore = create<StoreState>((set, get) => ({
  page: 'portal',
  network: initialNetwork,
  scenario: initialScenario,
  sim: freshSim(initialNetwork, initialScenario),
  running: false,
  speed: 60,
  selectedRoute: null,
  selectedPattern: null,
  parseWarnings: [],
  savedReports: loadPersistedReports(),

  setPage: (page) => set({ page }),

  loadDataset: (data) => {
    const network = buildNetwork(data);
    const scenario = get().scenario;
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
    set({ scenario, sim: freshSim(get().network, scenario), running: false });
  },

  updateScenario: (patch) => {
    const scenario = { ...get().scenario, ...patch };
    set({ scenario, sim: freshSim(get().network, scenario), running: false });
  },

  togglePattern: (code) => {
    const scenario = get().scenario;
    const next = new Set(scenario.activePatterns);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    const updated = { ...scenario, activePatterns: next };
    set({ scenario: updated, sim: freshSim(get().network, updated), running: false });
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

  saveReport: () => {
    const { sim, scenario } = get();
    const kpis = computeKPIs(sim.actualEvents, sim.buses, scenario, sim.pendingTripIndex);
    const report: SavedReport = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      savedAt: Date.now(),
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      simClockSec: sim.clock,
      kpis,
    };
    const updated = [report, ...get().savedReports].slice(0, 50);
    persistReports(updated);
    set({ savedReports: updated });
  },

  deleteReport: (id) => {
    const updated = get().savedReports.filter(r => r.id !== id);
    persistReports(updated);
    set({ savedReports: updated });
  },

  clearReports: () => {
    persistReports([]);
    set({ savedReports: [] });
  },
}));
