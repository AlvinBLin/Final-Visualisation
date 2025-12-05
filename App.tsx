import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, RotateCcw, Zap, Clock, ArrowRight, Grid3X3 } from 'lucide-react';
import { SimulationEngine } from './services/SimulationEngine';
import TrafficGrid from './components/TrafficGrid';
import Charts from './components/Charts';
import { ControlMode, ComparisonStats, SimulationSnapshot } from './types';

// Constants
const INFLOW = 0.35;
const SIMULATION_FPS = 4;

const App: React.FC = () => {
  // State
  const [isPlaying, setIsPlaying] = useState(false);
  const [gridSize, setGridSize] = useState<number>(6); // Default to 6x6
  const [history, setHistory] = useState<ComparisonStats[]>([]);
  
  // Dual Snapshots
  const [fixedSnapshot, setFixedSnapshot] = useState<SimulationSnapshot | null>(null);
  const [smartSnapshot, setSmartSnapshot] = useState<SimulationSnapshot | null>(null);
  
  // Refs for Engines
  const fixedEngineRef = useRef<SimulationEngine | null>(null);
  const smartEngineRef = useRef<SimulationEngine | null>(null);
  const animationRef = useRef<number>(0);
  const lastTickTime = useRef<number>(0);
  
  // Initialize Simulation
  const initSimulation = useCallback(() => {
    // 1. Fixed Engine
    const fixedEngine = new SimulationEngine(gridSize, gridSize, INFLOW, ControlMode.FIXED);
    fixedEngineRef.current = fixedEngine;
    setFixedSnapshot(fixedEngine.getSnapshot());

    // 2. Smart Engine
    const smartEngine = new SimulationEngine(gridSize, gridSize, INFLOW, ControlMode.SMART);
    smartEngineRef.current = smartEngine;
    setSmartSnapshot(smartEngine.getSnapshot());

    setHistory([]);
  }, [gridSize]); // Re-run when gridSize changes

  useEffect(() => {
    initSimulation();
    // Cleanup on unmount or re-init
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      lastTickTime.current = 0;
    };
  }, [initSimulation]);

  // Animation Loop
  const tick = useCallback((timestamp: number) => {
    if (!lastTickTime.current) lastTickTime.current = timestamp;
    const elapsed = timestamp - lastTickTime.current;
    
    // Throttle: Only update if enough time has passed based on target FPS
    if (elapsed > 1000 / SIMULATION_FPS) {
      if (fixedEngineRef.current && smartEngineRef.current) {
        // Step both
        fixedEngineRef.current.step();
        smartEngineRef.current.step();
        
        // Get Snapshots
        const fSnap = fixedEngineRef.current.getSnapshot();
        const sSnap = smartEngineRef.current.getSnapshot();
        
        setFixedSnapshot(fSnap);
        setSmartSnapshot(sSnap);

        // Update History
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
    
    // Schedule next frame only if playing
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(tick);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying) {
      lastTickTime.current = 0; // Reset timer so it starts immediately
      animationRef.current = requestAnimationFrame(tick);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, tick]);

  // Handlers
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
      {/* Header */}
      <header className="bg-slate-950 border-b border-slate-800 p-3 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-3">
          <div>
            <h1 className="text-lg md:text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              Adaptive Traffic Control
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
              {/* Grid Size Selector */}
              <div className="flex items-center gap-2 bg-slate-800 p-1.5 rounded-lg border border-slate-700">
                <Grid3X3 size={16} className="text-slate-400 ml-1" />
                <span className="text-xs text-slate-400 font-bold px-1 hidden sm:inline">SIZE</span>
                <select 
                  value={gridSize}
                  onChange={handleGridSizeChange}
                  className="bg-slate-900 text-white text-sm rounded px-2 py-1 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                >
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
                <button 
                  onClick={handleReset}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700"
                  title="Reset"
                >
                  <RotateCcw size={16} />
                </button>
              </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto p-4 w-full flex flex-col gap-4 overflow-auto">
        
        {/* Comparison Section - Uses md:grid-cols-2 to fit on tablets/small laptops */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          
          {/* LEFT: FIXED TIME */}
          <div className="flex flex-col gap-2">
             <div className="flex items-center justify-between bg-slate-950/50 p-2 rounded-t-xl border-b border-red-500/30">
                <div className="flex items-center gap-2 text-red-400">
                   <Clock size={16} />
                   <h2 className="font-bold text-sm">Fixed Time</h2>
                </div>
                <div className="text-[10px] text-slate-500 uppercase">Benchmark</div>
             </div>
             
             <div className="bg-slate-950 p-2 rounded-b-xl border border-slate-800 shadow-xl flex justify-center items-center min-h-[300px]">
                {fixedSnapshot ? (
                  <TrafficGrid snapshot={fixedSnapshot} rows={gridSize} cols={gridSize} />
                ) : (
                  <div className="flex items-center text-slate-600">Initializing...</div>
                )}
             </div>

             {/* Fixed Metrics */}
             <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-800 p-2 rounded-lg border border-slate-700">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider">Queue</div>
                  <div className="text-xl font-mono font-bold text-red-400">
                    {fixedSnapshot?.stats.stoppedCars.toFixed(0) || 0}
                  </div>
                </div>
                <div className="bg-slate-800 p-2 rounded-lg border border-slate-700">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider">Throughput</div>
                  <div className="text-xl font-mono font-bold text-slate-200">
                     {fixedSnapshot?.stats.throughput.toFixed(0) || 0}
                  </div>
                </div>
             </div>
          </div>

          {/* RIGHT: SMART AGENT */}
          <div className="flex flex-col gap-2">
             <div className="flex items-center justify-between bg-slate-950/50 p-2 rounded-t-xl border-b border-blue-500/30">
                <div className="flex items-center gap-2 text-blue-400">
                   <Zap size={16} />
                   <h2 className="font-bold text-sm">Smart Agent (Max Pressure)</h2>
                </div>
                <div className="text-[10px] text-slate-500 uppercase">Adaptive</div>
             </div>
             
             <div className="bg-slate-950 p-2 rounded-b-xl border border-slate-800 shadow-xl flex justify-center items-center min-h-[300px]">
                {smartSnapshot ? (
                  <TrafficGrid snapshot={smartSnapshot} rows={gridSize} cols={gridSize} />
                ) : (
                  <div className="flex items-center text-slate-600">Initializing...</div>
                )}
             </div>

             {/* Smart Metrics */}
             <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-800 p-2 rounded-lg border border-slate-700">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider">Queue</div>
                  <div className="text-xl font-mono font-bold text-blue-400">
                    {smartSnapshot?.stats.stoppedCars.toFixed(0) || 0}
                  </div>
                </div>
                <div className="bg-slate-800 p-2 rounded-lg border border-slate-700">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider">Throughput</div>
                  <div className="text-xl font-mono font-bold text-slate-200">
                     {smartSnapshot?.stats.throughput.toFixed(0) || 0}
                  </div>
                </div>
             </div>
          </div>

        </div>

        {/* Comparison Summary Bar */}
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

        {/* Charts Section */}
        <div className="flex-1 min-h-[200px]">
           <Charts data={history} />
        </div>

      </main>
    </div>
  );
};

export default App;