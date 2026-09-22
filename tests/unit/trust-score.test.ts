import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateTrustScore } from '../../src/modules/user/trust-score.ts';
import { prisma } from '../../src/db/prisma.js';

vi.mock('../../src/db/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    dispute: {
      findMany: vi.fn(),
    },
  },
}));

describe('Trust Score Engine Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 0 for unverified user with no trades or reviews', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u1',
      kycStatus: 'NONE',
      createdAt: new Date(), // New account (< 30 days)
      receivedReviews: [],
      sellerTxs: [],
      buyerTxs: [],
    });
    (prisma.dispute.findMany as any).mockResolvedValue([]);

    const score = await calculateTrustScore('u1');
    expect(score).toBe(0);
  });

  it('should add 35 points for VERIFIED status', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u1',
      kycStatus: 'VERIFIED',
      createdAt: new Date(),
      receivedReviews: [],
      sellerTxs: [],
      buyerTxs: [],
    });
    (prisma.dispute.findMany as any).mockResolvedValue([]);

    const score = await calculateTrustScore('u1');
    expect(score).toBe(35);
  });

  it('should add +6 per completed trade up to cap of 30 points', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u1',
      kycStatus: 'NONE',
      createdAt: new Date(),
      receivedReviews: [],
      sellerTxs: [{ id: 'tx1' }, { id: 'tx2' }, { id: 'tx3' }, { id: 'tx4' }], // 4 trades = +24
      buyerTxs: [{ id: 'tx5' }, { id: 'tx6' }], // 2 trades -> Total 6 trades = 36 points -> capped at 30
    });
    (prisma.dispute.findMany as any).mockResolvedValue([]);

    const score = await calculateTrustScore('u1');
    expect(score).toBe(30);
  });

  it('should add rating multiplier (avg rating × 6)', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u1',
      kycStatus: 'NONE',
      createdAt: new Date(),
      receivedReviews: [{ rating: 5 }, { rating: 4 }], // Avg 4.5 * 6 = 27
      sellerTxs: [],
      buyerTxs: [],
    });
    (prisma.dispute.findMany as any).mockResolvedValue([]);

    const score = await calculateTrustScore('u1');
    expect(score).toBe(27);
  });

  it('should deduct 12 points per dispute against the user', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u1',
      kycStatus: 'VERIFIED', // 35
      createdAt: new Date(),
      receivedReviews: [],
      sellerTxs: [],
      buyerTxs: [],
    });
    (prisma.dispute.findMany as any).mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]); // -24

    const score = await calculateTrustScore('u1');
    expect(score).toBe(11); // 35 - 24 = 11
  });

  it('should clamp score between 0 and 100', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u1',
      kycStatus: 'VERIFIED', // 35
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // +5 (age > 30d)
      receivedReviews: [{ rating: 5 }, { rating: 5 }], // +30
      sellerTxs: Array(10).fill({ id: 'tx' }), // +30 (cap) -> Total 100+ -> clamp to 100
      buyerTxs: [],
    });
    (prisma.dispute.findMany as any).mockResolvedValue([]);

    const score = await calculateTrustScore('u1');
    expect(score).toBe(100);
  });
});
