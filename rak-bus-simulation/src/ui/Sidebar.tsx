/**
 * Left sidebar: dataset import, route + pattern selectors, scenario picker.
 */

import { useRef } from 'react';
import { parseFile } from '../data/parser';
import { useStore } from '../state/store';
import { SCENARIO_PRESETS } from '../scenarios/scenarios';

export function Sidebar() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const network = useStore(s => s.network);
  const scenario = useStore(s => s.scenario);
  const selectedRoute = useStore(s => s.selectedRoute);
  const selectedPattern = useStore(s => s.selectedPattern);
  const loadDataset = useStore(s => s.loadDataset);
  const setScenario = useStore(s => s.setScenario);
  const setSelectedRoute = useStore(s => s.setSelectedRoute);
  const setSelectedPattern = useStore(s => s.setSelectedPattern);
  const togglePattern = useStore(s => s.togglePattern);
  const parseWarnings = useStore(s => s.parseWarnings);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseFile(file);
      loadDataset(parsed);
    } catch (err) {
      console.error('Failed to parse workbook', err);
      alert(`Failed to parse workbook: ${(err as Error).message}`);
    }
  }

  const routes = [...network.routes.values()];

  return (
    <aside className="sidebar">
      <section className="card">
        <header>
          <h2>Master Data</h2>
          <span className="badge">{network.stops.size} stops</span>
        </header>
        <p className="muted">
          Seeded with RAKTA network. Drop a <code>Master_Data_Template.xlsx</code>{' '}
          to replace.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFile}
          style={{ display: 'none' }}
        />
        <button
          className="btn primary"
          onClick={() => fileInputRef.current?.click()}
        >
          Import Workbook…
        </button>
        {parseWarnings.length > 0 && (
          <details className="warnings">
            <summary>{parseWarnings.length} warnings</summary>
            <ul>
              {parseWarnings.slice(0, 20).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card">
        <header>
          <h2>Scenario</h2>
          <span className="badge">{scenario.id}</span>
        </header>
        <select
          value={scenario.id}
          onChange={(e) => setScenario(e.target.value)}
          className="select"
        >
          {Object.values(SCENARIO_PRESETS).map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <p className="muted small">{scenario.description}</p>
      </section>

      <section className="card flex-1">
        <header>
          <h2>Routes &amp; Patterns</h2>
          <button
            className="btn ghost small"
            onClick={() => { setSelectedRoute(null); setSelectedPattern(null); }}
          >
            Clear
          </button>
        </header>
        <ul className="route-list">
          {routes.map(route => {
            const patterns = [...network.patterns.values()]
              .filter(p => p.route === route.routeCode);
            const isOpen = selectedRoute === route.routeCode;
            return (
              <li key={route.routeCode} className={isOpen ? 'open' : ''}>
                <button
                  className="route-row"
                  onClick={() => {
                    setSelectedRoute(isOpen ? null : route.routeCode);
                    setSelectedPattern(null);
                  }}
                >
                  <span className="swatch" style={{ background: route.color }} />
                  <span className="route-name">{route.routeName}</span>
                  <span className="route-code">{route.routeCode}</span>
                </button>
                {isOpen && (
                  <ul className="pattern-list">
                    {patterns.map(p => {
                      const isActive = scenario.activePatterns.has(p.patternCode);
                      const isSelected = selectedPattern === p.patternCode;
                      return (
                        <li
                          key={p.patternCode}
                          className={isSelected ? 'selected' : ''}
                        >
                          <label className="pattern-row">
                            <input
                              type="checkbox"
                              checked={isActive}
                              onChange={() => togglePattern(p.patternCode)}
                            />
                            <button
                              className="pattern-name"
                              onClick={(e) => {
                                e.preventDefault();
                                setSelectedPattern(isSelected ? null : p.patternCode);
                              }}
                            >
                              <span className="dir-pill">{p.direction}</span>
                              {p.patternName}
                            </button>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}
