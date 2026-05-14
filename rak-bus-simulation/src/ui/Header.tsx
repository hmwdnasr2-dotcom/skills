export function Header() {
  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark">RAK</div>
        <div className="brand-text">
          <h1>RAKTA Digital Twin</h1>
          <span className="muted small">3D bus operations simulation · MVP</span>
        </div>
      </div>
      <nav className="header-meta">
        <span className="pill-info">Ras Al Khaimah · UAE</span>
        <span className="pill-info live">● LIVE SIM</span>
      </nav>
    </header>
  );
}
