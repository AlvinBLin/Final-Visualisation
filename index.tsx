import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Play, Pause, RotateCcw, Zap, Clock, ArrowRight, Grid3X3 } from 'lucide-react';

// ==========================================
// 1. TYPES & ENUMS
// ==========================================

enum ControlMode {
  FIXED = 'FIXED',
  SMART = 'SMART' // Max Pressure
}

interface SimulationStats {
  step: number;
  totalCars: number;
  stoppedCars: number;
  throughput: number;
}

interface ComparisonStats {
  step: number;
  fixedTotalCars: number;
  smartTotalCars: number;
  fixedStopped: number;
  smartStopped: number;
  fixedThroughput: number;
  smartThroughput: number;
}

interface RoadData {
  id: string;
  u: string; // start node id
  v: string; // end node id
  cells: number[];
  totalCars: number;
  stoppedQueue: number;
  isBoundary: boolean;
}

interface IntersectionData {
  id: string;
  phase: number; // 0 = NS Green, 1 = EW Green
  row: number;
  col: number;
}

interface SimulationSnapshot {
  roads: RoadData[];
  intersections: IntersectionData[];
  stats: SimulationStats;
}

// ==========================================
// 2. CONSTANTS
// ==========================================

const PHYSICS = {
  CELL_LENGTH_M: 50,
  ROAD_LENGTH_CELLS: 10,
  MAX_CARS_PER_CELL: 7.0,
  WAVE_SPEED: 1.0,
  MIN_GREEN_STEPS: 3,
  MAX_RED_STEPS: 24,
  FIXED_CYCLE_STEPS: 6,
};

const COLORS = {
  NS_GREEN: '#4ade80', // Green 400
  EW_GREEN: '#facc15', // Yellow 400
  RED: '#ef4444',      // Red 500
  ROAD_EMPTY: '#334155', // Slate 700
  ROAD_JAMMED: '#dc2626', // Red 600
};

