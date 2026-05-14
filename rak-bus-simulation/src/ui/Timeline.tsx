/**
 * Bottom playback controls + service-day timeline.
 */

import { useStore } from '../state/store';
import { formatSimClock } from '../simulation/scheduler';

const SPEED_OPTIONS = [1, 10, 30, 60, 120, 300];

export function Timeline() {
  const sim = useStore(s => s.sim);
  const scenario = useStore(s => s.scenario);
  const running = useStore(s => s.running);
  const speed = useStore(s => s.speed);
  const toggleRunning = useStore(s => s.toggleRunning);
  const setSpeed = useStore(s => s.setSpeed);
  const reset = useStore(s => s.reset);

  const serviceSpan = (scenario.endHour - scenario.startHour) * 3600;
  const progress = Math.min(1, sim.clock / serviceSpan);

  return (
    <footer className="timeline-bar">
      <div className="controls">
        <button className="btn primary" onClick={toggleRunning}>
          {running ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button className="btn" onClick={reset}>↺ Reset</button>
        <div className="speed-group">
          <span className="muted">Speed</span>
          {SPEED_OPTIONS.map(s => (
            <button
              key={s}
              className={`btn pill ${speed === s ? 'active' : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="clock-block">
        <div className="clock">
          {formatSimClock(sim.clock, scenario.startHour)}
        </div>
        <div className="sched-info">
          <span className="muted">Trips dispatched</span>
          <strong>{sim.pendingTripIndex}/{sim.trips.length}</strong>
        </div>
      </div>

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
        <div className="hour-marks">
          {Array.from({ length: scenario.endHour - scenario.startHour + 1 }, (_, i) => {
            const hour = scenario.startHour + i;
            const left = (i / (scenario.endHour - scenario.startHour)) * 100;
            return (
              <span key={hour} className="hour-tick" style={{ left: `${left}%` }}>
                {`${hour.toString().padStart(2, '0')}:00`}
              </span>
            );
          })}
        </div>
      </div>
    </footer>
  );
}
