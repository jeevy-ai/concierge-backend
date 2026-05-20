export type DripStep = 1 | 2 | 3 | 4 | 5;

export interface DripTemplateVars {
  firstName: string;
  productDomain: string;
  /** Required for Email 5. Format: "$X/month" e.g. "$29/month" */
  pricing?: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
}

/**
 * Day offsets that trigger each drip step.
 * daysSinceSignup() returns 1 on signup day (D+0), so D+N = day N+1.
 * Sequence: D0 / D2 / D5 / D9 / D14.
 */
export const DRIP_SCHEDULE: Record<DripStep, number> = {
  1: 1,   // D+0
  2: 3,   // D+2
  3: 6,   // D+5
  4: 10,  // D+9
  5: 15,  // D+14
};

function utm(domain: string, step: DripStep, path = ''): string {
  return `https://${domain}${path}?utm_source=drip&utm_medium=email&utm_campaign=drip_v1&utm_content=email${step}`;
}

export function renderDrip(step: DripStep, vars: DripTemplateVars): RenderedEmail {
  const { firstName, productDomain, pricing } = vars;
  const unsubFooter = `\n\n--\nTo stop receiving these emails, reply with "unsubscribe" and we'll remove you immediately.`;

  switch (step) {
    case 1:
      // Subject B: "Your AI concierge is almost ready"
      return {
        subject: "You're on the Jeevy waitlist — here's what that means",
        text: [
          `Hey ${firstName},`,
          '',
          "You're in.",
          '',
          "I built Jeevy because I was losing 2–3 hours every day to email coordination, calendar juggling, and scheduling back-and-forths that should be automatic. Probably sounds familiar.",
          '',
          "Jeevy is a concierge that actually does the work: schedules your meetings, handles your calendar conflicts, follows up when you forget, and keeps your day from becoming a coordination mess.",
          '',
          "Over the next two weeks I'll show you exactly what that looks like — real use cases, real outcomes, and an honest look at what it can and can't do yet.",
          '',
          "When we open access, waitlist members get in first and lock in the founder rate.",
          '',
          "The Jeevy team",
          '',
          "P.S. — Hit reply and tell me the one coordination task that eats most of your time. I read every response and it shapes what we build.",
          unsubFooter,
        ].join('\n'),
      };

    case 2:
      // Subject B: 'Why "just use Calendly" isn\'t the answer'
      return {
        subject: 'The 2-hour tax you pay every day',
        text: [
          `Hey ${firstName},`,
          '',
          "I used to think my calendar problem was a tool problem.",
          '',
          "So I used Calendly. Then Superhuman. Then a VA for a while. Every time I fixed one part of the coordination hell, another part broke.",
          '',
          "The real issue isn't which tool you use. It's that scheduling, rescheduling, and email back-and-forth are intrinsically human-shaped tasks — they require judgment, context, and follow-through. Every tool on the market asks you to adapt to it instead of adapting to you.",
          '',
          "Here's what a typical \"coordination tax\" week looks like for a founder or busy exec:",
          '',
          "- 18+ emails just to set up 4 meetings",
          "- 3 reschedules handled manually that could have been automated",
          "- 2 follow-ups forgotten until it was awkward",
          "- 1 double-booking that wasted everyone's time",
          '',
          "That's 90–120 minutes a day going to work that isn't your actual work.",
          '',
          "Jeevy eliminates that tax. It reads your email, understands your calendar, and takes action — without you writing another \"Does Tuesday at 3pm work?\" in your life.",
          '',
          "Tomorrow I'll show you what a real session looks like.",
          '',
          "The Jeevy team",
          unsubFooter,
        ].join('\n'),
      };

    case 3: {
      const demoUrl = utm(productDomain, 3, '/demo');
      // Subject B: '"It felt like having an actual assistant" — here\'s what that means'
      return {
        subject: 'What happens when you let Jeevy handle your week',
        text: [
          `Hey ${firstName},`,
          '',
          "Let me show you a real session.",
          '',
          "The scenario: Monday morning. 11 new emails. 3 meeting requests. 2 follow-ups I said I'd send last week.",
          '',
          "What I used to do: Spend the first hour triaging, responding, rescheduling — already feeling behind before the day started.",
          '',
          "What happens with Jeevy:",
          '',
          "1. Jeevy reads my inbox and flags the 3 items that need action today vs. the 8 that can wait.",
          "2. It drafts responses to the 2 meeting requests — matching my availability, preferred tone, no-double-booking rule.",
          "3. It surfaces the 2 forgotten follow-ups with draft text ready to approve.",
          "4. I review, approve with one click, done. Total time: 12 minutes.",
          '',
          "That's the shift. From email manager to decision maker.",
          '',
          `→ Watch the 3-minute demo: ${demoUrl}`,
          '',
          "One early user: \"It felt like having an actual assistant who already knows how I work.\" That's exactly what we're going for.",
          '',
          "Access opens soon. You're already on the list.",
          '',
          "The Jeevy team",
          unsubFooter,
        ].join('\n'),
      };
    }

    case 4:
      // Subject B: "Why the first 50 users matter (and what they get)"
      return {
        subject: "47 people on our list — here's what they have in common",
        text: [
          `Hey ${firstName},`,
          '',
          "The people who signed up for Jeevy early are a specific type.",
          '',
          "Founders, operators, and executives who are allergic to wasted time. They've tried the tools. They've hired VAs. They're not looking for another app to learn — they want coordination handled so they can do their actual job.",
          '',
          "Sound like you?",
          '',
          "Here's what the first 50 paid users get that no one else will:",
          '',
          "- Founder-led onboarding. I personally run a 30-minute session to configure Jeevy for exactly how you work. Not a chatbot. Me.",
          "- Locked-in founder rate. The price you join at is the price you keep. Forever.",
          "- Direct line to the product. Your first month of feedback directly shapes what we build next.",
          '',
          "We're opening access to the waitlist in priority order. Being here matters.",
          '',
          "The Jeevy team",
          '',
          "P.S. — If you know someone who should be on this list, forward this email.",
          unsubFooter,
        ].join('\n'),
      };

    case 5: {
      const price = pricing ?? '[$X/month]';
      const ctaUrl = utm(productDomain, 5, '/onboard');
      // Subject B: "I'd like to personally onboard you this week"
      return {
        subject: 'Your Jeevy access is ready',
        text: [
          `Hey ${firstName},`,
          '',
          "You've been on our waitlist for two weeks. I think it's time to make it real.",
          '',
          "I'm opening access this week to a small group for a personally-onboarded trial of Jeevy. Not a \"sign up and poke around\" trial — a proper kickoff where I configure the concierge for your actual workflow before you pay anything.",
          '',
          "What the onboarding covers:",
          "- Connect your calendar and email",
          "- Define your scheduling rules and preferences",
          "- Set up your first 3 concierge tasks",
          "- You leave with Jeevy actually working for you",
          '',
          `Book your 30-minute kickoff: ${ctaUrl}`,
          '',
          `The founder rate is ${price}. Cancel any time in the first 30 days for a full refund — no questions asked.`,
          '',
          "If you're not ready yet, no pressure. You'll stay on the list.",
          '',
          "Looking forward to it,",
          "The Jeevy team",
          unsubFooter,
        ].join('\n'),
      };
    }
  }
}
