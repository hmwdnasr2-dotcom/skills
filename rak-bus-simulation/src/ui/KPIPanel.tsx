/**
 * Right panel: live KPIs + active-bus roster.
 */

import { useMemo } from 'react';
import { useStore } from '../state/store';
import { computeKPIs } from '../kpi/kpiEngine';
import { formatSimClock } from '../simulation/scheduler';

const fmtSec = (s: number) => {
  const sign = s < 0 ? '-' : '+';
  const abs = Math.abs(s);
  const m = Math.floor(abs / 60);
  const ss = Math.round(abs % 60);
  return `${sign}${m}m ${ss}s`;
};

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

export function KPIPanel() {
  const sim = useStore(s => s.sim);
  const scenario = useStore(s => s.scenario);
  const network = useStore(s => s.network);

  const kpis = useMemo(
    () => computeKPIs(sim.actualEvents, sim.buses, scenario, sim.pendingTripIndex),
    [sim.actualEvents, sim.buses, scenario, sim.pendingTripIndex],
  );

  const activeBuses = sim.buses.filter(b => b.status !== 'completed');

  return (
    <aside className="kpi-panel">
      <section className="card">
        <header>
          <h2>Operations</h2>
          <span className="badge">{formatSimClock(sim.clock, scenario.startHour)}</span>
        </header>
        <div className="kpi-grid">
          <KPI label="Active buses" value={String(kpis.activeBuses)} tone="info" />
          <KPI label="Dispatched" value={String(kpis.totalBusesDispatched)} tone="info" />
          <KPI
            label="On-time"
            value={fmtPct(kpis.onTimePct)}
            tone={kpis.onTimePct > 85 ? 'good' : kpis.onTimePct > 70 ? 'warn' : 'bad'}
          />
          <KPI
            label="Avg delay"
            value={fmtSec(kpis.avgDelaySec)}
            tone={kpis.avgDelaySec < 60 ? 'good' : kpis.avgDelaySec < 180 ? 'warn' : 'bad'}
          />
          <KPI label="Early" value={fmtPct(kpis.earlyPct)} tone="warn" />
          <KPI label="Late" value={fmtPct(kpis.latePct)} tone={kpis.latePct < 15 ? 'good' : 'bad'} />
          <KPI
            label="Headway σ"
            value={`${(kpis.headwayAdherenceSec / 60).toFixed(1)}m`}
            tone={kpis.headwayAdherenceSec < 120 ? 'good' : 'warn'}
          />
          <KPI
            label="Bunching"
            value={String(kpis.bunchingIncidents)}
            tone={kpis.bunchingIncidents === 0 ? 'good' : 'bad'}
          />
        </div>
      </section>

      <section className="card">
        <header>
          <h2>Route Performance</h2>
        </header>
        <table className="route-table">
          <thead>
            <tr>
              <th>Route</th>
              <th>Events</th>
              <th>On-time</th>
              <th>Avg Δ</th>
              <th>Bunch</th>
            </tr>
          </thead>
          <tbody>
            {kpis.routeBreakdown.length === 0 && (
              <tr><td colSpan={5} className="muted center">Awaiting events…</td></tr>
            )}
            {kpis.routeBreakdown.map(r => {
              const route = network.routes.get(r.routeCode);
              return (
                <tr key={r.routeCode}>
                  <td>
                    <span className="swatch sm" style={{ background: route?.color ?? '#888' }} />
                    {r.routeCode}
                  </td>
                  <td>{r.events}</td>
                  <td className={r.onTimePct > 85 ? 'good' : r.onTimePct > 70 ? 'warn' : 'bad'}>
                    {fmtPct(r.onTimePct)}
                  </td>
                  <td>{fmtSec(r.avgDelaySec)}</td>
                  <td className={r.bunchingIncidents > 0 ? 'bad' : 'good'}>
                    {r.bunchingIncidents}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card flex-1">
        <header>
          <h2>Active Buses</h2>
          <span className="badge">{activeBuses.length}</span>
        </header>
        <ul className="bus-list">
          {activeBuses.length === 0 && (
            <li className="muted center small">No buses in service.</li>
          )}
          {activeBuses.slice(0, 30).map(b => {
            const route = network.routes.get(b.routeCode);
            const delayClass = b.delaySec > 120 ? 'bad' : b.delaySec < -60 ? 'warn' : 'good';
            return (
              <li key={b.id} className="bus-row">
                <span className="swatch sm" style={{ background: route?.color ?? '#888' }} />
                <span className="bus-id">{b.patternCode}</span>
                <span className="bus-status">
                  {b.status === 'at-stop' ? `@ ${b.currentStopCode}` : 'in-transit'}
                </span>
                <span className={`bus-delay ${delayClass}`}>{fmtSec(b.delaySec)}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}

function KPI({ label, value, tone }: { label: string; value: string; tone: 'good' | 'warn' | 'bad' | 'info' }) {
  return (
    <div className={`kpi ${tone}`}>
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}
