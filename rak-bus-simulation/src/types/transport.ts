/**
 * Core transport-domain type definitions.
 *
 * These mirror the columns of the Master_Data_Template.xlsx schema so that
 * any spreadsheet conforming to that template can be ingested without
 * additional adapters.
 */

export type Direction = 'Up' | 'Down';

export interface Stop {
  stopCode: string;
  stopName: string;
  latitude: number;
  longitude: number;
  chargingPointFlag: boolean;
  publicHeading?: string;
  terminusCode?: string;
  terminusName?: string;
}

export interface Route {
  routeCode: string;
  routeName: string;
  depot: string;
  /** Hex color assigned to the route for map rendering. */
  color: string;
}

export interface Pattern {
  depot: string;
  patternCode: string;
  patternName: string;
  /** route_code this pattern belongs to. */
  route: string;
  direction: Direction;
}

export interface RoutePatternStop {
  route: string;
  direction: Direction;
  stopName: string;
  stopCode: string;
  sequence: number;
  /** Distance from previous stop in meters. */
  distance?: number;
  pathPattern?: string;
  depot?: string;
  /** Travel time from previous stop in seconds. */
  travelTime?: number;
}

/**
 * Fully resolved transport network derived from the four sheets.
 * Maps provide O(1) lookups; ordered patternStops backs route geometry.
 */
export interface TransportNetwork {
  stops: Map<string, Stop>;
  routes: Map<string, Route>;
  patterns: Map<string, Pattern>;
  routePatternStops: RoutePatternStop[];
  /** patternCode -> ordered RoutePatternStop[] */
  patternStops: Map<string, RoutePatternStop[]>;
  /** patternCode -> [lng, lat][] resolved against the Stop table. */
  patternGeometry: Map<string, [number, number][]>;
}

export type BusStatus = 'in-transit' | 'at-stop' | 'idle' | 'completed';

export interface Bus {
  id: string;
  routeCode: string;
  patternCode: string;
  tripId: string;
  /** Current world position [lng, lat]. */
  position: [number, number];
  /** Cumulative bearing for icon orientation in degrees. */
  bearing: number;
  /** Index of segment (0..stops.length-2) currently being traversed. */
  segmentIndex: number;
  /** 0..1 progress along the current segment. */
  segmentProgress: number;
  status: BusStatus;
  currentStopCode?: string;
  /** Scheduled departure of this trip from the first stop (sim seconds). */
  scheduledStart: number;
  /** Actual departure of this trip (sim seconds). */
  actualStart: number;
  /** Running delay vs. schedule (seconds, positive = late). */
  delaySec: number;
  /** Color inherited from route. */
  color: string;
}

export interface ScheduledStopEvent {
  stopCode: string;
  /** Scheduled arrival in sim seconds. */
  scheduledArrival: number;
  /** Scheduled departure in sim seconds (arrival + dwell). */
  scheduledDeparture: number;
}

export interface Trip {
  id: string;
  routeCode: string;
  patternCode: string;
  scheduledStart: number;
  stops: ScheduledStopEvent[];
}

export interface ActualStopEvent {
  tripId: string;
  routeCode: string;
  patternCode: string;
  stopCode: string;
  scheduledArrival: number;
  actualArrival: number;
  delaySec: number;
  simTime: number;
}
