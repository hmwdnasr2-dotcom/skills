/**
 * 3D map view.
 *
 * MapLibre GL JS handles the base tiles / pitch / camera; deck.gl is
 * layered on top via MapboxOverlay (which works with MapLibre, since
 * MapLibre is API-compatible with Mapbox v1). All bus / route layers
 * live in deck.gl so they can be rebuilt every frame without re-issuing
 * tile requests.
 */

import { useEffect, useMemo, useRef } from 'react';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useStore } from '../state/store';
import { buildLayers } from './layers';
import { networkCentroid } from '../data/networkBuilder';

// A standalone basemap style that loads tiles from OSM. No API key needed.
const BASEMAP_STYLE = {
  version: 8 as const,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster' as const,
      source: 'osm',
    },
  ],
};

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  const network = useStore(s => s.network);
  const buses = useStore(s => s.sim.buses);
  const selectedRoute = useStore(s => s.selectedRoute);
  const selectedPattern = useStore(s => s.selectedPattern);
  const activePatterns = useStore(s => s.scenario.activePatterns);

  const initialCenter = useMemo(() => networkCentroid(network), [network]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE as never,
      center: initialCenter,
      zoom: 10,
      pitch: 50,
      bearing: -10,
      antialias: true,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    const overlay = new MapboxOverlay({ layers: [] });
    map.on('load', () => {
      map.addControl(overlay as unknown as maplibregl.IControl);
    });

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, [initialCenter]);

  // Re-frame camera when the dataset (network) changes.
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.easeTo({ center: initialCenter, duration: 800 });
  }, [initialCenter]);

  // Rebuild deck.gl layers on every relevant change.
  useEffect(() => {
    if (!overlayRef.current) return;
    const visiblePatterns = selectedRoute
      ? new Set(
          [...network.patternStops.keys()].filter(p => {
            const pat = network.patterns.get(p);
            return pat && pat.route === selectedRoute && activePatterns.has(p);
          }),
        )
      : new Set(activePatterns);

    const layers = buildLayers({
      network,
      buses,
      selectedRoute,
      selectedPattern,
      visiblePatterns,
    });
    overlayRef.current.setProps({ layers });
  }, [network, buses, selectedRoute, selectedPattern, activePatterns]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
}
