import { PHYSICS } from '../constants';
import { ControlMode, SimulationSnapshot, RoadData, IntersectionData, SimulationStats } from '../types';

// Helper class for Road
class DirectedRoad {
  id: string;
  u: string;
  v: string;
  cells: number[];
  isBoundary: boolean;

  constructor(id: string, u: string, v: string, isBoundary = false) {
    this.id = id;
    this.u = u;
    this.v = v;
    this.cells = new Array(PHYSICS.ROAD_LENGTH_CELLS).fill(0);
    this.isBoundary = isBoundary;
  }

  getDemand(): number {
    return Math.min(PHYSICS.WAVE_SPEED * this.cells[this.cells.length - 1], PHYSICS.MAX_CARS_PER_CELL);
  }

  getSupply(): number {
    return Math.max(0.0, PHYSICS.MAX_CARS_PER_CELL - this.cells[0]);
  }

  getTotalCars(): number {
    return this.cells.reduce((a, b) => a + b, 0);
  }

  getStoppedQueue(): number {
    // Cars with density > 2.0 are considered "Waiting"
    return this.cells.filter(c => c > 2.0).reduce((a, b) => a + b, 0);
  }

  stepPhysics(flowIn: number, flowOut: number) {
    // Update boundaries first
    this.cells[this.cells.length - 1] = Math.max(0, this.cells[this.cells.length - 1] - flowOut);
    this.cells[0] += flowIn;

    const newCells = [...this.cells];
    // CTM Flow logic
    for (let i = this.cells.length - 2; i >= 0; i--) {
      const flux = Math.min(this.cells[i], PHYSICS.MAX_CARS_PER_CELL - this.cells[i + 1]);
      newCells[i] -= flux;
      newCells[i + 1] += flux;
    }
    this.cells = newCells;
  }
}

// Helper class for Intersection
class Intersection {
  id: string;
  row: number;
  col: number;
  inRoads: Record<string, DirectedRoad> = {};
  outRoads: Record<string, DirectedRoad> = {};
  phase: number = 0; // 0 = NS, 1 = EW
  phaseTimer: number = 0;

  constructor(id: string, row: number, col: number) {
    this.id = id;
    this.row = row;
    this.col = col;
  }

  getPressure(): [number, number] {
    let p_ns = 0;
    let p_ew = 0;

    // Calculate Pressure = Incoming_Stopped - Outgoing_Total * Weight(0.5)
    // NS Phase Pressure
    if (this.inRoads['N']) {
      p_ns += this.inRoads['N'].getStoppedQueue();
      if (this.outRoads['S']) p_ns -= this.outRoads['S'].getTotalCars() * 0.5;
    }
    if (this.inRoads['S']) {
      p_ns += this.inRoads['S'].getStoppedQueue();
      if (this.outRoads['N']) p_ns -= this.outRoads['N'].getTotalCars() * 0.5;
    }

    // EW Phase Pressure
    if (this.inRoads['E']) {
      p_ew += this.inRoads['E'].getStoppedQueue();
      if (this.outRoads['W']) p_ew -= this.outRoads['W'].getTotalCars() * 0.5;
    }
    if (this.inRoads['W']) {
      p_ew += this.inRoads['W'].getStoppedQueue();
      if (this.outRoads['E']) p_ew -= this.outRoads['E'].getTotalCars() * 0.5;
    }

    return [Math.max(0.1, p_ns), Math.max(0.1, p_ew)];
  }

  stepFlow(): { src: DirectedRoad; tgt: DirectedRoad | 'EXIT'; amount: number }[] {
    const transfers: { src: DirectedRoad; tgt: DirectedRoad | 'EXIT'; amount: number }[] = [];
    const allowedDirs = this.phase === 0 ? ['N', 'S'] : ['E', 'W'];

    for (const sDir of allowedDirs) {
      if (!this.inRoads[sDir]) continue;

      const source = this.inRoads[sDir];
      // Mapping: Coming from North means heading South
      const targetMap: Record<string, string> = { 'N': 'S', 'S': 'N', 'E': 'W', 'W': 'E' };
      const tDir = targetMap[sDir];
      const demand = source.getDemand();

      if (!this.outRoads[tDir]) {
        // Exit boundary
        transfers.push({ src: source, tgt: 'EXIT', amount: demand });
      } else {
        const target = this.outRoads[tDir];
        const supply = target.getSupply();
        const flow = Math.min(demand, supply);
        if (flow > 0) {
          transfers.push({ src: source, tgt: target, amount: flow });
        }
      }
    }
    return transfers;
  }
}

// Main Engine
export class SimulationEngine {
  roads: DirectedRoad[] = [];
  intersections: Record<string, Intersection> = {};
  totalThroughput: number = 0;
  stepCount: number = 0;
  mode: ControlMode;
  rows: number;
  cols: number;
  inflowRate: number;

  constructor(rows: number, cols: number, inflowRate: number, mode: ControlMode) {
    this.rows = rows;
    this.cols = cols;
    this.inflowRate = inflowRate;
    this.mode = mode;
    this.buildGrid();
  }