// ==========================================
// 3. LOGIC (Simulation Engine)
// ==========================================

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
    return this.cells.filter(c => c > 2.0).reduce((a, b) => a + b, 0);
  }

  stepPhysics(flowIn: number, flowOut: number) {
    this.cells[this.cells.length - 1] = Math.max(0, this.cells[this.cells.length - 1] - flowOut);
    this.cells[0] += flowIn;

    const newCells = [...this.cells];
    for (let i = this.cells.length - 2; i >= 0; i--) {
      const flux = Math.min(this.cells[i], PHYSICS.MAX_CARS_PER_CELL - this.cells[i + 1]);
      newCells[i] -= flux;
      newCells[i + 1] += flux;
    }
    this.cells = newCells;
  }
}

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

    if (this.inRoads['N']) {
      p_ns += this.inRoads['N'].getStoppedQueue();
      if (this.outRoads['S']) p_ns -= this.outRoads['S'].getTotalCars() * 0.5;
    }
    if (this.inRoads['S']) {
      p_ns += this.inRoads['S'].getStoppedQueue();
      if (this.outRoads['N']) p_ns -= this.outRoads['N'].getTotalCars() * 0.5;
    }

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
      const targetMap: Record<string, string> = { 'N': 'S', 'S': 'N', 'E': 'W', 'W': 'E' };
      const tDir = targetMap[sDir];
      const demand = source.getDemand();

      if (!this.outRoads[tDir]) {
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

class SimulationEngine {
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
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const nid = `${r}-${c}`;
        this.intersections[nid] = new Intersection(nid, r, c);
      }
    }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const u = this.intersections[`${r}-${c}`];
        if (c < this.cols - 1) {
          const v = this.intersections[`${r}-${c + 1}`];
          const isBoundE = (c === 0);
          const r1 = new DirectedRoad(`R_E_${r}_${c}`, u.id, v.id, isBoundE);
          const isBoundW = (c + 1 === this.cols - 1);
          const r2 = new DirectedRoad(`R_W_${r}_${c}`, v.id, u.id, isBoundW);
          u.outRoads['E'] = r1; v.inRoads['W'] = r1;
          v.outRoads['W'] = r2; u.inRoads['E'] = r2;
          this.roads.push(r1, r2);
        }
        if (r < this.rows - 1) {
          const v = this.intersections[`${r + 1}-${c}`];
          const isBoundS = (r === 0);
          const r1 = new DirectedRoad(`R_S_${r}_${c}`, u.id, v.id, isBoundS);
          const isBoundN = (r + 1 === this.rows - 1);
          const r2 = new DirectedRoad(`R_N_${r}_${c}`, v.id, u.id, isBoundN);
          u.outRoads['S'] = r1; v.inRoads['N'] = r1;
          v.outRoads['N'] = r2; u.inRoads['S'] = r2;
          this.roads.push(r1, r2);
        }
      }
    }
  }

  public step() {
    this.stepCount++;
    for (const node of Object.values(this.intersections)) {
      node.phaseTimer += 1;
      if (this.mode === ControlMode.FIXED) {
        if (node.phaseTimer >= PHYSICS.FIXED_CYCLE_STEPS) {
          node.phase = 1 - node.phase;
          node.phaseTimer = 0;
        }
      } else {
        if (node.phaseTimer >= PHYSICS.MAX_RED_STEPS) {
          node.phase = 1 - node.phase;
          node.phaseTimer = 0;
        } else if (node.phaseTimer >= PHYSICS.MIN_GREEN_STEPS) {
          const [p_ns, p_ew] = node.getPressure();
          if (node.phase === 0 && p_ew > p_ns) {
            node.phase = 1; node.phaseTimer = 0;
          } else if (node.phase === 1 && p_ns > p_ew) {
            node.phase = 0; node.phaseTimer = 0;
          }
        }
      }
    }

    const transfers: { src: DirectedRoad; tgt: DirectedRoad | 'EXIT'; amount: number }[] = [];
    for (const node of Object.values(this.intersections)) transfers.push(...node.stepFlow());

    const inflows: Record<string, number> = {};
    const outflows: Record<string, number> = {};
    this.roads.forEach(r => { inflows[r.id] = 0; outflows[r.id] = 0; });

    for (const { src, tgt, amount } of transfers) {
      outflows[src.id] += amount;
      if (tgt === 'EXIT') this.totalThroughput += amount;
      else inflows[tgt.id] += amount;
    }

    for (const r of this.roads) r.stepPhysics(inflows[r.id], outflows[r.id]);

    for (const r of this.roads) {
      const uNode = this.intersections[r.u];
      if (!uNode) continue;
      let isEntry = false;
      if (r.id.includes("R_E") && !uNode.inRoads['W']) isEntry = true;
      if (r.id.includes("R_W") && !uNode.inRoads['E']) isEntry = true;
      if (r.id.includes("R_S") && !uNode.inRoads['N']) isEntry = true;
      if (r.id.includes("R_N") && !uNode.inRoads['S']) isEntry = true;

      if (isEntry && r.cells[0] < 2.0 && Math.random() < this.inflowRate) {
        r.cells[0] += 2.0;
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
      cells: [...r.cells],
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
      stats: { step: this.stepCount, totalCars, stoppedCars, throughput: this.totalThroughput }
    };
  }
}

// ==========================================
// 4. COMPONENTS
// ==========================================

// --- TrafficGrid Component ---
interface TrafficGridProps {
  snapshot: SimulationSnapshot;
  rows: number;
  cols: number;
}

