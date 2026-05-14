/**
 * Root application shell.
 *
 * Renders the shared AppNav and routes to one of four pages based on
 * the `page` field in the Zustand store. The simulation page gets the
 * full remaining height so the 3D map can fill the viewport.
 */
import { useEffect, useRef } from 'react';
import { AppNav } from './components/AppNav';
import { PortalPage } from './pages/PortalPage';
import { DataPage } from './pages/DataPage';
import { ReportsPage } from './pages/ReportsPage';

// Simulation sub-components (previously the entire App)
import { Sidebar } from './ui/Sidebar';
import { KPIPanel } from './ui/KPIPanel';
import { Timeline } from './ui/Timeline';
import { ScenarioPanel } from './ui/ScenarioPanel';
import { MapView } from './map/MapView';
import { useStore } from './state/store';

export function App() {
  const page = useStore(s => s.page);

  return (
    <div className="app-shell">
      <AppNav />
      <div className={`page-host ${page === 'simulation' ? 'sim-host' : 'scroll-host'}`}>
        {page === 'portal'     && <PortalPage />}
        {page === 'data'       && <DataPage />}
        {page === 'reports'    && <ReportsPage />}
        {page === 'simulation' && <SimulationPage />}
      </div>
    </div>
  );
}

/** The 3D simulation view — same layout as the original App. */
function SimulationPage() {
  const lastFrameRef = useRef<number | null>(null);
  const tick         = useStore(s => s.tick);
  const running      = useStore(s => s.running);
  const speed        = useStore(s => s.speed);

  useEffect(() => {
    let rafId = 0;
    const loop = (now: number) => {
      const last  = lastFrameRef.current ?? now;
      const simDt = Math.min((now - last) / 1000, 0.1) * speed;
      lastFrameRef.current = now;
      if (running) tick(simDt);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
      lastFrameRef.current = null;
    };
  }, [running, speed, tick]);

  return (
    <div className="sim-page">
      <div className="main-grid">
        <Sidebar />
        <div className="map-area">
          <MapView />
        </div>
        <div className="right-rail">
          <ScenarioPanel />
          <KPIPanel />
        </div>
      </div>
      <Timeline />
    </div>
  );
}
