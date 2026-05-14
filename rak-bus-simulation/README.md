# RAK Bus Simulation — 3D Digital Twin

A fully functional 3D digital-twin simulation platform for **Ras Al Khaimah (RAKTA)** public transport operations. Transport planners can visualise routes, simulate bus movements, compare scheduled vs. actual performance, and test operational scenarios — all before deployment.

---

## Quick Start

```bash
cd rak-bus-simulation
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Architecture

```
src/
├── types/          Core domain types (Stop, Route, Pattern, Bus, Trip…)
├── data/
│   ├── seedData.ts       Synthesised RAK network (boots without spreadsheet)
│   ├── parser.ts         Master_Data_Template.xlsx ingestion
│   └── networkBuilder.ts Builds TransportNetwork from parsed rows
├── simulation/
│   ├── scheduler.ts      Generates Trips for a full service day
│   └── engine.ts         Tick-based bus movement + delay model
├── scenarios/
│   └── scenarios.ts      Preset + custom ScenarioParams
├── kpi/
│   └── kpiEngine.ts      Computes OTP, headway σ, bunching, delay stats
├── map/
│   ├── MapView.tsx        MapLibre GL JS + deck.gl canvas
│   └── layers.ts          Route / stop / bus deck.gl layer factory
├── state/
│   └── store.ts           Zustand store (network, sim state, UI selections)
└── ui/
    ├── Header.tsx
    ├── Sidebar.tsx        Route/pattern selector + dataset import
    ├── KPIPanel.tsx       Live KPI grid + per-route breakdown + bus roster
    ├── ScenarioPanel.tsx  Live parameter sliders
    └── Timeline.tsx       Playback controls + progress bar
```

### Data Flow

```
Excel / seed data
      │
  parser.ts
      │
 networkBuilder.ts ──► TransportNetwork (Map-based lookups)
      │
  scheduler.ts ──► Trip[] (scheduled timetable for the day)
      │
  engine.ts (tick loop, 1 RAF per frame)
      │
  SimulationState ──► deck.gl layers (buses, routes, stops)
      │
  kpiEngine.ts ──► KPIs (OTP, delay, bunching, headway σ)
```

---

## Features

| Feature | Status |
|---------|--------|
| 3D map (MapLibre + deck.gl) | ✅ |
| Route + pattern visualisation | ✅ |
| Animated buses (3D columns) | ✅ |
| Scheduled vs. actual delay tracking | ✅ |
| Play / Pause / Speed (1×–300×) | ✅ |
| KPI dashboard (8 metrics) | ✅ |
| Per-route performance breakdown | ✅ |
| Bunching detection | ✅ |
| Headway adherence σ | ✅ |
| Scenario presets (4) | ✅ |
| Live parameter tuning (sliders) | ✅ |
| Excel workbook import | ✅ |
| Seed data (18 stops, 4 routes, 8 patterns) | ✅ |

---

## Importing Your Spreadsheet

1. Click **Import Workbook…** in the sidebar.
2. Select `Master_Data_Template.xlsx`.
3. The parser reads all four sheets automatically:
   - **Stop** — stop codes, names, lat/lng, charging flags, terminus info
   - **Route** — route codes, names, depot
   - **Pattern** — pattern codes, direction, parent route
   - **Route-Pattern** — stop sequences, travel times, distances
4. Any validation warnings appear in the sidebar.
5. The simulation resets to the new network.

Column names are normalised (case/whitespace insensitive) so minor spreadsheet edits don't break ingestion.

---

## Scenario Presets

| ID | Label | Headway | Dwell | Speed | Traffic σ |
|----|-------|---------|-------|-------|-----------|
| `baseline` | Baseline Plan | 20 min | 30 s | 1.0× | ±5% |
| `peakTraffic` | Peak Traffic | 20 min | 45 s | 0.75× | ±25% |
| `highFrequency` | High Frequency Proposal | 10 min | 30 s | 1.0× | ±5% |
| `fastDwell` | Faster Boarding | 20 min | 15 s | 1.0× | ±5% |

Use the sliders in **Tune Scenario** to test any combination live. Changes immediately restart the simulation.

---

## KPIs Explained

| Metric | Definition |
|--------|------------|
| **On-time** | % of stop arrivals within ±120 s of schedule |
| **Avg delay** | Mean signed delay across all stop events (s) |
| **p90 delay** | 90th-percentile signed delay (s) |
| **Early %** | Arrivals >120 s ahead of schedule |
| **Late %** | Arrivals >120 s behind schedule |
| **Headway σ** | Std-dev of observed inter-bus gaps at each stop (min) |
| **Bunching** | Count of back-to-back arrivals within 25% of headway |
| **Active buses** | Buses currently in service |

---

## Tech Stack

| Layer | Library |
|-------|---------|
| UI framework | React 18 + TypeScript |
| Build tool | Vite 5 |
| State | Zustand |
| Map | MapLibre GL JS |
| 3D layers | deck.gl 9 |
| Excel parser | SheetJS (xlsx) |
| Geo utilities | @turf/turf |

---

## Future Extensions

- **AVL/GPS integration** — replace simulated positions with live GTFS-RT feed
- **GTFS import** — parser already structured for additional format adapters
- **PostgreSQL/PostGIS backend** — store historical runs and compare scenarios
- **Passenger demand model** — link stop boardings to KPI weights
- **3D buildings** — swap OSM raster tiles for a vector + extrusion layer
- **Isochrone analysis** — service-area mapping per stop
