import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Refund Policy — YOU",
  description: "YOU's 30-day money-back guarantee and refund policy.",
};

export default function RefundPolicyPage() {
  return (
    <main className="min-h-screen bg-[#f5f4f0] px-6 py-16">
      <div className="mx-auto max-w-2xl">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-10 py-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">YOU Refund Policy</h1>
          <p className="text-sm text-gray-400 mb-10">Last updated: May 20, 2026</p>

          <Section title="Overview">
            <p>
              We want you to be completely satisfied with YOUR concierge service. If something
              isn&apos;t right, we&apos;ll make it right.
            </p>
          </Section>

          <Section title="30-Day Money-Back Guarantee">
            <p>
              You may request a full refund within <strong>30 days</strong> of your subscription
              start date or most recent billing date if:
            </p>
            <ul className="mt-3 space-y-2 list-disc list-inside text-gray-500">
              <li>The service did not perform as described, or</li>
              <li>
                You experienced a material technical failure that our support team could not resolve
                within 72 hours.
              </li>
            </ul>
          </Section>

          <Section title="How to Request a Refund">
            <p>To request a refund, you do not need to contact support. You can:</p>
            <ol className="mt-3 space-y-2 list-decimal list-inside text-gray-500">
              <li>
                Log in to your{" "}
                <Link href="/account-settings" className="text-indigo-600 hover:underline">
                  account settings
                </Link>
              </li>
              <li>
                Click <strong>&ldquo;Download my data&rdquo;</strong> to export your concierge
                history
              </li>
              <li>
                Click <strong>&ldquo;Request refund&rdquo;</strong> and briefly describe the issue
              </li>
            </ol>
            <p className="mt-4">
              We will process all refund requests within <strong>5 business days</strong> and return
              funds to your original payment method.
            </p>
          </Section>

          <Section title="Partial Refunds">
            <p>
              For annual plans, we may issue a pro-rated refund for unused months at our discretion
              after the 30-day window.
            </p>
          </Section>

          <Section title="Exclusions">
            <p>The following are not eligible for refunds:</p>
            <ul className="mt-3 space-y-2 list-disc list-inside text-gray-500">
              <li>Requests made after 30 days of the billing date</li>
              <li>
                Usage fees for completed concierge tasks (calendar reschedule, travel booking, etc.)
                where the service was successfully delivered
              </li>
              <li>Promotional or free-trial periods</li>
            </ul>
          </Section>

          <Section title="Questions">
            <p>
              Email{" "}
              <a href="mailto:support@you.app" className="text-indigo-600 hover:underline">
                support@you.app
              </a>{" "}
              or reach out via in-app chat. We respond within 1 business day.
            </p>
          </Section>

          <hr className="border-gray-100 my-8" />

          <p className="text-sm text-gray-400 italic">
            This policy applies to all YOU subscriptions. We reserve the right to update this policy
            with 14 days&apos; notice to active subscribers.
          </p>

          <div className="mt-10">
            <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              ← Back to home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-3">{title}</h2>
      <div className="text-gray-500 leading-relaxed space-y-2">{children}</div>
    </section>
  );
}
