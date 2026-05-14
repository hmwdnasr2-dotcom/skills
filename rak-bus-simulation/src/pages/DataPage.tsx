/**
 * Data Management page.
 *
 * Four tabbed tables (Stops / Routes / Patterns / Stop Sequences).
 * Every table supports live text filtering. A workbook upload button
 * replaces the active network, identical to the sidebar import.
 */
import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { parseFile } from '../data/parser';
import type { RoutePatternStop, Stop } from '../types/transport';

type DataTab = 'stops' | 'routes' | 'patterns' | 'sequences';

export function DataPage() {
  const [tab, setTab]       = useState<DataTab>('stops');
  const [query, setQuery]   = useState('');
  const fileRef             = useRef<HTMLInputElement | null>(null);

  const network             = useStore(s => s.network);
  const loadDataset         = useStore(s => s.loadDataset);
  const parseWarnings       = useStore(s => s.parseWarnings);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseFile(file);
      loadDataset(parsed);
      setQuery('');
    } catch (err) {
      alert(`Failed to parse workbook: ${(err as Error).message}`);
    }
    e.target.value = '';
  }

  const q = query.toLowerCase();

  return (
    <div className="page data-page">
      <div className="data-header">
        <div>
          <h1 className="page-title">Data Management</h1>
          <p className="page-sub muted">
            Network loaded from seed data.{' '}
            <button className="link-btn" onClick={() => fileRef.current?.click()}>
              Import spreadsheet
            </button>{' '}
            to replace.
          </p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} hidden />
        </div>

        <div className="data-actions">
          <button className="btn primary" onClick={() => fileRef.current?.click()}>
            ↑ Import Workbook
          </button>
        </div>
      </div>

      {parseWarnings.length > 0 && (
        <div className="warn-banner">
          <strong>⚠ {parseWarnings.length} import warning(s):</strong>{' '}
          {parseWarnings.slice(0, 3).join(' · ')}
          {parseWarnings.length > 3 && ` … +${parseWarnings.length - 3} more`}
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div className="data-tabs">
        {(['stops', 'routes', 'patterns', 'sequences'] as DataTab[]).map(t => (
          <button
            key={t}
            className={`data-tab ${tab === t ? 'active' : ''}`}
            onClick={() => { setTab(t); setQuery(''); }}
          >
            {t === 'stops'     && `Stops (${network.stops.size})`}
            {t === 'routes'    && `Routes (${network.routes.size})`}
            {t === 'patterns'  && `Patterns (${network.patterns.size})`}
            {t === 'sequences' && `Stop Sequences (${network.routePatternStops.length})`}
          </button>
        ))}
        <input
          className="data-search"
          placeholder="Filter…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {/* ── Table area ────────────────────────────────────────────── */}
      <div className="data-table-wrap">
        {tab === 'stops'     && <StopsTable q={q} stops={[...network.stops.values()]} />}
        {tab === 'routes'    && <RoutesTable q={q} network={network} />}
        {tab === 'patterns'  && <PatternsTable q={q} network={network} />}
        {tab === 'sequences' && <SequencesTable q={q} rows={network.routePatternStops} network={network} />}
      </div>
    </div>
  );
}

/* ── Sub-tables ─────────────────────────────────────────────────────── */

