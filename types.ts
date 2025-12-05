export enum ControlMode {
  FIXED = 'FIXED',
  SMART = 'SMART' // Max Pressure
}

export interface SimulationConfig {
  gridRows: number;
  gridCols: number;
  inflowRate: number;
  durationSteps: number;
  timeStepS: number;
  controlMode: ControlMode;
}

export interface SimulationStats {
  step: number;
  totalCars: number;
  stoppedCars: number;
  throughput: number;
}

export interface ComparisonStats {
  step: number;
  fixedTotalCars: number;
  smartTotalCars: number;
  fixedStopped: number;
  smartStopped: number;
  fixedThroughput: number;
  smartThroughput: number;
}

export interface RoadData {
  id: string;
  u: string; // start node id
  v: string; // end node id
  cells: number[];
  totalCars: number;
  stoppedQueue: number;
  isBoundary: boolean;
}

export interface IntersectionData {
  id: string;
  phase: number; // 0 = NS Green, 1 = EW Green
  row: number;
  col: number;
}

export interface SimulationSnapshot {
  roads: RoadData[];
  intersections: IntersectionData[];
  stats: SimulationStats;
}