  private buildGrid() {
    // Create Intersections
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const nid = `${r}-${c}`;
        this.intersections[nid] = new Intersection(nid, r, c);
      }
    }

    // Connect Roads
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const u = this.intersections[`${r}-${c}`];

        // Horizontal Connections (East-West)
        if (c < this.cols - 1) {
          const v = this.intersections[`${r}-${c + 1}`];
          const isBoundE = (c === 0);
          const r1 = new DirectedRoad(`R_E_${r}_${c}`, u.id, v.id, isBoundE);
          
          const isBoundW = (c + 1 === this.cols - 1);
          const r2 = new DirectedRoad(`R_W_${r}_${c}`, v.id, u.id, isBoundW);

          u.outRoads['E'] = r1; 
          v.inRoads['W'] = r1;

          v.outRoads['W'] = r2; 
          u.inRoads['E'] = r2;

          this.roads.push(r1, r2);
        }

        // Vertical Connections (North-South)
        if (r < this.rows - 1) {
          const v = this.intersections[`${r + 1}-${c}`];
          const isBoundS = (r === 0);
          const r1 = new DirectedRoad(`R_S_${r}_${c}`, u.id, v.id, isBoundS);

          const isBoundN = (r + 1 === this.rows - 1);
          const r2 = new DirectedRoad(`R_N_${r}_${c}`, v.id, u.id, isBoundN);

          u.outRoads['S'] = r1; 
          v.inRoads['N'] = r1;

          v.outRoads['N'] = r2; 
          u.inRoads['S'] = r2;

          this.roads.push(r1, r2);
        }
      }
    }
  }

  public step() {
    this.stepCount++;

    // 1. Update Signals
    for (const node of Object.values(this.intersections)) {
      node.phaseTimer += 1;

      if (this.mode === ControlMode.FIXED) {
        if (node.phaseTimer >= PHYSICS.FIXED_CYCLE_STEPS) {
          node.phase = 1 - node.phase;
          node.phaseTimer = 0;
        }
      } else {
        // SMART (Max Pressure)
        if (node.phaseTimer >= PHYSICS.MAX_RED_STEPS) {
          // Force switch if waiting too long
          node.phase = 1 - node.phase;
          node.phaseTimer = 0;
        } else if (node.phaseTimer >= PHYSICS.MIN_GREEN_STEPS) {
          const [p_ns, p_ew] = node.getPressure();
          // Switch to the phase with higher pressure
          // Phase 0 is NS. If EW pressure is higher, switch to 1.
          if (node.phase === 0 && p_ew > p_ns) {
            node.phase = 1;
            node.phaseTimer = 0;
          } else if (node.phase === 1 && p_ns > p_ew) {
            node.phase = 0;
            node.phaseTimer = 0;
          }
        }
      }
    }

    // 2. Calculate Flows
    const transfers: { src: DirectedRoad; tgt: DirectedRoad | 'EXIT'; amount: number }[] = [];
    for (const node of Object.values(this.intersections)) {
      transfers.push(...node.stepFlow());
    }

    const inflows: Record<string, number> = {};
    const outflows: Record<string, number> = {};
    this.roads.forEach(r => { inflows[r.id] = 0; outflows[r.id] = 0; });

    for (const { src, tgt, amount } of transfers) {
      outflows[src.id] += amount;
      if (tgt === 'EXIT') {
        this.totalThroughput += amount;
      } else {
        inflows[tgt.id] += amount;
      }
    }

    // 3. Step Physics
    for (const r of this.roads) {
      r.stepPhysics(inflows[r.id], outflows[r.id]);
    }

    // 4. Inflow Generation
    for (const r of this.roads) {
      // Logic: If it's a boundary road or empty enough, try to spawn cars
      const uNode = this.intersections[r.u];
      if (!uNode) continue; // Safety check
      
      let isEntry = false;
      if (r.id.includes("R_E") && !uNode.inRoads['W']) isEntry = true;
      if (r.id.includes("R_W") && !uNode.inRoads['E']) isEntry = true;
      if (r.id.includes("R_S") && !uNode.inRoads['N']) isEntry = true;
      if (r.id.includes("R_N") && !uNode.inRoads['S']) isEntry = true;

      if (isEntry && r.cells[0] < 2.0) { // Check space at start
        if (Math.random() < this.inflowRate) {
          r.cells[0] += 2.0; // Spawn a "car block"
        }
      }
    }
  }

  public getSnapshot(): SimulationSnapshot {
    const totalCars = this.roads.reduce((sum, r) => sum + r.getTotalCars(), 0);
    const stoppedCars = this.roads.reduce((sum, r) => sum + r.getStoppedQueue(), 0);

    const roadSnapshots: RoadData[] = this.roads.map(r => ({
      id: r.id,
      u: r.u,
      v: r.v,
      cells: [...r.cells], // Shallow copy
      totalCars: r.getTotalCars(),
      stoppedQueue: r.getStoppedQueue(),
      isBoundary: r.isBoundary
    }));

    const intersectionSnapshots: IntersectionData[] = Object.values(this.intersections).map(i => ({
      id: i.id,
      phase: i.phase,
      row: i.row,
      col: i.col
    }));

    return {
      roads: roadSnapshots,
      intersections: intersectionSnapshots,
      stats: {
        step: this.stepCount,
        totalCars,
        stoppedCars,
        throughput: this.totalThroughput
      }
    };
  }
}