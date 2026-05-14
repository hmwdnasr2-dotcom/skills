/**
 * Top-level application shell.
 *
 *   ┌──────────────────────────── Header ────────────────────────────┐
 *   │  Sidebar   │             3D Map (deck.gl)            │  KPIs   │
 *   │  routes    │                                          │  buses  │
 *   │  scenario  │                                          │  routes │
 *   │            ├──────────── Timeline ────────────────────┤         │
 *   └────────────┴──────────────────────────────────────────┴─────────┘
 *
 * The animation loop lives here: requestAnimationFrame ticks the
 * simulation engine with dt scaled by the user-controlled speed knob.
 */

import { useEffect, useRef } from 'react';
import { Header } from './ui/Header';
import { Sidebar } from './ui/Sidebar';
import { KPIPanel } from './ui/KPIPanel';
import { Timeline } from './ui/Timeline';
import { ScenarioPanel } from './ui/ScenarioPanel';
import { MapView } from './map/MapView';
import { useStore } from './state/store';

export function App() {
  const lastFrameRef = useRef<number | null>(null);
  const tick = useStore(s => s.tick);
  const running = useStore(s => s.running);
  const speed = useStore(s => s.speed);

  useEffect(() => {
    let rafId = 0;
    const loop = (now: number) => {
      const last = lastFrameRef.current ?? now;
      const realDt = (now - last) / 1000;
      lastFrameRef.current = now;
      // Cap dt to 0.1s to avoid huge jumps after tab-switches.
      const simDt = Math.min(realDt, 0.1) * speed;
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
    <div className="app">
      <Header />
      <main className="main-grid">
        <Sidebar />
        <div className="map-area">
          <MapView />
        </div>
        <div className="right-rail">
          <ScenarioPanel />
          <KPIPanel />
        </div>
      </main>
      <Timeline />
    </div>
  );
}
