import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Account Settings — YOU",
};

export default function AccountSettingsPage() {
  return (
    <main className="min-h-screen bg-[#f5f4f0] px-6 py-16">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Account Settings</h1>

        <div className="space-y-4">
          <SettingsCard
            title="Data & Privacy"
            description="Export a copy of your concierge history and personal data."
          >
            <button
              disabled
              className="rounded-lg bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-600 opacity-50 cursor-not-allowed"
            >
              Download my data
            </button>
          </SettingsCard>

          <SettingsCard
            title="Billing & Refunds"
            description="Request a refund or view your billing history."
          >
            <div className="flex items-center gap-4">
              <button
                disabled
                className="rounded-lg bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-600 opacity-50 cursor-not-allowed"
              >
                Request refund
              </button>
              <Link
                href="/refund-policy"
                className="text-sm text-indigo-600 hover:underline"
              >
                Refund Policy →
              </Link>
            </div>
          </SettingsCard>

          <SettingsCard
            title="Support"
            description="Questions or feedback? Our team responds within 1 business day."
          >
            <a
              href="mailto:support@you.app"
              className="rounded-lg bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors inline-block"
            >
              Email support@you.app
            </a>
          </SettingsCard>
        </div>

        <div className="mt-10">
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            ← Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-8 py-6">
      <h2 className="text-base font-semibold text-gray-900 mb-1">{title}</h2>
      <p className="text-sm text-gray-400 mb-4">{description}</p>
      {children}
    </div>
  );
}
