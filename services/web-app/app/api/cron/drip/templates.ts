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

/** Day offsets that trigger each drip step (1-indexed days since signup, same convention as daysSinceSignup). */
export const DRIP_SCHEDULE: Record<DripStep, number> = {
  1: 1,  // D+0
  2: 4,  // D+3
  3: 8,  // D+7
  4: 12, // D+11
  5: 15, // D+14
};

function utm(domain: string, step: DripStep): string {
  return `https://${domain}?utm_source=drip&utm_medium=email&utm_campaign=waitlist-v1&utm_content=email${step}`;
}

export function renderDrip(step: DripStep, vars: DripTemplateVars): RenderedEmail {
  const { firstName, productDomain, pricing } = vars;
  const unsubFooter = `\n\n--\nTo stop receiving these emails, reply with "unsubscribe" and we'll remove you immediately.`;

  switch (step) {
    case 1:
      return {
        subject: 'Your calendar isn\'t the problem.',
        text: [
          `Hi ${firstName},`,
          '',
          'Most productivity tools are built on a premise that, once you notice it, is hard to unsee.',
          '',
          'They assume you\'re the bottleneck.',
          '',
          'The calendar app assumes you forgot to block time. The to-do list assumes you haven\'t written it down. The AI assistant assumes you need a better answer.',
          '',
          'But the people who are genuinely "on top of everything"? They\'re usually not more disciplined. They have someone — an EA, a chief of staff, an assistant — who handles the coordination layer. The rescheduling, the follow-ups, the cross-app orchestration that no tool does, because every tool is designed to work in isolation.',
          '',
          'That layer is what Jeevy is.',
          '',
          'Over the next two weeks, we\'ll show you what that means — a real example, a real demo, and a few words from people who\'ve already handed something off.',
          '',
          'Welcome to the queue.',
          '',
          '— The Jeevy team',
          '',
          'P.S. What\'s the one thing you most wish you didn\'t have to manage yourself? Reply — we read every one.',
          unsubFooter,
        ].join('\n'),
      };

    case 2:
      return {
        subject: '"I need to be in Berlin Thursday."',
        text: [
          `Hi ${firstName},`,
          '',
          "Let me show you the kind of task Jeevy handles.",
          '',
          "You're in a meeting Wednesday morning. An alert comes through: your Thursday flight to Berlin has been cancelled. The next available is two hours earlier — which means you need to be at the airport by 6am, which means leaving home at 5:15.",
          '',
          'That one alert creates a cascade:',
          '',
          '- Rebook the flight on the earlier departure',
          '- Update the hotel with the new arrival time',
          '- Reschedule your Thursday 9am sync (three people are already calendar-blocked)',
          '- Notify your Berlin contact that the meeting moves 30 minutes earlier',
          '- Book the earlier Uber to the airport',
          '- Cancel the pre-departure dinner you no longer have time for',
          '',
          'If you\'re managing this yourself: 20–40 minutes across multiple apps, a few awkward reply-all emails, and one thing you\'ll remember you forgot at 5am.',
          '',
          'If you say to Jeevy: "My Thursday Berlin flight was cancelled. Fix it." — that cascade is handled while you\'re still in your Wednesday meeting.',
          '',
          'One instruction. Six steps. Zero app-switching.',
          '',
          "We'll show you what the actual interaction looks like in a few days.",
          '',
          '— The Jeevy team',
          unsubFooter,
        ].join('\n'),
      };

    case 3:
      return {
        subject: 'What actually happens when you give Jeevy a task.',
        text: [
          `Hi ${firstName},`,
          '',
          "You've heard the pitch. Here's what it actually looks like.",
          '',
          'This is a real task from early access testing:',
          '',
          '---',
          '',
          'You: "I haven\'t spoken to Mark Chen in three months. We talked about coffee in Q1 — find a time that works for both of us and set it up."',
          '',
          'Jeevy: Checking your calendar... scanning open blocks... cross-referencing against Mark\'s stated availability...',
          '',
          'Draft sent to Mark: "Hey Mark — long overdue. Are you free any Tuesday or Thursday morning in the next two weeks? Either works for me."',
          '',
          'Mark replies: "Thursday 16th works. 9am?"',
          '',
          '→ Calendar invite created. Location set to Blue Bottle (5-min walk from your office, your usual). Day-of reminder added. CRM entry updated: "reconnected, Q1."',
          '',
          '---',
          '',
          'Time in Jeevy: one sentence.',
          'Time it would have taken you: 8 minutes, optimistically — more if you had to chase.',
          '',
          "This isn't magic. It's the coordination work you're currently doing yourself, done faster, without you needing to open anything.",
          '',
          "We'll be opening the next cohort soon.",
          '',
          '— The Jeevy team',
          unsubFooter,
        ].join('\n'),
      };

    case 4:
      return {
        subject: '"I haven\'t checked a flight booking in three weeks."',
        text: [
          `Hi ${firstName},`,
          '',
          'When we gave early access to our first group, we asked one question after 30 days:',
          '',
          '"What\'s the biggest thing that changed?"',
          '',
          "Here's what came back:",
          '',
          '"I stopped thinking about my travel. I tell Jeevy where I need to be and it handles everything. I haven\'t checked a flight booking confirmation in three weeks."',
          '— Founder, early-stage startup',
          '',
          '"I get 200–300 emails a day. I\'ve tried every inbox tool. Jeevy is the first thing that actually reduces the thinking — not just the volume."',
          '— VP of Operations, 200-person company',
          '',
          '"I\'m embarrassed by how much mental energy I used to spend on follow-up emails. The kind you know you should send but never get to. Jeevy sends them."',
          '— Independent consultant',
          '',
          "The common thread isn't minutes saved. It's the mental weight that disappears when something is genuinely handled — not deferred, not organised into a system, just done.",
          '',
          "We think you'll feel it too.",
          '',
          '— The Jeevy team',
          '',
          'P.S. The product isn\'t perfect yet. But early users are telling us exactly what to build, which means Jeevy gets sharper the more it\'s used seriously.',
          unsubFooter,
        ].join('\n'),
      };

    case 5: {
      const price = pricing ?? '[$X/month]';
      const ctaUrl = utm(productDomain, 5);
      return {
        subject: 'One last thing before we close this out.',
        text: [
          `Hi ${firstName},`,
          '',
          "Two weeks. Five emails. We'll keep this one short.",
          '',
          'Jeevy is now open for your trial.',
          '',
          "It's not for everyone. If your days run smoothly and coordination isn't costing you, you probably don't need it.",
          '',
          "But if you've ever caught yourself:",
          '',
          '- Rescheduling a meeting at 11pm because you forgot it conflicted',
          '- Mentally tracking five things you haven\'t followed up on yet',
          '- Opening three apps to do one thing that should take 30 seconds',
          '',
          '— Jeevy was built for that.',
          '',
          `Early access is ${price}. Less than a single hour with a virtual assistant. Less than your Notion and Calendly subscriptions combined.`,
          '',
          `→ Start your trial: ${ctaUrl}`,
          '',
          "If this isn't for you, no hard feelings. We'll send one more email when we hit a meaningful product milestone — that's it.",
          '',
          'Thanks for being patient with us.',
          '',
          '— The Jeevy team',
          unsubFooter,
        ].join('\n'),
      };
    }
  }
}
