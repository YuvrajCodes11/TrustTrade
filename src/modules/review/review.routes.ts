import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../plugins/auth.js';
import { prisma } from '../../db/prisma.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { createRateLimiter } from '../../plugins/rate-limit.js';

const reviewRateLimiter = createRateLimiter({
  keyPrefix: 'review',
  limit: 10,
  windowSeconds: 3600,
  message: 'Maximum 10 reviews submitted per hour.',
  useUserId: true,
});

const createReviewSchema = z.object({
  transactionId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export async function reviewRoutes(fastify: FastifyInstance) {
  /**
   * POST /reviews
   */
  fastify.post('/', { preHandler: [authenticate, reviewRateLimiter] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.id;
    const body = createReviewSchema.parse(request.body);

    const tx = await prisma.transaction.findUnique({ where: { id: body.transactionId } });
    if (!tx) {
      throw new NotFoundError('Transaction not found');
    }

    if (tx.status !== 'COMPLETED') {
      throw new AppError('Reviews can only be submitted for completed transactions', 400, 'TRANSACTION_NOT_COMPLETED');
    }

    if (tx.buyerId !== userId && tx.sellerId !== userId) {
      throw new ForbiddenError('You can only review transactions you were party to');
    }

    const revieweeId = tx.buyerId === userId ? tx.sellerId : tx.buyerId;

    // Check unique constraint (transactionId, reviewerId)
    const existing = await prisma.review.findUnique({
      where: {
        transactionId_reviewerId: {
          transactionId: body.transactionId,
          reviewerId: userId,
        },
      },
    });

    if (existing) {
      throw new ConflictError('You have already submitted a review for this transaction');
    }

    const review = await prisma.review.create({
      data: {
        transactionId: body.transactionId,
        reviewerId: userId,
        revieweeId,
        rating: body.rating,
        comment: body.comment || null,
      },
    });

    return reply.status(201).send({
      message: 'Review submitted successfully',
      review,
    });
  });
}