function StopsTable({ stops, q }: { stops: Stop[]; q: string }) {
  const filtered = stops.filter(s =>
    !q ||
    s.stopCode.toLowerCase().includes(q) ||
    s.stopName.toLowerCase().includes(q) ||
    (s.terminusName ?? '').toLowerCase().includes(q),
  );
  return (
    <table className="dt">
      <thead>
        <tr>
          <th>Code</th><th>Name</th><th>Latitude</th><th>Longitude</th>
          <th>Charging</th><th>Terminus</th>
        </tr>
      </thead>
      <tbody>
        {filtered.length === 0 && <tr><td colSpan={6} className="dt-empty">No results</td></tr>}
        {filtered.map(s => (
          <tr key={s.stopCode}>
            <td><code>{s.stopCode}</code></td>
            <td>{s.stopName}</td>
            <td className="num">{s.latitude.toFixed(6)}</td>
            <td className="num">{s.longitude.toFixed(6)}</td>
            <td className="center">{s.chargingPointFlag ? <span className="badge-good">✓</span> : '—'}</td>
            <td>{s.terminusName ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RoutesTable({ q, network }: { q: string; network: ReturnType<typeof useStore.getState>['network'] }) {
  const routes = [...network.routes.values()].filter(r =>
    !q || r.routeCode.toLowerCase().includes(q) || r.routeName.toLowerCase().includes(q),
  );
  return (
    <table className="dt">
      <thead>
        <tr><th>Code</th><th>Route Name</th><th>Depot</th><th>Patterns</th><th>Stops</th></tr>
      </thead>
      <tbody>
        {routes.length === 0 && <tr><td colSpan={5} className="dt-empty">No results</td></tr>}
        {routes.map(r => {
          const pats = [...network.patterns.values()].filter(p => p.route === r.routeCode);
          const stopSet = new Set(
            pats.flatMap(p => (network.patternStops.get(p.patternCode) ?? []).map(rp => rp.stopCode)),
          );
          return (
            <tr key={r.routeCode}>
              <td>
                <span className="route-chip" style={{ background: r.color }}>{r.routeCode}</span>
              </td>
              <td>{r.routeName}</td>
              <td>{r.depot}</td>
              <td className="num">{pats.length}</td>
              <td className="num">{stopSet.size}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PatternsTable({ q, network }: { q: string; network: ReturnType<typeof useStore.getState>['network'] }) {
  const patterns = [...network.patterns.values()].filter(p =>
    !q ||
    p.patternCode.toLowerCase().includes(q) ||
    p.patternName.toLowerCase().includes(q) ||
    p.route.toLowerCase().includes(q),
  );
  return (
    <table className="dt">
      <thead>
        <tr><th>Code</th><th>Name</th><th>Route</th><th>Direction</th><th>Stops</th><th>Depot</th></tr>
      </thead>
      <tbody>
        {patterns.length === 0 && <tr><td colSpan={6} className="dt-empty">No results</td></tr>}
        {patterns.map(p => {
          const route = network.routes.get(p.route);
          const stops = network.patternStops.get(p.patternCode)?.length ?? 0;
          return (
            <tr key={p.patternCode}>
              <td><code>{p.patternCode}</code></td>
              <td>{p.patternName}</td>
              <td>
                {route && <span className="route-chip sm" style={{ background: route.color }}>{p.route}</span>}
              </td>
              <td>
                <span className={`dir-badge ${p.direction.toLowerCase()}`}>{p.direction}</span>
              </td>
              <td className="num">{stops}</td>
              <td>{p.depot}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SequencesTable({
  q, rows, network,
}: {
  q: string;
  rows: RoutePatternStop[];
  network: ReturnType<typeof useStore.getState>['network'];
}) {
  const filtered = rows
    .filter(r =>
      !q ||
      r.route.toLowerCase().includes(q) ||
      r.stopCode.toLowerCase().includes(q) ||
      r.stopName.toLowerCase().includes(q) ||
      (r.pathPattern ?? '').toLowerCase().includes(q),
    )
    .slice(0, 500);

  return (
    <table className="dt">
      <thead>
        <tr>
          <th>Route</th><th>Pattern</th><th>Dir</th>
          <th>Seq</th><th>Stop Code</th><th>Stop Name</th>
          <th>Travel Time (s)</th><th>Distance (m)</th>
        </tr>
      </thead>
      <tbody>
        {filtered.length === 0 && <tr><td colSpan={8} className="dt-empty">No results</td></tr>}
        {filtered.map((r, i) => {
          const route = network.routes.get(r.route);
          return (
            <tr key={i}>
              <td>
                {route && <span className="route-chip sm" style={{ background: route.color }}>{r.route}</span>}
              </td>
              <td><code className="small">{r.pathPattern ?? '—'}</code></td>
              <td><span className={`dir-badge ${r.direction.toLowerCase()}`}>{r.direction}</span></td>
              <td className="num">{r.sequence}</td>
              <td><code>{r.stopCode}</code></td>
              <td>{r.stopName}</td>
              <td className="num">{r.travelTime ?? '—'}</td>
              <td className="num">{r.distance?.toLocaleString() ?? '—'}</td>
            </tr>
          );
        })}
        {rows.length > 500 && (
          <tr><td colSpan={8} className="dt-truncated">Showing first 500 of {rows.length} rows</td></tr>
        )}
      </tbody>
    </table>
  );
}
