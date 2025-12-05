import React from 'react';
import { SimulationSnapshot, IntersectionData, RoadData } from '../types';
import { COLORS, PHYSICS } from '../constants';

interface TrafficGridProps {
  snapshot: SimulationSnapshot;
  rows: number;
  cols: number;
}

const TrafficGrid: React.FC<TrafficGridProps> = ({ snapshot, rows, cols }) => {
  // Dynamic visual constants based on grid density
  const getVisualConfig = (n: number) => {
    if (n > 14) return { cellSize: 22, radius: 4, road: 4, padding: 15 };
    if (n > 8) return { cellSize: 30, radius: 6, road: 5, padding: 20 };
    return { cellSize: 45, radius: 8, road: 6, padding: 25 };
  };

  const { cellSize: CELL_SIZE, radius: NODE_RADIUS, road: ROAD_WIDTH, padding: PADDING } = getVisualConfig(cols);

  const width = cols * CELL_SIZE + PADDING * 2;
  const height = rows * CELL_SIZE + PADDING * 2;

  // Helper to get coordinates
  const getCoords = (row: number, col: number) => ({
    x: col * CELL_SIZE + PADDING,
    y: row * CELL_SIZE + PADDING
  });

  // Calculate road color based on density
  const getRoadColor = (road: RoadData) => {
    // Density ratio: total cars / max capacity (cells * max_per_cell)
    // However, stopped queue is a better visual indicator of "jam"
    const density = road.stoppedQueue / (PHYSICS.ROAD_LENGTH_CELLS * PHYSICS.MAX_CARS_PER_CELL);
    
    // Interpolate between empty and jammed
    // Simple thresholding for performance
    if (density > 0.4) return COLORS.ROAD_JAMMED;
    if (density > 0.1) return '#eab308'; // Yellow-ish
    return COLORS.ROAD_EMPTY;
  };

  // Helper to draw a road line offset from center to show direction
  const drawRoad = (road: RoadData) => {
    // Parse IDs to find coordinates
    // Assuming Intersection IDs are "row-col"
    const [uRow, uCol] = road.u.split('-').map(Number);
    const [vRow, vCol] = road.v.split('-').map(Number);
    
    const start = getCoords(uRow, uCol);
    const end = getCoords(vRow, vCol);

    // Offset logic to separate two-way traffic
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    // Dynamic offset based on road width
    const offset = ROAD_WIDTH * 0.7; 
    
    const x1 = start.x + offset * Math.cos(angle + Math.PI / 2);
    const y1 = start.y + offset * Math.sin(angle + Math.PI / 2);
    const x2 = end.x + offset * Math.cos(angle + Math.PI / 2);
    const y2 = end.y + offset * Math.sin(angle + Math.PI / 2);

    return (
      <line
        key={road.id}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={getRoadColor(road)}
        strokeWidth={ROAD_WIDTH}
        strokeLinecap="round"
        opacity={0.8}
      />
    );
  };

  const drawIntersection = (intersection: IntersectionData) => {
    const { x, y } = getCoords(intersection.row, intersection.col);
    
    // 0 = NS Green, 1 = EW Green
    const isNS = intersection.phase === 0;
    const color = isNS ? COLORS.NS_GREEN : COLORS.EW_GREEN;
    
    // Signal sizes dynamic based on radius
    const w = NODE_RADIUS * 0.6;
    const h = NODE_RADIUS * 1.8;

    return (
      <g key={intersection.id} transform={`translate(${x}, ${y})`}>
        {/* Base Node */}
        <circle r={NODE_RADIUS} fill="#1e293b" stroke="#475569" strokeWidth="1.5" />
        
        {/* Signal Indicator */}
        {isNS ? (
             <rect x={-w/2} y={-h/2} width={w} height={h} fill={color} rx={1} />
        ) : (
             <rect x={-h/2} y={-w/2} width={h} height={w} fill={color} rx={1} />
        )}
      </g>
    );
  };

  return (
    <div className="overflow-hidden flex justify-center items-center bg-slate-950 rounded-xl transition-all duration-300">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{maxWidth: '100%', maxHeight: '500px', height: 'auto'}}>
         {/* Draw Roads first (background) */}
         {snapshot.roads.map(drawRoad)}
         
         {/* Draw Intersections (foreground) */}
         {snapshot.intersections.map(drawIntersection)}
      </svg>
    </div>
  );
};

export default TrafficGrid;