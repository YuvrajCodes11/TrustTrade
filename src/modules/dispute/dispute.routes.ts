import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../plugins/auth.js';
import { prisma } from '../../db/prisma.js';
import { AppError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { createRateLimiter } from '../../plugins/rate-limit.js';

const disputeRateLimiter = createRateLimiter({
  keyPrefix: 'dispute',
  limit: 5,
  windowSeconds: 3600,
  message: 'Maximum 5 disputes opened per hour.',
  useUserId: true,
});

const createDisputeSchema = z.object({
  transactionId: z.string().uuid(),
  reason: z.string().min(10).max(2000),
});

export async function disputeRoutes(fastify: FastifyInstance) {
  /**
   * POST /disputes
   * Enforces server-side 48-hour dispute window
   */
  fastify.post('/', { preHandler: [authenticate, disputeRateLimiter] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.id;
    const body = createDisputeSchema.parse(request.body);

    const tx = await prisma.transaction.findUnique({ where: { id: body.transactionId } });
    if (!tx) {
      throw new NotFoundError('Transaction not found');
    }

    // Party to transaction check (Section 4 Authorization)
    if (tx.buyerId !== userId && tx.sellerId !== userId) {
      throw new ForbiddenError('You can only raise disputes for transactions you were party to');
    }

    if (tx.status !== 'COMPLETED' || !tx.completedAt) {
      throw new AppError('Disputes can only be opened for completed transactions', 400, 'TRANSACTION_NOT_COMPLETED');
    }

    // Enforce 48-hour window server-side
    const now = Date.now();
    const completedTime = new Date(tx.completedAt).getTime();
    const hoursElapsed = (now - completedTime) / (1000 * 60 * 60);

    if (hoursElapsed > 48) {
      throw new AppError(
        `Dispute window expired. Disputes must be opened within 48 hours of trade completion (elapsed: ${hoursElapsed.toFixed(
          1
        )}h)`,
        400,
        'DISPUTE_WINDOW_EXPIRED'
      );
    }

    // Check existing dispute
    const existing = await prisma.dispute.findFirst({
      where: { transactionId: body.transactionId },
    });

    if (existing) {
      throw new AppError('A dispute has already been raised for this transaction', 400, 'DISPUTE_ALREADY_EXISTS');
    }

    const dispute = await prisma.dispute.create({
      data: {
        transactionId: body.transactionId,
        raisedById: userId,
        reason: body.reason,
        status: 'OPEN',
      },
    });

    // Update transaction status to DISPUTED
    await prisma.transaction.update({
      where: { id: body.transactionId },
      data: { status: 'DISPUTED' },
    });

    return reply.status(201).send({
      message: 'Dispute opened successfully. A moderator will review the case.',
      dispute,
    });
  });

  /**
   * GET /disputes
   */
  fastify.get('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.id;

    const disputes = await prisma.dispute.findMany({
      where: {
        OR: [
          { raisedById: userId },
          { transaction: { buyerId: userId } },
          { transaction: { sellerId: userId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        transaction: {
          select: { id: true, listingId: true, amountInr: true, status: true },
        },
        raisedBy: { select: { id: true, name: true } },
      },
    });

    return reply.status(200).send({
      disputes,
    });
  });

  /**
   * GET /disputes/:id
   */
  fastify.get('/:id', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const userId = request.user!.id;

    const dispute = await prisma.dispute.findUnique({
      where: { id },
      include: {
        transaction: true,
        raisedBy: { select: { id: true, name: true, phone: true } },
      },
    });

    if (!dispute) {
      throw new NotFoundError('Dispute not found');
    }

    if (
      dispute.raisedById !== userId &&
      dispute.transaction.buyerId !== userId &&
      dispute.transaction.sellerId !== userId
    ) {
      const isAdmin = await prisma.adminRole.findUnique({ where: { userId } });
      if (!isAdmin) {
        throw new ForbiddenError('You do not have access to this dispute');
      }
    }

    return reply.status(200).send({
      dispute,
    });
  });
}
