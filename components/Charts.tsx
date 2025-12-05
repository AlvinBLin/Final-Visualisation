import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ComparisonStats } from '../types';

interface ChartsProps {
  data: ComparisonStats[];
}

const Charts: React.FC<ChartsProps> = ({ data }) => {
  // We only show the last 200 points to keep chart performant and readable
  const chartData = data.slice(-200);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 h-64">
      
      {/* 1. Global Congestion */}
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg flex flex-col">
        <h3 className="text-slate-200 text-sm font-semibold mb-2">Global Density (Total Cars)</h3>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="step" hide />
              <YAxis stroke="#94a3b8" fontSize={10} domain={['auto', 'auto']} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f1f5f9' }} 
                itemStyle={{ color: '#f1f5f9' }}
                labelStyle={{ display: 'none' }}
              />
              <Legend verticalAlign="top" height={36} iconType="circle" />
              <Line name="Fixed Time" type="monotone" dataKey="fixedTotalCars" stroke="#ef4444" strokeWidth={2} dot={false} animationDuration={0} />
              <Line name="Smart Agent" type="monotone" dataKey="smartTotalCars" stroke="#3b82f6" strokeWidth={2} dot={false} animationDuration={0} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2. Throughput */}
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg flex flex-col">
        <h3 className="text-slate-200 text-sm font-semibold mb-2">Throughput (Cars Exited)</h3>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="step" hide />
              <YAxis stroke="#94a3b8" fontSize={10} domain={['auto', 'auto']} />
              <Tooltip 
                 contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f1f5f9' }} 
                 itemStyle={{ color: '#f1f5f9' }}
                 labelStyle={{ display: 'none' }}
              />
              <Legend verticalAlign="top" height={36} iconType="circle" />
              <Line name="Fixed Time" type="monotone" dataKey="fixedThroughput" stroke="#ef4444" strokeWidth={2} dot={false} animationDuration={0} />
              <Line name="Smart Agent" type="monotone" dataKey="smartThroughput" stroke="#3b82f6" strokeWidth={2} dot={false} animationDuration={0} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 3. Wait Time Proxy */}
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg flex flex-col">
        <h3 className="text-slate-200 text-sm font-semibold mb-2">Stopped Queue (Wait Time)</h3>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="step" hide />
              <YAxis stroke="#94a3b8" fontSize={10} domain={['auto', 'auto']} />
              <Tooltip 
                 contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f1f5f9' }} 
                 itemStyle={{ color: '#f1f5f9' }}
                 labelStyle={{ display: 'none' }}
              />
              <Legend verticalAlign="top" height={36} iconType="circle" />
              <Line name="Fixed Time" type="monotone" dataKey="fixedStopped" stroke="#ef4444" strokeWidth={2} dot={false} animationDuration={0} />
              <Line name="Smart Agent" type="monotone" dataKey="smartStopped" stroke="#3b82f6" strokeWidth={2} dot={false} animationDuration={0} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  );
};

export default Charts;