export const dynamic = "force-dynamic";

export default function SmokePage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <p className="text-2xl font-semibold text-green-600">OK</p>
        <p className="mt-2 text-sm text-gray-500">smoke — {new Date().toISOString()}</p>
      </div>
    </main>
  );
}
