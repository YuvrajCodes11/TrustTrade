import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateScamRules } from '../../src/modules/message/scam-engine.ts';
import { prisma } from '../../src/db/prisma.js';

vi.mock('../../src/db/prisma.js', () => ({
  prisma: {
    scamRule: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

describe('Server-side Scam-Detection Engine Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.scamRule.findMany as any).mockResolvedValue([
      {
        pattern: 'scan.{0,15}qr|qr.{0,10}code.{0,20}(receive|accept|get)',
        reason: 'QR scam pattern',
        active: true,
      },
      {
        pattern: '(army|defence|defense|military|cisf|bsf|posted at border)',
        reason: 'Defense personnel scam pattern',
        active: true,
      },
      {
        pattern: '(advance|token amount|booking amount).{0,25}(before|first|pay)',
        reason: 'Advance deposit scam pattern',
        active: true,
      },
      {
        pattern: '(courier|shipping).{0,20}(insurance|fee|charge)',
        reason: 'Courier fee scam pattern',
        active: true,
      },
      {
        pattern: '(sent extra|overpaid|refund the difference|excess amount)',
        reason: 'Overpayment refund scam pattern',
        active: true,
      },
    ]);
  });

  it('should flag UPI QR code scanning scam scripts', async () => {
    const msg = 'Please scan this QR code to receive your ₹5,000 payment immediately.';
    const res = await evaluateScamRules(msg);
    expect(res.flagged).toBe(true);
    expect(res.reason).toContain('QR scam pattern');
  });

  it('should flag fake army / defense personnel scam scripts', async () => {
    const msg = 'I am an army officer posted at border, I will send courier for pickup.';
    const res = await evaluateScamRules(msg);
    expect(res.flagged).toBe(true);
    expect(res.reason).toContain('Defense personnel scam pattern');
  });

  it('should flag advance token payment requests', async () => {
    const msg = 'Pay advance token amount first before booking the item.';
    const res = await evaluateScamRules(msg);
    expect(res.flagged).toBe(true);
  });

  it('should flag courier shipping insurance fee tricks', async () => {
    const msg = 'Courier insurance fee of ₹500 must be paid prior to delivery.';
    const res = await evaluateScamRules(msg);
    expect(res.flagged).toBe(true);
  });

  it('should flag overpayment refund reversal scams', async () => {
    const msg = 'I sent extra by mistake, please refund the difference to my UPI.';
    const res = await evaluateScamRules(msg);
    expect(res.flagged).toBe(true);
  });

  it('should NOT flag normal genuine conversation messages', async () => {
    const msg = 'Hi! Is this item still available? Can we meet tomorrow at Phoenix Mall?';
    const res = await evaluateScamRules(msg);
    expect(res.flagged).toBe(false);
    expect(res.reason).toBeUndefined();
  });
});