const TrafficGrid: React.FC<TrafficGridProps> = ({ snapshot, rows, cols }) => {
  const getVisualConfig = (n: number) => {
    if (n > 14) return { cellSize: 22, radius: 4, road: 4, padding: 15 };
    if (n > 8) return { cellSize: 30, radius: 6, road: 5, padding: 20 };
    return { cellSize: 45, radius: 8, road: 6, padding: 25 };
  };

  const { cellSize: CELL_SIZE, radius: NODE_RADIUS, road: ROAD_WIDTH, padding: PADDING } = getVisualConfig(cols);
  const width = cols * CELL_SIZE + PADDING * 2;
  const height = rows * CELL_SIZE + PADDING * 2;

  const getCoords = (row: number, col: number) => ({
    x: col * CELL_SIZE + PADDING,
    y: row * CELL_SIZE + PADDING
  });

  const getRoadColor = (road: RoadData) => {
    const density = road.stoppedQueue / (PHYSICS.ROAD_LENGTH_CELLS * PHYSICS.MAX_CARS_PER_CELL);
    if (density > 0.4) return COLORS.ROAD_JAMMED;
    if (density > 0.1) return '#eab308';
    return COLORS.ROAD_EMPTY;
  };

  const drawRoad = (road: RoadData) => {
    const [uRow, uCol] = road.u.split('-').map(Number);
    const [vRow, vCol] = road.v.split('-').map(Number);
    const start = getCoords(uRow, uCol);
    const end = getCoords(vRow, vCol);
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const offset = ROAD_WIDTH * 0.7;
    
    const x1 = start.x + offset * Math.cos(angle + Math.PI / 2);
    const y1 = start.y + offset * Math.sin(angle + Math.PI / 2);
    const x2 = end.x + offset * Math.cos(angle + Math.PI / 2);
    const y2 = end.y + offset * Math.sin(angle + Math.PI / 2);

    return (
      <line
        key={road.id}
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={getRoadColor(road)}
        strokeWidth={ROAD_WIDTH}
        strokeLinecap="round"
        opacity={0.8}
      />
    );
  };

  const drawIntersection = (intersection: IntersectionData) => {
    const { x, y } = getCoords(intersection.row, intersection.col);
    const isNS = intersection.phase === 0;
    const color = isNS ? COLORS.NS_GREEN : COLORS.EW_GREEN;
    const w = NODE_RADIUS * 0.6;
    const h = NODE_RADIUS * 1.8;

    return (
      <g key={intersection.id} transform={`translate(${x}, ${y})`}>
        <circle r={NODE_RADIUS} fill="#1e293b" stroke="#475569" strokeWidth="1.5" />
        {isNS ? <rect x={-w/2} y={-h/2} width={w} height={h} fill={color} rx={1} /> 
              : <rect x={-h/2} y={-w/2} width={h} height={w} fill={color} rx={1} />}
      </g>
    );
  };

  return (
    <div className="overflow-hidden flex justify-center items-center bg-slate-950 rounded-xl transition-all duration-300">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{maxWidth: '100%', maxHeight: '500px', height: 'auto'}}>
         {snapshot.roads.map(drawRoad)}
         {snapshot.intersections.map(drawIntersection)}
      </svg>
    </div>
  );
};

