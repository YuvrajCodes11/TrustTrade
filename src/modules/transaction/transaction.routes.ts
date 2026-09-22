import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../plugins/auth.js';
import { prisma } from '../../db/prisma.js';
import { AppError, ForbiddenError, NotFoundError } from '../../utils/errors.js';

const createTxSchema = z.object({
  listingId: z.string().uuid(),
  buyerId: z.string().uuid().optional(),
});

export async function transactionRoutes(fastify: FastifyInstance) {
  /**
   * POST /transactions
   * Log trade start (ACTIVE)
   */
  fastify.post('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.id;
    const body = createTxSchema.parse(request.body);

    const listing = await prisma.listing.findUnique({ where: { id: body.listingId } });
    if (!listing || listing.status === 'REMOVED') {
      throw new NotFoundError('Listing not found');
    }

    let buyerId = body.buyerId || userId;
    let sellerId = listing.sellerId;

    if (userId === sellerId && !body.buyerId) {
      throw new AppError('As seller, specify buyerId to initiate trade', 400, 'MISSING_BUYER');
    }

    if (buyerId === sellerId) {
      throw new AppError('Buyer and seller cannot be the same account', 400, 'INVALID_PARTICIPANTS');
    }

    // Find existing active transaction
    let existing = await prisma.transaction.findFirst({
      where: {
        listingId: body.listingId,
        buyerId,
        sellerId,
        status: 'ACTIVE',
      },
    });

    if (!existing) {
      existing = await prisma.transaction.create({
        data: {
          listingId: body.listingId,
          buyerId,
          sellerId,
          amountInr: listing.priceInr,
          status: 'ACTIVE',
        },
      });
    }

    return reply.status(200).send({
      transaction: existing,
    });
  });

  /**
   * GET /transactions
   */
  fastify.get('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.id;

    const transactions = await prisma.transaction.findMany({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        listing: { select: { id: true, title: true, priceInr: true } },
        buyer: { select: { id: true, name: true, kycStatus: true } },
        seller: { select: { id: true, name: true, kycStatus: true } },
        reviews: true,
        disputes: true,
      },
    });

    return reply.status(200).send({
      transactions,
    });
  });

  /**
   * GET /transactions/:id
   */
  fastify.get('/:id', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const userId = request.user!.id;

    const tx = await prisma.transaction.findUnique({
      where: { id },
      include: {
        listing: true,
        buyer: { select: { id: true, name: true, kycStatus: true } },
        seller: { select: { id: true, name: true, kycStatus: true } },
        reviews: true,
        disputes: true,
      },
    });

    if (!tx) {
      throw new NotFoundError('Transaction not found');
    }

    if (tx.buyerId !== userId && tx.sellerId !== userId) {
      const isAdmin = await prisma.adminRole.findUnique({ where: { userId } });
      if (!isAdmin) {
        throw new ForbiddenError('You do not have access to this transaction');
      }
    }

    return reply.status(200).send({
      transaction: tx,
    });
  });

  /**
   * PATCH /transactions/:id/complete
   */
  fastify.patch('/:id/complete', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const userId = request.user!.id;

    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx) {
      throw new NotFoundError('Transaction not found');
    }

    if (tx.buyerId !== userId && tx.sellerId !== userId) {
      throw new ForbiddenError('You do not have permission to complete this transaction');
    }

    if (tx.status === 'COMPLETED') {
      return reply.status(200).send({ message: 'Transaction already completed', transaction: tx });
    }

    const updated = await prisma.transaction.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    // Mark listing as sold
    await prisma.listing.update({
      where: { id: tx.listingId },
      data: { status: 'SOLD' },
    });

    return reply.status(200).send({
      message: 'Transaction marked complete',
      transaction: updated,
    });
  });
}
