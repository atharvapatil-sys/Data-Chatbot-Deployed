import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import type { ChartConfig } from '../types';

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    fontSize: '12px',
  },
  itemStyle: { color: '#334155' },
};

interface ChartProps {
  data: Record<string, unknown>[];
  config: ChartConfig;
}

// ── Table fallback ────────────────────────────────────────────

function DataTable({ data }: { data: Record<string, unknown>[] }) {
  if (!data.length) return <p className="text-sm text-slate-400 p-4">No data to display.</p>;
  const columns = Object.keys(data[0]);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm text-slate-700" aria-label="Query results">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {columns.map((key) => (
              <th
                key={key}
                scope="col"
                className="px-4 pb-3 pt-3 font-mono text-[11px] uppercase tracking-wider text-slate-500 font-semibold"
              >
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={i}
              className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
            >
              {columns.map((col) => (
                <td key={col} className="px-4 py-3 font-mono text-xs text-slate-600">
                  {typeof row[col] === 'number'
                    ? (row[col] as number).toLocaleString()
                    : String(row[col] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

/**
 * The primary visualization component for InsightStream.
 * Dynamically renders Bar, Line, Pie charts or a fallback Data Table based on AI-suggested config.
 * 
 * @param props.data - Array of objects representing the BigQuery query results.
 * @param props.config - Visualization configuration (type, axes, title).
 */
export function AnalyticsChart({ data, config }: ChartProps) {
  // Validate x/y axis fields exist in data
  const dataKeys = data.length > 0 ? Object.keys(data[0]) : [];
  const hasValidAxes =
    config.xAxis &&
    config.yAxis &&
    dataKeys.includes(config.xAxis) &&
    dataKeys.includes(config.yAxis);

  if (config.type === 'table' || !hasValidAxes) {
    return <DataTable data={data} />;
  }

  const xKey = config.xAxis!;
  const yKey = config.yAxis!;

  return (
    <div className="h-[300px] w-full rounded-xl border border-slate-200 bg-white p-4">
      {config.title && (
        <h3 className="mb-4 text-sm font-semibold text-slate-700">{config.title}</h3>
      )}
      <ResponsiveContainer width="100%" height="85%">
        {config.type === 'bar' ? (
          <BarChart data={data} aria-label={config.title ?? 'Bar chart'}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey={xKey}
              stroke="#94a3b8"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#64748b' }}
            />
            <YAxis
              stroke="#94a3b8"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#64748b' }}
            />
            <Tooltip {...TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ paddingTop: '16px', fontSize: '12px' }} />
            <Bar dataKey={yKey} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={50} />
          </BarChart>
        ) : config.type === 'line' ? (
          <LineChart data={data} aria-label={config.title ?? 'Line chart'}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey={xKey}
              stroke="#94a3b8"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#64748b' }}
            />
            <YAxis
              stroke="#94a3b8"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#64748b' }}
            />
            <Tooltip {...TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ paddingTop: '16px', fontSize: '12px' }} />
            <Line
              type="monotone"
              dataKey={yKey}
              stroke={CHART_COLORS[0]}
              strokeWidth={3}
              dot={{ r: 4, fill: CHART_COLORS[0], strokeWidth: 2, stroke: '#ffffff' }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        ) : (
          <PieChart aria-label={config.title ?? 'Pie chart'}>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              outerRadius={80}
              innerRadius={40}
              dataKey={yKey}
              nameKey={xKey}
              label={({ name, percent }: { name?: unknown; percent?: number }) =>
                `${String(name ?? '')} ${((percent ?? 0) * 100).toFixed(0)}%`
              }
            >
              {data.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                  stroke="#ffffff"
                  strokeWidth={2}
                />
              ))}
            </Pie>
            <Tooltip {...TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
          </PieChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
