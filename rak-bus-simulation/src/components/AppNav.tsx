/**
 * Top navigation bar — visible on every page.
 * Active tab highlighted; simulation badge shows live status.
 */
import { useStore, type Page } from '../state/store';

const TABS: { id: Page; label: string; icon: string }[] = [
  { id: 'portal',     label: 'Home',        icon: '⬡' },
  { id: 'simulation', label: 'Simulation',  icon: '▶' },
  { id: 'data',       label: 'Data',        icon: '⊞' },
  { id: 'reports',    label: 'Reports',     icon: '▦' },
];

export function AppNav() {
  const page = useStore(s => s.page);
  const setPage = useStore(s => s.setPage);
  const running = useStore(s => s.running);
  const activeBuses = useStore(s => s.sim.buses.filter(b => b.status !== 'completed').length);
  const network = useStore(s => s.network);
  const savedReports = useStore(s => s.savedReports);

  return (
    <nav className="app-nav">
      <div className="nav-brand">
        <span className="nav-mark">RAK</span>
        <span className="nav-title">RAKTA Digital Twin</span>
      </div>

      <div className="nav-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`nav-tab ${page === t.id ? 'active' : ''}`}
            onClick={() => setPage(t.id)}
          >
            <span className="nav-icon">{t.icon}</span>
            <span>{t.label}</span>
            {t.id === 'simulation' && running && (
              <span className="nav-live-dot" title="Simulation running" />
            )}
            {t.id === 'simulation' && activeBuses > 0 && (
              <span className="nav-count">{activeBuses}</span>
            )}
            {t.id === 'reports' && savedReports.length > 0 && (
              <span className="nav-count">{savedReports.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="nav-meta">
        <span className="nav-stat">{network.stops.size} stops</span>
        <span className="nav-stat">{network.routes.size} routes</span>
        <span className="nav-geo">Ras Al Khaimah · UAE</span>
      </div>
    </nav>
  );
}
