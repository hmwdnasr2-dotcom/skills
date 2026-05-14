/**
 * Portal home page — system overview, quick-launch cards, live status strip.
 */
import { useStore } from '../state/store';
import { computeKPIs } from '../kpi/kpiEngine';
import { useMemo } from 'react';
import { formatSimClock } from '../simulation/scheduler';
import { SCENARIO_PRESETS } from '../scenarios/scenarios';

export function PortalPage() {
  const network   = useStore(s => s.network);
  const sim       = useStore(s => s.sim);
  const scenario  = useStore(s => s.scenario);
  const running   = useStore(s => s.running);
  const setPage   = useStore(s => s.setPage);
  const savedReports = useStore(s => s.savedReports);

  const kpis = useMemo(
    () => computeKPIs(sim.actualEvents, sim.buses, scenario, sim.pendingTripIndex),
    [sim.actualEvents, sim.buses, scenario, sim.pendingTripIndex],
  );

  const activeBuses   = sim.buses.filter(b => b.status !== 'completed').length;
  const totalPatterns = network.patterns.size;
  const serviceHour   = formatSimClock(sim.clock, scenario.startHour);

  const routes = [...network.routes.values()];

  return (
    <div className="page portal-page">
      {/* ── Hero strip ──────────────────────────────────────────────── */}
      <div className="portal-hero">
        <div className="hero-content">
          <h1 className="hero-title">RAKTA Operations Platform</h1>
          <p className="hero-sub">
            3D digital-twin simulation · route planning · KPI analytics
          </p>
          <div className="hero-actions">
            <button className="btn primary large" onClick={() => setPage('simulation')}>
              ▶ Open Simulation
            </button>
            <button className="btn large" onClick={() => setPage('data')}>
              ⊞ Browse Data
            </button>
            <button className="btn large" onClick={() => setPage('reports')}>
              ▦ View Reports
            </button>
          </div>
        </div>

        {/* live status pill */}
        <div className={`sim-status-card ${running ? 'live' : ''}`}>
          <div className="status-row">
            <span className={`status-dot ${running ? 'live' : ''}`} />
            <span className="status-label">{running ? 'Simulation Live' : 'Simulation Paused'}</span>
          </div>
          <div className="status-clock">{serviceHour}</div>
          <div className="status-meta">
            {activeBuses} buses active · {sim.pendingTripIndex} trips dispatched
          </div>
          <div className="status-scenario">{scenario.label}</div>
        </div>
      </div>

      {/* ── Quick-stats row ─────────────────────────────────────────── */}
      <div className="portal-stats">
        <StatCard icon="⬡" label="Stops"    value={network.stops.size}   />
        <StatCard icon="⇋" label="Routes"   value={network.routes.size}  />
        <StatCard icon="⤢" label="Patterns" value={totalPatterns}         />
        <StatCard icon="⊛" label="Active buses" value={activeBuses}      accent />
        <StatCard
          icon="✓"
          label="On-time"
          value={`${kpis.onTimePct.toFixed(1)}%`}
          tone={kpis.onTimePct > 85 ? 'good' : kpis.onTimePct > 70 ? 'warn' : 'bad'}
        />
        <StatCard
          icon="⊕"
          label="Avg delay"
          value={`${kpis.avgDelaySec >= 0 ? '+' : ''}${Math.round(kpis.avgDelaySec)}s`}
          tone={Math.abs(kpis.avgDelaySec) < 60 ? 'good' : 'warn'}
        />
        <StatCard icon="⊘" label="Bunching" value={kpis.bunchingIncidents}
          tone={kpis.bunchingIncidents === 0 ? 'good' : 'bad'} />
        <StatCard icon="◈" label="Reports saved" value={savedReports.length} />
      </div>

      {/* ── Feature cards ───────────────────────────────────────────── */}
      <div className="portal-cards">
        <FeatureCard
          title="3D Simulation"
          icon="▶"
          desc="Animate buses along routes on a live 3D map. Control playback speed, tune headways, and watch KPIs update in real time."
          cta="Launch →"
          onClick={() => setPage('simulation')}
          accent
        />
        <FeatureCard
          title="Data Management"
          icon="⊞"
          desc="Browse stops, routes, patterns and stop sequences. Upload Master_Data_Template.xlsx to replace the seed network."
          cta="Open →"
          onClick={() => setPage('data')}
        />
        <FeatureCard
          title="KPI Reports"
          icon="▦"
          desc="Capture simulation snapshots, compare scenarios side by side, and export headline metrics for planning reports."
          cta="View →"
          onClick={() => setPage('reports')}
        />
      </div>

      {/* ── Route summary ───────────────────────────────────────────── */}
      <div className="portal-section">
        <h2 className="section-title">Active Network</h2>
        <div className="route-summary-grid">
          {routes.map(r => {
            const patterns = [...network.patterns.values()].filter(p => p.route === r.routeCode);
            const stops = new Set(
              [...network.patternStops.entries()]
                .filter(([code]) => patterns.some(p => p.patternCode === code))
                .flatMap(([, rows]) => rows.map(row => row.stopCode)),
            );
            const rb = kpis.routeBreakdown.find(rb => rb.routeCode === r.routeCode);
            return (
              <div key={r.routeCode} className="route-summary-card" style={{ borderLeftColor: r.color }}>
                <div className="rscard-head">
                  <span className="rscard-code" style={{ color: r.color }}>{r.routeCode}</span>
                  <span className="rscard-name">{r.routeName}</span>
                </div>
                <div className="rscard-stats">
                  <span>{stops.size} stops</span>
                  <span>{patterns.length} patterns</span>
                  {rb && <span className={rb.onTimePct > 85 ? 'good' : 'warn'}>{rb.onTimePct.toFixed(0)}% on-time</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Scenario presets ─────────────────────────────────────────── */}
      <div className="portal-section">
        <h2 className="section-title">Scenario Presets</h2>
        <div className="preset-table-wrap">
          <table className="preset-table">
            <thead>
              <tr>
                <th>Scenario</th><th>Headway</th><th>Dwell</th><th>Speed</th><th>Traffic σ</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(SCENARIO_PRESETS).map(p => (
                <tr key={p.id} className={scenario.id === p.id ? 'active-row' : ''}>
                  <td>
                    <strong>{p.label}</strong>
                    <span className="muted small"> — {p.description}</span>
                  </td>
                  <td>{p.headwayMinutes} min</td>
                  <td>{p.dwellTimeSec} s</td>
                  <td>{p.speedMultiplier.toFixed(2)}×</td>
                  <td>±{(p.trafficDelayFactor * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon, label, value, accent, tone,
}: {
  icon: string; label: string; value: number | string;
  accent?: boolean; tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className={`portal-stat ${accent ? 'accent' : ''} ${tone ?? ''}`}>
      <span className="pstat-icon">{icon}</span>
      <span className="pstat-value">{value}</span>
      <span className="pstat-label">{label}</span>
    </div>
  );
}

function FeatureCard({
  title, icon, desc, cta, onClick, accent,
}: {
  title: string; icon: string; desc: string; cta: string;
  onClick: () => void; accent?: boolean;
}) {
  return (
    <div className={`feature-card ${accent ? 'accent' : ''}`} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}>
      <div className="fcard-icon">{icon}</div>
      <h3 className="fcard-title">{title}</h3>
      <p className="fcard-desc">{desc}</p>
      <span className="fcard-cta">{cta}</span>
    </div>
  );
}
