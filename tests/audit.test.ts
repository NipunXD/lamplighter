import { describe, it, expect } from 'vitest';
import { AuditLog } from '../server/audit.js';

describe('audit log', () => {
  it('chains hashes and detects tampering', () => {
    const log = new AuditLog();
    log.append({ simTs: 't0', actor: 'system', type: 'run_started', payload: { a: 1 } });
    log.append({ simTs: 't1', actor: 'agent', type: 'plan', payload: { b: 2 }, caseId: 'case_1' });
    log.append({ simTs: 't2', actor: 'customer', type: 'paid', payload: { amount: 100 }, caseId: 'case_1' });
    expect(log.verify().ok).toBe(true);
    (log.events[1].payload as any).b = 3; // edit history
    expect(log.verify()).toEqual({ ok: false, brokenAt: 2 });
  });
});
