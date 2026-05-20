import Link from "next/link";

export const metadata = {
  title: "You're set — Jeevy",
};

export default function ThankYouPage() {
  return (
    <main className="min-h-screen bg-[#f5f4f0] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-[560px]">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
          <div className="mb-6 inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-50">
            <svg
              className="w-8 h-8 text-indigo-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            You&#39;re set. We&#39;ll be in touch.
          </h1>
          <p className="text-gray-500 mb-10 text-base leading-relaxed">
            Here&#39;s what happens next:
          </p>

          <ol className="text-left space-y-6 mb-10">
            {[
              {
                num: 1,
                title: "We'll review your answers",
                detail: "within 24 hours",
              },
              {
                num: 2,
                title: "You'll get a personalized kickoff plan",
                detail: "tailored to your goals and tools",
              },
              {
                num: 3,
                title: "Your AI concierge goes live",
                detail: "Day 0 setup call or async if you prefer",
              },
            ].map(({ num, title, detail }) => (
              <li key={num} className="flex gap-4">
                <span className="flex-none flex items-center justify-center w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 font-semibold text-sm">
                  {num}
                </span>
                <div>
                  <p className="font-semibold text-gray-900">{title}</p>
                  <p className="text-sm text-gray-400 mt-0.5">— {detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <p className="text-sm text-gray-400 mb-8">
            Questions? Reply to your confirmation email — a human will answer.
          </p>

          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            ← Back to jeevy.ai
          </Link>
        </div>
      </div>
    </main>
  );
}
