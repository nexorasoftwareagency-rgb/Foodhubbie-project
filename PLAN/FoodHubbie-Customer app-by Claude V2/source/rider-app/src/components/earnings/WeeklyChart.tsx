// === src/components/earnings/WeeklyChart.tsx ===
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from "recharts";

export function WeeklyChart({ data }: { data: { d: string; v: number }[] }) {
  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "short" });
  return (
    <div className="h-[130px] mb-1">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <XAxis
            dataKey="d"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9.5, fontWeight: 700, fill: "var(--text-tertiary)" }}
          />
          <Bar dataKey="v" radius={[6, 6, 3, 3]} maxBarSize={28}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.d === todayLabel ? "var(--primary)" : "var(--border)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
