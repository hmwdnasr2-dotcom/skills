/**
 * Tuner: live-edit the active scenario's parameters. Each commit resets
 * the simulation so the planner sees the consequence immediately.
 */

import { useStore } from '../state/store';

export function ScenarioPanel() {
  const scenario = useStore(s => s.scenario);
  const updateScenario = useStore(s => s.updateScenario);

  return (
    <section className="card scenario-tuner">
      <header><h2>Tune Scenario</h2></header>
      <Slider
        label="Headway (min)"
        value={scenario.headwayMinutes}
        min={5} max={60} step={1}
        onChange={(v) => updateScenario({ headwayMinutes: v })}
      />
      <Slider
        label="Dwell (sec)"
        value={scenario.dwellTimeSec}
        min={10} max={120} step={5}
        onChange={(v) => updateScenario({ dwellTimeSec: v })}
      />
      <Slider
        label="Speed mult."
        value={scenario.speedMultiplier}
        min={0.4} max={1.6} step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => updateScenario({ speedMultiplier: v })}
      />
      <Slider
        label="Traffic σ"
        value={scenario.trafficDelayFactor}
        min={0} max={0.5} step={0.01}
        format={(v) => `±${(v * 100).toFixed(0)}%`}
        onChange={(v) => updateScenario({ trafficDelayFactor: v })}
      />
    </section>
  );
}

function Slider({
  label, value, min, max, step, onChange, format,
}: {
  label: string;
  value: number;
  min: number; max: number; step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-value">{format ? format(value) : value}</span>
    </label>
  );
}
