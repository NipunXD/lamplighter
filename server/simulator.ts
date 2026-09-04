// The customer world. Holds the hidden profiles and decides how customers react to the agent.
// The agent never imports this module's state; it only receives events back through the run loop.
import seedrandom from 'seedrandom';
import type { CaseState, HiddenProfile, PlannedAction } from './types.js';
import { addHours, istHour } from './time.js';

export type SimOutcome =
  | { kind: 'pays'; at: string; note: string }
  | { kind: 'promise_to_pay'; at: string; payAt: string; note: string }
  | { kind: 'ignores'; note: string }
  | { kind: 'stop'; at: string; note: string }
  | { kind: 'complains'; at: string; note: string };

export class CustomerWorld {
  private rng: seedrandom.PRNG;
  private cold = new Set<string>();
  constructor(private hidden: Map<string, HiddenProfile>, seed: number) {
    this.rng = seedrandom(`world-${seed}`);
  }

  /** Reaction to a customer-facing touch. */
  onTouch(state: CaseState, action: PlannedAction, at: string): SimOutcome {
    const h = this.hidden.get(state.case.id)!;
    const c = state.case.customer;
    const n = state.touches.filter((t) => t.action !== 'wait_and_retry').length; // touches before this one
    const touchNo = n + 1;
    const quiet = istHour(at) >= 21 || istHour(at) < 9;

    if (this.cold.has(state.case.id)) return { kind: 'ignores', note: 'customer went cold earlier' };
    if (h.willSayStop && touchNo >= 2 && this.rng() < 0.8) return { kind: 'stop', at: addHours(at, 0.5), note: `${h.archetype} customer replied STOP` };
    if (touchNo > h.annoyanceThreshold) {
      this.cold.add(state.case.id);
      if (this.rng() < 0.5) return { kind: 'complains', at: addHours(at, 1), note: `touch #${touchNo} exceeded tolerance (${h.annoyanceThreshold})` };
      return { kind: 'ignores', note: 'over-contacted, went cold' };
    }
    // extra irritation for the things the policy forbids
    if (quiet && this.rng() < 0.25) { this.cold.add(state.case.id); return { kind: 'complains', at: addHours(at, 0.2), note: 'contacted at night' }; }
    if (c.dnd && (action.channel === 'sms' || action.channel === 'voice') && this.rng() < 0.3) { this.cold.add(state.case.id); return { kind: 'complains', at: addHours(at, 2), note: 'DND customer got a promotional SMS/call' }; }

    let p = h.basePayProb * (action.channel ? h.channelAffinity[action.channel] : 1) * Math.pow(0.7, n);
    if (action.type === 'offer_incentive') p *= h.respondsToIncentive ? 1.9 : 1.1;
    if (action.type === 'new_mandate_link' && h.archetype === 'friction') p *= 1.25;
    if (action.lang && action.lang === c.lang) p *= 1.12; else if (action.lang) p *= 0.9;
    if (quiet) p *= 0.6;
    const hr = istHour(at);
    if ((hr >= 9 && hr < 11) || (hr >= 18 && hr < 20.5)) p *= 1.1;
    if (h.archetype === 'temporary_funds' && h.fundsAvailableAt && at < h.fundsAvailableAt) p *= 0.2;
    if (h.archetype === 'busy_ap' && action.type === 'voice_call') p *= 1.4;
    p = Math.min(0.97, p);

    if (this.rng() < p) {
      let payAt = addHours(at, h.responseDelayHours * (0.5 + this.rng()));
      if (h.fundsAvailableAt && payAt < h.fundsAvailableAt) payAt = addHours(h.fundsAvailableAt, 2 + this.rng() * 6);
      if (h.archetype === 'busy_ap' && this.rng() < 0.45) {
        const promisePay = addHours(at, 48 + this.rng() * 72);
        return { kind: 'promise_to_pay', at: addHours(at, 4), payAt: promisePay, note: 'AP team promised payment after their cycle' };
      }
      return { kind: 'pays', at: payAt, note: `${h.archetype} responded to ${action.type} on ${action.channel ?? 'n/a'} (p=${p.toFixed(2)})` };
    }
    return { kind: 'ignores', note: `no response (p=${p.toFixed(2)})` };
  }

  /** Reaction to a silent retry: no customer involvement, just the bank. */
  onSilentRetry(state: CaseState, at: string): SimOutcome {
    const h = this.hidden.get(state.case.id)!;
    let p: number;
    switch (h.archetype) {
      case 'temporary_funds': p = h.fundsAvailableAt && at >= h.fundsAvailableAt ? 0.8 : 0.05; break;
      case 'friction': p = 0.75; break; // bank was down / limit reset
      case 'forgot': p = 0.2; break;
      case 'hard_no': p = 0; break;
      default: p = 0.12;
    }
    if (this.rng() < p) return { kind: 'pays', at: addHours(at, 0.1), note: `retry succeeded (${h.archetype}, p=${p.toFixed(2)})` };
    return { kind: 'ignores', note: `retry failed (${h.archetype}, p=${p.toFixed(2)})` };
  }

  archetypeOf(caseId: string) { return this.hidden.get(caseId)?.archetype; }
}
