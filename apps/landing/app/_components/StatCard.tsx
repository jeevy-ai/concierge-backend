interface StatCardProps {
  stat: string;
  label: string;
}

export function StatCard({ stat, label }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
      <p className="text-5xl font-bold text-indigo-600 mb-3">{stat}</p>
      <p className="text-sm text-gray-500 leading-snug">{label}</p>
    </div>
  );
}
