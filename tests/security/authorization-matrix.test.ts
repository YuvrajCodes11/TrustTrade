import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/plugins/auth.js';
import { prisma } from '../../src/db/prisma.js';

vi.mock('../../src/db/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    listing: {
      findUnique: vi.fn(),
    },
    conversation: {
      findUnique: vi.fn(),
    },
    transaction: {
      findUnique: vi.fn(),
    },
    dispute: {
      findUnique: vi.fn(),
    },
    adminRole: {
      findUnique: vi.fn(),
    },
    block: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

describe('MANDATORY SECTION 4 — Authorization Security Matrix Tests', () => {
  let app: any;
  let request: any;

  const userA = { id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', phone: '+919000000001', banned: false };
  const userB = { id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', phone: '+919000000002', banned: false };
  const tokenA = generateAccessToken({ id: userA.id, phone: userA.phone });

  const listingB = {
    id: '11111111-1111-4111-a111-111111111111',
    sellerId: userB.id,
    title: "User B's Listing",
    status: 'ACTIVE',
  };
  const conversationB = {
    id: '22222222-2222-4222-a222-222222222222',
    buyerId: userB.id,
    sellerId: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
  };
  const transactionB = {
    id: '33333333-3333-4333-a333-333333333333',
    buyerId: userB.id,
    sellerId: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
    status: 'COMPLETED',
  };
  const disputeB = {
    id: '44444444-4444-4444-a444-444444444444',
    transactionId: transactionB.id,
    raisedById: userB.id,
  };

  beforeEach(async () => {
    app = buildApp();
    await app.ready();
    request = supertest(app.server);

    vi.clearAllMocks();

    // Mock user lookup
    (prisma.user.findUnique as any).mockImplementation(({ where }: any) => {
      if (where.id === userA.id) return Promise.resolve(userA);
      if (where.id === userB.id) return Promise.resolve(userB);
      return Promise.resolve(null);
    });

    (prisma.listing.findUnique as any).mockImplementation(({ where }: any) => {
      if (where.id === listingB.id) return Promise.resolve(listingB);
      return Promise.resolve(null);
    });

    (prisma.conversation.findUnique as any).mockImplementation(({ where }: any) => {
      if (where.id === conversationB.id) return Promise.resolve(conversationB);
      return Promise.resolve(null);
    });

    (prisma.transaction.findUnique as any).mockImplementation(({ where }: any) => {
      if (where.id === transactionB.id) return Promise.resolve(transactionB);
      return Promise.resolve(null);
    });

    (prisma.dispute.findUnique as any).mockImplementation(({ where }: any) => {
      if (where.id === disputeB.id) return Promise.resolve(disputeB);
      return Promise.resolve(null);
    });

    // User A is NOT an admin
    (prisma.adminRole.findUnique as any).mockImplementation(() => Promise.resolve(null));
    (prisma.block.findFirst as any).mockImplementation(() => Promise.resolve(null));
  });

  it('ASSERT 403: User A cannot PATCH (update) User B listing', async () => {
    const res = await request
      .patch(`/listings/${listingB.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Hacked Title by User A' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ASSERT 403: User A cannot DELETE User B listing', async () => {
    const res = await request
      .delete(`/listings/${listingB.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ASSERT 403: User A cannot read messages in User B conversation', async () => {
    const res = await request
      .get(`/conversations/${conversationB.id}/messages`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ASSERT 403: User A cannot POST message into User B conversation', async () => {
    const res = await request
      .post(`/conversations/${conversationB.id}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'Unauthorized message from A' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ASSERT 403: User A cannot PATCH (complete) User B transaction', async () => {
    const res = await request
      .patch(`/transactions/${transactionB.id}/complete`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ASSERT 403: User A cannot raise dispute on User B transaction', async () => {
    const res = await request
      .post('/disputes')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ transactionId: transactionB.id, reason: 'Malicious dispute' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ASSERT 403: Non-admin User A cannot access /admin/audit-logs', async () => {
    const res = await request
      .get('/admin/audit-logs')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ASSERT 403: Non-admin User A cannot ban User B', async () => {
    const res = await request
      .post(`/admin/users/${userB.id}/ban`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ banned: true, reason: 'Malicious ban attempt' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ASSERT 403: Non-admin User A cannot access /admin/reports', async () => {
    const res = await request
      .get('/admin/reports')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ASSERT 403: Blocked communication prevents starting conversations', async () => {
    (prisma.block.findFirst as any).mockResolvedValueOnce({ id: 'block-1', blockerId: userB.id, blockedId: userA.id });

    const res = await request
      .post('/conversations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ listingId: listingB.id });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
