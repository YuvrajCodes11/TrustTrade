import { prisma } from '../../db/prisma.js';

export async function calculateTrustScore(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      receivedReviews: true,
      sellerTxs: { where: { status: 'COMPLETED' } },
      buyerTxs: { where: { status: 'COMPLETED' } },
    },
  });

  if (!user) return 0;

  let score = 0;

  if (user.kycStatus === 'VERIFIED') {
    score += 35;
  }

  const completedTradeCount = user.sellerTxs.length + user.buyerTxs.length;
  score += Math.min(completedTradeCount * 6, 30);

  if (user.receivedReviews.length > 0) {
    const avgRating =
      user.receivedReviews.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) /
      user.receivedReviews.length;
    score += Math.round(avgRating * 6);
  }

  const disputesAgainst = await prisma.dispute.findMany({
    where: {
      transaction: {
        OR: [{ sellerId: userId }, { buyerId: userId }],
      },
      raisedById: { not: userId },
      status: { in: ['OPEN', 'INVESTIGATING', 'RESOLVED_BUYER', 'RESOLVED_SELLER'] },
    },
  });
  score -= disputesAgainst.length * 12;

  const daysOld = (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysOld > 30) {
    score += 5;
  }

  return Math.max(0, Math.min(100, score));
}