// --- Charts Component ---
const Charts: React.FC<{ data: ComparisonStats[] }> = ({ data }) => {
  const chartData = data.slice(-200);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 h-64">
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg flex flex-col">
        <h3 className="text-slate-200 text-sm font-semibold mb-2">Global Density (Total Cars)</h3>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="step" hide />
              <YAxis stroke="#94a3b8" fontSize={10} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f1f5f9' }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ display: 'none' }} />
              <Legend verticalAlign="top" height={36} iconType="circle" />
              <Line name="Fixed Time" type="monotone" dataKey="fixedTotalCars" stroke="#ef4444" strokeWidth={2} dot={false} animationDuration={0} isAnimationActive={false} />
              <Line name="Smart Agent" type="monotone" dataKey="smartTotalCars" stroke="#3b82f6" strokeWidth={2} dot={false} animationDuration={0} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg flex flex-col">
        <h3 className="text-slate-200 text-sm font-semibold mb-2">Throughput (Cars Exited)</h3>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="step" hide />
              <YAxis stroke="#94a3b8" fontSize={10} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f1f5f9' }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ display: 'none' }} />
              <Legend verticalAlign="top" height={36} iconType="circle" />
              <Line name="Fixed Time" type="monotone" dataKey="fixedThroughput" stroke="#ef4444" strokeWidth={2} dot={false} animationDuration={0} isAnimationActive={false} />
              <Line name="Smart Agent" type="monotone" dataKey="smartThroughput" stroke="#3b82f6" strokeWidth={2} dot={false} animationDuration={0} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg flex flex-col">
        <h3 className="text-slate-200 text-sm font-semibold mb-2">Stopped Queue (Wait Time)</h3>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="step" hide />
              <YAxis stroke="#94a3b8" fontSize={10} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f1f5f9' }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ display: 'none' }} />
              <Legend verticalAlign="top" height={36} iconType="circle" />
              <Line name="Fixed Time" type="monotone" dataKey="fixedStopped" stroke="#ef4444" strokeWidth={2} dot={false} animationDuration={0} isAnimationActive={false} />
              <Line name="Smart Agent" type="monotone" dataKey="smartStopped" stroke="#3b82f6" strokeWidth={2} dot={false} animationDuration={0} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// --- Main App Component ---
const INFLOW = 0.35;
const SIMULATION_FPS = 4;

const App: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [gridSize, setGridSize] = useState<number>(6);
  const [history, setHistory] = useState<ComparisonStats[]>([]);
  const [fixedSnapshot, setFixedSnapshot] = useState<SimulationSnapshot | null>(null);
  const [smartSnapshot, setSmartSnapshot] = useState<SimulationSnapshot | null>(null);
  
  const fixedEngineRef = useRef<SimulationEngine | null>(null);
  const smartEngineRef = useRef<SimulationEngine | null>(null);
  const animationRef = useRef<number>(0);
  const lastTickTime = useRef<number>(0);
  
  const initSimulation = useCallback(() => {
    const fixedEngine = new SimulationEngine(gridSize, gridSize, INFLOW, ControlMode.FIXED);
    fixedEngineRef.current = fixedEngine;
    setFixedSnapshot(fixedEngine.getSnapshot());

    const smartEngine = new SimulationEngine(gridSize, gridSize, INFLOW, ControlMode.SMART);
    smartEngineRef.current = smartEngine;
    setSmartSnapshot(smartEngine.getSnapshot());

    setHistory([]);
  }, [gridSize]);

  useEffect(() => {
    initSimulation();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      lastTickTime.current = 0;
    };
  }, [initSimulation]);

  const tick = useCallback((timestamp: number) => {
    if (!lastTickTime.current) lastTickTime.current = timestamp;
    const elapsed = timestamp - lastTickTime.current;
    
    if (elapsed > 1000 / SIMULATION_FPS) {
      if (fixedEngineRef.current && smartEngineRef.current) {
        fixedEngineRef.current.step();
        smartEngineRef.current.step();
        
        const fSnap = fixedEngineRef.current.getSnapshot();
        const sSnap = smartEngineRef.current.getSnapshot();
        
        setFixedSnapshot(fSnap);
        setSmartSnapshot(sSnap);

        setHistory(prev => {
          const newItem: ComparisonStats = {
            step: fSnap.stats.step,
            fixedTotalCars: fSnap.stats.totalCars,
            smartTotalCars: sSnap.stats.totalCars,
            fixedStopped: fSnap.stats.stoppedCars,
            smartStopped: sSnap.stats.stoppedCars,
            fixedThroughput: fSnap.stats.throughput,
            smartThroughput: sSnap.stats.throughput
          };
          const newHistory = [...prev, newItem];
          if (newHistory.length > 200) return newHistory.slice(1);
          return newHistory;
        });
      }
      lastTickTime.current = timestamp;
    }
    
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(tick);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying) {
      lastTickTime.current = 0;
      animationRef.current = requestAnimationFrame(tick);
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, tick]);

  const handleReset = () => {
    setIsPlaying(false);
    initSimulation();
  };

  const handleGridSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setIsPlaying(false);
    setGridSize(Number(e.target.value));
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col overflow-hidden">
      <header className="bg-slate-950 border-b border-slate-800 p-3 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-3">
          <div>
            <h1 className="text-lg md:text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              Adaptive Traffic Control
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-slate-800 p-1.5 rounded-lg border border-slate-700">
                <Grid3X3 size={16} className="text-slate-400 ml-1" />
                <span className="text-xs text-slate-400 font-bold px-1 hidden sm:inline">SIZE</span>
                <select value={gridSize} onChange={handleGridSizeChange} className="bg-slate-900 text-white text-sm rounded px-2 py-1 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono">
                  {[2, 4, 6, 8, 10, 12, 14, 16, 18, 20].map(n => (
                    <option key={n} value={n}>{n} × {n}</option>
                  ))}
                </select>
              </div>

              <div className="h-6 w-px bg-slate-800 hidden md:block"></div>

              <div className="flex gap-2">
                <button 
                  onClick={() => setIsPlaying(!isPlaying)}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-lg font-bold transition-colors shadow-lg text-sm ${
                    isPlaying 
                      ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-900/20' 
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-900/20'
                  }`}
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                  {isPlaying ? "PAUSE" : "START"}
                </button>
                <button onClick={handleReset} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700" title="Reset">
                  <RotateCcw size={16} />
                </button>
              </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto p-4 w-full flex flex-col gap-4 overflow-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <div className="flex flex-col gap-2">
             <div className="flex items-center justify-between bg-slate-950/50 p-2 rounded-t-xl border-b border-red-500/30">
                <div className="flex items-center gap-2 text-red-400">
                   <Clock size={16} />
                   <h2 className="font-bold text-sm">Fixed Time</h2>
                </div>
                <div className="text-[10px] text-slate-500 uppercase">Benchmark</div>
             </div>
             <div className="bg-slate-950 p-2 rounded-b-xl border border-slate-800 shadow-xl flex justify-center items-center min-h-[300px]">
                {fixedSnapshot ? <TrafficGrid snapshot={fixedSnapshot} rows={gridSize} cols={gridSize} /> : <div className="text-slate-600">Initializing...</div>}
             </div>
             <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-800 p-2 rounded-lg border border-slate-700">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider">Queue</div>
                  <div className="text-xl font-mono font-bold text-red-400">{fixedSnapshot?.stats.stoppedCars.toFixed(0) || 0}</div>
                </div>
                <div className="bg-slate-800 p-2 rounded-lg border border-slate-700">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider">Throughput</div>
                  <div className="text-xl font-mono font-bold text-slate-200">{fixedSnapshot?.stats.throughput.toFixed(0) || 0}</div>
                </div>
             </div>
          </div>

          <div className="flex flex-col gap-2">
             <div className="flex items-center justify-between bg-slate-950/50 p-2 rounded-t-xl border-b border-blue-500/30">
                <div className="flex items-center gap-2 text-blue-400">
                   <Zap size={16} />
                   <h2 className="font-bold text-sm">Smart Agent</h2>
                </div>
                <div className="text-[10px] text-slate-500 uppercase">Adaptive</div>
             </div>
             <div className="bg-slate-950 p-2 rounded-b-xl border border-slate-800 shadow-xl flex justify-center items-center min-h-[300px]">
                {smartSnapshot ? <TrafficGrid snapshot={smartSnapshot} rows={gridSize} cols={gridSize} /> : <div className="text-slate-600">Initializing...</div>}
             </div>
             <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-800 p-2 rounded-lg border border-slate-700">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider">Queue</div>
                  <div className="text-xl font-mono font-bold text-blue-400">{smartSnapshot?.stats.stoppedCars.toFixed(0) || 0}</div>
                </div>
                <div className="bg-slate-800 p-2 rounded-lg border border-slate-700">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider">Throughput</div>
                  <div className="text-xl font-mono font-bold text-slate-200">{smartSnapshot?.stats.throughput.toFixed(0) || 0}</div>
                </div>
             </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-3 flex flex-col md:flex-row items-center justify-between gap-4 shadow-lg shrink-0">
           <div className="text-xs text-slate-400">
              <span className="text-white font-semibold">Live Analysis:</span> Smart Agent prioritizes congested lanes, preventing "ghost green lights".
           </div>
           {history.length > 0 && (
              <div className="flex items-center gap-4 bg-slate-950/50 px-3 py-1.5 rounded-lg border border-slate-800 whitespace-nowrap">
                 <div className="text-[10px] text-slate-400 uppercase">Wait Reduction</div>
                 <div className="text-lg font-bold text-emerald-400 flex items-center gap-1">
                    <ArrowRight size={14} className="rotate-45" />
                    {(() => {
                        const last = history[history.length - 1];
                        if (!last.fixedStopped) return "0%";
                        const imp = ((last.fixedStopped - last.smartStopped) / last.fixedStopped) * 100;
                        return `${imp.toFixed(1)}%`;
                    })()}
                 </div>
              </div>
           )}
        </div>

        <div className="flex-1 min-h-[200px]">
           <Charts data={history} />
        </div>
      </main>
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);
}
