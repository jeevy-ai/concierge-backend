import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "What an AI Concierge Actually Handles (And What It Doesn't) | Jeevy",
  description:
    "Most AI tools promise to do everything. At Jeevy, we're deliberate about what our AI concierge handles — and just as deliberate about what it doesn't.",
  openGraph: {
    title: "What an AI Concierge Actually Handles (And What It Doesn't)",
    description:
      "Most AI tools promise to do everything. At Jeevy, we're deliberate about what our AI concierge handles — and just as deliberate about what it doesn't.",
    type: "article",
    publishedTime: "2026-05-22",
    url: "https://jeevy.ai/blog/what-an-ai-concierge-actually-handles",
  },
};

export default function BlogPost() {
  return (
    <main className="min-h-screen bg-[#f5f4f0] px-6 py-16">
      <article className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors mb-10"
        >
          ← Jeevy
        </Link>

        <header className="mb-12">
          <p className="text-sm font-medium text-indigo-600 mb-3">Product thinking</p>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight leading-tight mb-4">
            What an AI Concierge Actually Handles (And What It&nbsp;Doesn&apos;t)
          </h1>
          <p className="text-gray-400 text-sm">May 22, 2026</p>
        </header>

        <div className="space-y-6 text-[17px] leading-relaxed text-gray-700">
          <p>
            Most AI tools promise to do everything. Book flights, write your novel, manage your
            investments, coach your team, and stay on top of your inbox. That version makes for a
            compelling demo. It also makes for a frustrating product.
          </p>
          <p>Jeevy isn&apos;t that.</p>
          <p>
            We&apos;re deliberate about scope — not because we can&apos;t build more, but because clarity
            is the point. People who trust a concierge need to know exactly what they can hand off and
            what they need to own. Ambiguity erodes that trust faster than any limitation ever will.
          </p>
          <p>
            So here&apos;s the honest answer to the question we get asked most:{" "}
            <em>What will Jeevy actually do?</em>
          </p>

          <hr className="border-gray-200 my-8" />

          <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">What Jeevy handles</h2>
          <p>
            The common thread across everything Jeevy takes on is this: tasks where the{" "}
            <strong>coordination cost</strong> outweighs the <strong>decision cost</strong>. The hard
            part isn&apos;t figuring out what to do — it&apos;s the back-and-forth, the follow-through,
            and the context-switching that burns your day.
          </p>

          <p>
            <strong>Scheduling and calendar management.</strong> Finding times, sending holds,
            rescheduling conflicts, blocking focus time. Not just for you — across your team and with
            external contacts who don&apos;t use the same tools you do.
          </p>
          <p>
            <strong>Meeting prep and follow-up.</strong> Summarizing the agenda, pulling background on
            attendees, and turning action items into tracked tasks after the call ends. The part that
            usually falls through the cracks.
          </p>
          <p>
            <strong>Research and synthesis.</strong> Background on a company, a person, a topic, a
            vendor comparison. You define the question; Jeevy returns a usable brief — not a wall of
            links you have to read yourself.
          </p>
          <p>
            <strong>Email drafting and inbox triage.</strong> First drafts on routine correspondence,
            flagging what needs a real response versus what can be handled or delegated, and keeping
            threads from going quiet when they shouldn&apos;t.
          </p>
          <p>
            <strong>Travel and logistics coordination.</strong> Searching options, compiling
            itineraries, flagging conflicts with existing commitments, and managing the logistics tail
            after you&apos;ve made a decision.
          </p>
          <p>
            <strong>Reminders, nudges, and follow-up tracking.</strong> The steady-state work of
            keeping commitments alive — surfacing things before they slip, following up with external
            contacts when threads go dark.
          </p>
          <p>
            What these share: they&apos;re defined, they&apos;re delegatable, and done well, they compound.
            An hour of Jeevy handling calendar work frees an hour for the work only you can do.
          </p>

          <hr className="border-gray-200 my-8" />

          <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">What Jeevy doesn&apos;t handle</h2>
          <p>This list matters as much as the one above.</p>
          <p>
            <strong>Strategic and consequential decisions.</strong> Where to hire next, whether to
            accept a term sheet, how to respond to a difficult board dynamic. Jeevy can bring you
            information and frame options — but it doesn&apos;t make calls that require accountability,
            judgment under uncertainty, or lived context about your company and relationships.
          </p>
          <p>
            <strong>Sensitive relationship conversations.</strong> Feedback conversations, performance
            discussions, and emotionally complex communications stay in your hands. AI-generated
            empathy is a known failure mode. Jeevy won&apos;t put words in your mouth when getting the
            tone wrong costs trust.
          </p>
          <p>
            <strong>Work that requires your authentic voice.</strong> Jeevy can draft, but you own
            anything that shapes how the market sees you — final copy, thought leadership, positioning
            statements. Iterating with AI is fine. Fully outsourcing your perspective isn&apos;t.
          </p>
          <p>
            <strong>Financial transactions and binding commitments.</strong> Jeevy won&apos;t approve
            spend, move money, or commit on your behalf.
          </p>
          <p>
            <strong>Open-ended creative direction without a brief.</strong> If you don&apos;t know what
            you want yet, Jeevy isn&apos;t the right first step. It&apos;s a force-multiplier on clear intent
            — not a substitute for figuring out what matters.
          </p>

          <hr className="border-gray-200 my-8" />

          <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
            Why being opinionated about this matters
          </h2>
          <p>
            The AI tools that disappoint are usually the ones that overpromised. They said yes to
            everything in the demo and delivered unreliable output in practice.
          </p>
          <p>
            Reliability is the product. When you hand something to Jeevy, you should be able to stop
            thinking about it — not monitor it, not check its work, not wonder if it understood the
            task.
          </p>
          <p>
            That&apos;s only possible if the scope is honest. We&apos;d rather tell you &ldquo;that&apos;s not in
            Jeevy&apos;s lane&rdquo; than have you lose a client because a concierge tool treated an
            emotionally complex email like a scheduling request.
          </p>
          <p>
            The question we ask internally isn&apos;t &ldquo;can AI technically do this?&rdquo; It&apos;s:{" "}
            <strong>is this the kind of task where AI failure is recoverable?</strong>
          </p>
          <p>
            A scheduling conflict is recoverable. A relationship misstep is not.
          </p>

          <hr className="border-gray-200 my-8" />

          <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">The practical upshot</h2>
          <p>
            Jeevy works well for founders, operators, and executives who have a clear week but a
            chaotic queue of admin and coordination work sitting behind it. If you spend two or more
            hours a day on tasks that someone competent and context-aware could handle for you —
            that&apos;s the gap Jeevy was built for.
          </p>
          <p>
            If you need a thought partner for hard decisions, a creative director, or a financial
            advisor — that&apos;s not us. We&apos;ll be specific about that every time, because specificity is
            what makes the parts we <em>do</em> handle actually trustworthy.
          </p>
        </div>

        <footer className="mt-16 pt-8 border-t border-gray-200">
          <Link
            href="/apply?utm_source=blog&utm_medium=owned&utm_campaign=w4-concierge-scope"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow hover:bg-indigo-700 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-150"
          >
            Try Jeevy →
          </Link>
          <p className="mt-4 text-sm text-gray-400">Takes ~2 minutes · No commitment</p>
        </footer>
      </article>
    </main>
  );
}
