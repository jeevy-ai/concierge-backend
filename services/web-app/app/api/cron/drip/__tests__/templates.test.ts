import { describe, it, expect } from 'vitest';
import { renderDrip, DRIP_SCHEDULE, type DripStep } from '../templates';

const vars = { firstName: 'Alex', productDomain: 'jeevy.ai' };

describe('DRIP_SCHEDULE', () => {
  it('covers all 5 steps', () => {
    expect(Object.keys(DRIP_SCHEDULE)).toHaveLength(5);
  });

  it('steps are on correct days', () => {
    expect(DRIP_SCHEDULE[1]).toBe(1);
    expect(DRIP_SCHEDULE[2]).toBe(4);
    expect(DRIP_SCHEDULE[3]).toBe(8);
    expect(DRIP_SCHEDULE[4]).toBe(12);
    expect(DRIP_SCHEDULE[5]).toBe(15);
  });
});

describe('renderDrip', () => {
  const steps: DripStep[] = [1, 2, 3, 4, 5];

  for (const step of steps) {
    it(`step ${step} renders subject and non-empty text`, () => {
      const result = renderDrip(step, { ...vars, pricing: step === 5 ? '$29/month' : undefined });
      expect(result.subject).toBeTruthy();
      expect(result.text.length).toBeGreaterThan(100);
      expect(result.text).toContain('Alex');
    });
  }

  it('step 5 includes pricing', () => {
    const { text } = renderDrip(5, { ...vars, pricing: '$29/month' });
    expect(text).toContain('$29/month');
  });

  it('step 5 includes UTM link', () => {
    const { text } = renderDrip(5, { ...vars, pricing: '$29/month' });
    expect(text).toContain('utm_source=drip');
    expect(text).toContain('utm_content=email5');
  });

  it('all steps include unsubscribe footer', () => {
    for (const step of steps) {
      const { text } = renderDrip(step, { ...vars, pricing: '$29/month' });
      expect(text).toContain('unsubscribe');
    }
  });
});
