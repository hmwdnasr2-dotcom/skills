/**
 * KPI Reports page.
 *
 * - Capture a snapshot of the current simulation's KPIs.
 * - History list with delete.
 * - Side-by-side scenario comparison bar chart (pure SVG, no extra dep).
 * - Per-route bar chart for the selected report.
 */
import { useState, useMemo } from 'react';
import { useStore, type SavedReport } from '../state/store';
import { computeKPIs } from '../kpi/kpiEngine';
import { formatSimClock } from '../simulation/scheduler';

export function ReportsPage() {
  const sim          = useStore(s => s.sim);
  const scenario     = useStore(s => s.scenario);
  const savedReports = useStore(s => s.savedReports);
  const saveReport   = useStore(s => s.saveReport);
  const deleteReport = useStore(s => s.deleteReport);
  const clearReports = useStore(s => s.clearReports);
  const setPage      = useStore(s => s.setPage);

  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const liveKpis = useMemo(
    () => computeKPIs(sim.actualEvents, sim.buses, scenario, sim.pendingTripIndex),
    [sim.actualEvents, sim.buses, scenario, sim.pendingTripIndex],
  );

  const reportA = savedReports.find(r => r.id === compareA);
  const reportB = savedReports.find(r => r.id === compareB);
  const selectedReport = savedReports.find(r => r.id === selected);

  return (
    <div className="page reports-page">
      <div className="reports-header">
        <div>
          <h1 className="page-title">KPI Reports</h1>
          <p className="page-sub muted">
            Capture simulation snapshots and compare scenarios.
          </p>
        </div>
        <div className="reports-actions">
          <button className="btn primary" onClick={saveReport}>
            ⊕ Capture Current KPIs
          </button>
          {savedReports.length > 0 && (
            <button className="btn" onClick={() => {
              if (confirm('Delete all saved reports?')) clearReports();
            }}>
              ✕ Clear All
            </button>
          )}
        </div>
      </div>

      {/* ── Live snapshot ─────────────────────────────────────────── */}
      <div className="reports-section">
        <h2 className="section-title">Live Snapshot</h2>
        <div className="live-snapshot">
          <div className="snapshot-clock">
            <span className="label muted">Sim time</span>
            <span className="clock-val">{formatSimClock(sim.clock, scenario.startHour)}</span>
          </div>
          <div className="snapshot-scenario">{scenario.label}</div>
          <KpiRow kpis={liveKpis} />
          <button className="btn primary sm" onClick={saveReport}>Save this snapshot →</button>
        </div>
      </div>

      {savedReports.length === 0 && (
        <div className="empty-state">
          <p>No reports saved yet.</p>
          <p className="muted small">
            Run the simulation then click <strong>Capture Current KPIs</strong> to save a snapshot.
          </p>
          <button className="btn primary" onClick={() => setPage('simulation')}>
            ▶ Go to Simulation
          </button>
        </div>
      )}

      {savedReports.length > 0 && (
        <>
          {/* ── History list ─────────────────────────────────────── */}
          <div className="reports-section">
            <h2 className="section-title">Saved Reports ({savedReports.length})</h2>
            <div className="report-list">
              {savedReports.map(r => (
                <ReportRow
                  key={r.id}
                  report={r}
                  isSelected={selected === r.id}
                  isA={compareA === r.id}
                  isB={compareB === r.id}
                  onSelect={() => setSelected(selected === r.id ? null : r.id)}
                  onSetA={() => setCompareA(compareA === r.id ? null : r.id)}
                  onSetB={() => setCompareB(compareB === r.id ? null : r.id)}
                  onDelete={() => deleteReport(r.id)}
                />
              ))}
            </div>
          </div>

          {/* ── Selected report detail ───────────────────────────── */}
          {selectedReport && (
            <div className="reports-section">
              <h2 className="section-title">
                Report Detail — {selectedReport.scenarioLabel}{' '}
                <span className="muted small">({new Date(selectedReport.savedAt).toLocaleString()})</span>
              </h2>
              <KpiRow kpis={selectedReport.kpis} />
              {selectedReport.kpis.routeBreakdown.length > 0 && (
                <RouteBreakdownChart breakdown={selectedReport.kpis.routeBreakdown} />
              )}
            </div>
          )}

          {/* ── Comparison ──────────────────────────────────────── */}
          <div className="reports-section">
            <h2 className="section-title">Scenario Comparison</h2>
            <p className="muted small">Select report A and report B using the buttons above to compare.</p>
            {reportA && reportB ? (
              <ComparisonChart a={reportA} b={reportB} />
            ) : (
              <div className="comp-placeholder muted">
                Tag one report as <strong>A</strong> and another as <strong>B</strong> to compare.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Report row ─────────────────────────────────────────────────────── */

function ReportRow({
  report, isSelected, isA, isB, onSelect, onSetA, onSetB, onDelete,
}: {
  report: SavedReport;
  isSelected: boolean; isA: boolean; isB: boolean;
  onSelect: () => void; onSetA: () => void; onSetB: () => void; onDelete: () => void;
}) {
  const k = report.kpis;
  return (
    <div className={`report-row ${isSelected ? 'selected' : ''}`}>
      <button className="report-row-main" onClick={onSelect}>
        <div className="report-meta">
          <strong>{report.scenarioLabel}</strong>
          <span className="muted small">{new Date(report.savedAt).toLocaleString()}</span>
          <span className="muted small">sim {formatSimClock(report.simClockSec, 6)}</span>
        </div>
        <div className="report-kpi-strip">
          <KpiChip label="OTP" value={`${k.onTimePct.toFixed(1)}%`} tone={k.onTimePct > 85 ? 'good' : 'warn'} />
          <KpiChip label="Avg Δ" value={`${Math.round(k.avgDelaySec)}s`} tone={Math.abs(k.avgDelaySec) < 60 ? 'good' : 'warn'} />
          <KpiChip label="Buses" value={String(k.totalBusesDispatched)} tone="info" />
          <KpiChip label="Bunch" value={String(k.bunchingIncidents)} tone={k.bunchingIncidents === 0 ? 'good' : 'bad'} />
        </div>
      </button>
      <div className="report-row-actions">
        <button className={`tag-btn ${isA ? 'active-a' : ''}`} onClick={onSetA}>A</button>
        <button className={`tag-btn ${isB ? 'active-b' : ''}`} onClick={onSetB}>B</button>
        <button className="tag-btn del" onClick={onDelete} title="Delete">✕</button>
      </div>
    </div>
  );
}

/* ── KPI summary row ────────────────────────────────────────────────── */

function KpiRow({ kpis }: { kpis: ReturnType<typeof computeKPIs> }) {
  return (
    <div className="kpi-row">
      <KpiChip label="On-time" value={`${kpis.onTimePct.toFixed(1)}%`} tone={kpis.onTimePct > 85 ? 'good' : kpis.onTimePct > 70 ? 'warn' : 'bad'} big />
      <KpiChip label="Early"   value={`${kpis.earlyPct.toFixed(1)}%`}  tone="warn" big />
      <KpiChip label="Late"    value={`${kpis.latePct.toFixed(1)}%`}   tone={kpis.latePct < 15 ? 'good' : 'bad'} big />
      <KpiChip label="Avg Δ"   value={`${Math.round(kpis.avgDelaySec)}s`} tone={Math.abs(kpis.avgDelaySec) < 60 ? 'good' : 'warn'} big />
      <KpiChip label="p90 Δ"   value={`${Math.round(kpis.p90DelaySec)}s`} tone={kpis.p90DelaySec < 120 ? 'good' : 'warn'} big />
      <KpiChip label="Hwdy σ"  value={`${(kpis.headwayAdherenceSec / 60).toFixed(1)}m`} tone={kpis.headwayAdherenceSec < 120 ? 'good' : 'warn'} big />
      <KpiChip label="Bunching" value={String(kpis.bunchingIncidents)} tone={kpis.bunchingIncidents === 0 ? 'good' : 'bad'} big />
      <KpiChip label="Dispatched" value={String(kpis.totalBusesDispatched)} tone="info" big />
    </div>
  );
}

function KpiChip({
  label, value, tone, big,
}: {
  label: string; value: string; tone: 'good' | 'warn' | 'bad' | 'info'; big?: boolean;
}) {
  return (
    <div className={`kpi-chip ${tone} ${big ? 'big' : ''}`}>
      <span className="chip-value">{value}</span>
      <span className="chip-label">{label}</span>
    </div>
  );
}

/* ── Route breakdown bar chart (SVG) ───────────────────────────────── */

function RouteBreakdownChart({
  breakdown,
}: {
  breakdown: ReturnType<typeof computeKPIs>['routeBreakdown'];
}) {
  const W = 560; const H = 140; const BAR_H = 22; const PAD = 40;
  const max = 100;

  return (
    <div className="chart-wrap">
      <h3 className="chart-title">On-time % by Route</h3>
      <svg viewBox={`0 0 ${W} ${breakdown.length * (BAR_H + 8) + PAD}`} className="bar-chart">
        {breakdown.map((r, i) => {
          const y = PAD / 2 + i * (BAR_H + 8);
          const barW = (r.onTimePct / max) * (W - 120);
          const color = r.onTimePct > 85 ? '#4ade80' : r.onTimePct > 70 ? '#fbbf24' : '#f87171';
          return (
            <g key={r.routeCode}>
              <text x={0} y={y + BAR_H / 2 + 5} fill="#94a3b8" fontSize="12" fontFamily="system-ui">{r.routeCode}</text>
              <rect x={44} y={y} width={Math.max(4, barW)} height={BAR_H} fill={color} rx="3" opacity="0.85" />
              <text x={50 + Math.max(4, barW)} y={y + BAR_H / 2 + 5} fill="#f1f5f9" fontSize="11" fontFamily="system-ui">
                {r.onTimePct.toFixed(1)}%
              </text>
            </g>
          );
        })}
        <line x1={44} y1={PAD / 2 - 6} x2={44} y2={breakdown.length * (BAR_H + 8) + PAD / 2} stroke="#334155" strokeWidth="1" />
      </svg>
    </div>
  );
}

/* ── Comparison chart ───────────────────────────────────────────────── */

const METRICS: { key: keyof ReturnType<typeof computeKPIs>; label: string; higher: 'good' | 'bad' }[] = [
  { key: 'onTimePct',           label: 'On-time %',    higher: 'good' },
  { key: 'earlyPct',            label: 'Early %',      higher: 'bad'  },
  { key: 'latePct',             label: 'Late %',       higher: 'bad'  },
  { key: 'avgDelaySec',         label: 'Avg Delay (s)',higher: 'bad'  },
  { key: 'bunchingIncidents',   label: 'Bunching',     higher: 'bad'  },
  { key: 'headwayAdherenceSec', label: 'Headway σ (s)',higher: 'bad'  },
];

function ComparisonChart({ a, b }: { a: SavedReport; b: SavedReport }) {
  return (
    <div className="comparison-wrap">
      <div className="comp-legend">
        <span className="comp-a-swatch" /> <strong>A</strong>: {a.scenarioLabel}
        <span style={{ margin: '0 16px' }} />
        <span className="comp-b-swatch" /> <strong>B</strong>: {b.scenarioLabel}
      </div>
      <table className="comp-table">
        <thead>
          <tr><th>Metric</th><th>A</th><th>B</th><th>Δ (B−A)</th></tr>
        </thead>
        <tbody>
          {METRICS.map(m => {
            const va = a.kpis[m.key] as number;
            const vb = b.kpis[m.key] as number;
            const delta = vb - va;
            const better = (m.higher === 'good' && delta > 0) || (m.higher === 'bad' && delta < 0);
            const worse  = (m.higher === 'good' && delta < 0) || (m.higher === 'bad' && delta > 0);
            return (
              <tr key={m.key}>
                <td>{m.label}</td>
                <td className="num">{va.toFixed(1)}</td>
                <td className="num">{vb.toFixed(1)}</td>
                <td className={`num ${better ? 'good' : worse ? 'bad' : ''}`}>
                  {delta >= 0 ? '+' : ''}{delta.toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Horizontal grouped bar chart */}
      <CompBarChart a={a} b={b} />
    </div>
  );
}

function CompBarChart({ a, b }: { a: SavedReport; b: SavedReport }) {
  const items = [
    { label: 'OTP %',    va: a.kpis.onTimePct,           vb: b.kpis.onTimePct,           max: 100  },
    { label: 'Late %',   va: a.kpis.latePct,             vb: b.kpis.latePct,             max: 100  },
    { label: 'Avg Δ',    va: Math.abs(a.kpis.avgDelaySec), vb: Math.abs(b.kpis.avgDelaySec), max: 600 },
    { label: 'p90 Δ',    va: a.kpis.p90DelaySec,         vb: b.kpis.p90DelaySec,         max: 600  },
  ];
  const W = 520; const ROW_H = 36; const LABEL_W = 64; const BAR_AREA = W - LABEL_W - 60;

  return (
    <div className="chart-wrap" style={{ marginTop: 16 }}>
      <svg viewBox={`0 0 ${W} ${items.length * ROW_H + 20}`} className="bar-chart">
        {items.map((item, i) => {
          const y = 10 + i * ROW_H;
          const wA = (item.va / item.max) * BAR_AREA;
          const wB = (item.vb / item.max) * BAR_AREA;
          return (
            <g key={item.label}>
              <text x={0} y={y + 14} fill="#94a3b8" fontSize="11" fontFamily="system-ui">{item.label}</text>
              {/* A bar */}
              <rect x={LABEL_W} y={y} width={Math.max(2, wA)} height={14} fill="#22d3ee" rx="2" opacity="0.8" />
              <text x={LABEL_W + Math.max(2, wA) + 4} y={y + 11} fill="#94a3b8" fontSize="10" fontFamily="system-ui">
                {item.va.toFixed(1)}
              </text>
              {/* B bar */}
              <rect x={LABEL_W} y={y + 16} width={Math.max(2, wB)} height={14} fill="#a78bfa" rx="2" opacity="0.8" />
              <text x={LABEL_W + Math.max(2, wB) + 4} y={y + 27} fill="#94a3b8" fontSize="10" fontFamily="system-ui">
                {item.vb.toFixed(1)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
