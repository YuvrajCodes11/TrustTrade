import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../plugins/auth.js';
import { prisma } from '../../db/prisma.js';
import { calculateTrustScore } from './trust-score.js';
import { AppError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { createRateLimiter } from '../../plugins/rate-limit.js';

const reportRateLimiter = createRateLimiter({
  keyPrefix: 'report',
  limit: 5,
  windowSeconds: 3600,
  message: 'Maximum 5 reports allowed per hour.',
  useUserId: true,
});

const reportSchema = z.object({
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(2000),
  conversationId: z.string().uuid().optional(),
});

export async function userRoutes(fastify: FastifyInstance) {
  fastify.get('/me', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        phone: true,
        phoneVerifiedAt: true,
        kycStatus: true,
        banned: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User profile not found');
    }

    const trustScore = await calculateTrustScore(userId);

    return reply.status(200).send({
      user: {
        ...user,
        trustScore,
      },
    });
  });

  fastify.get('/me/blocks', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.id;

    const blocks = await prisma.block.findMany({
      where: { blockerId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        blocked: { select: { id: true, name: true, kycStatus: true } },
      },
    });

    return reply.status(200).send({ blocks });
  });

  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        kycStatus: true,
        createdAt: true,
        banned: true,
        receivedReviews: {
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            reviewer: {
              select: { id: true, name: true, kycStatus: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user || user.banned) {
      throw new NotFoundError('User profile not found');
    }

    const trustScore = await calculateTrustScore(id);

    return reply.status(200).send({
      user: {
        id: user.id,
        name: user.name,
        kycStatus: user.kycStatus,
        createdAt: user.createdAt,
        trustScore,
        reviews: user.receivedReviews,
      },
    });
  });

  fastify.post('/:id/report', { preHandler: [authenticate, reportRateLimiter] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id: reportedUserId } = paramsSchema.parse(request.params);
    const reporterId = request.user!.id;
    const body = reportSchema.parse(request.body);

    if (reporterId === reportedUserId) {
      throw new AppError('You cannot report your own account', 400, 'SELF_REPORT_BLOCKED');
    }

    const reportedUser = await prisma.user.findUnique({ where: { id: reportedUserId } });
    if (!reportedUser) {
      throw new NotFoundError('User to report not found');
    }

    if (body.conversationId) {
      const convo = await prisma.conversation.findUnique({ where: { id: body.conversationId } });
      if (!convo || (convo.buyerId !== reporterId && convo.sellerId !== reporterId)) {
        throw new ForbiddenError('You can only attach conversations you were party to');
      }
    }

    const report = await prisma.report.create({
      data: {
        reporterId,
        reportedUserId,
        reason: body.reason,
        relatedConversationId: body.conversationId || null,
        status: 'OPEN',
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: reporterId,
        action: 'REPORT_USER',
        targetType: 'User',
        targetId: reportedUserId,
        metadata: { reason: body.reason, conversationId: body.conversationId },
      },
    });

    return reply.status(201).send({
      message: 'Report submitted successfully. Moderation will review the case.',
      report,
    });
  });

  fastify.post('/:id/block', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id: blockedId } = paramsSchema.parse(request.params);
    const blockerId = request.user!.id;

    if (blockerId === blockedId) {
      throw new AppError('You cannot block your own account', 400, 'SELF_BLOCK_BLOCKED');
    }

    const targetUser = await prisma.user.findUnique({ where: { id: blockedId } });
    if (!targetUser) {
      throw new NotFoundError('User to block not found');
    }

    const block = await prisma.block.upsert({
      where: {
        blockerId_blockedId: { blockerId, blockedId },
      },
      update: {},
      create: { blockerId, blockedId },
    });

    await prisma.auditLog.create({
      data: {
        actorId: blockerId,
        action: 'BLOCK_USER',
        targetType: 'User',
        targetId: blockedId,
      },
    });

    return reply.status(200).send({
      message: 'User blocked successfully',
      block,
    });
  });

  fastify.delete('/:id/block', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id: blockedId } = paramsSchema.parse(request.params);
    const blockerId = request.user!.id;

    try {
      await prisma.block.delete({
        where: {
          blockerId_blockedId: { blockerId, blockedId },
        },
      });
    } catch (e) {
      // Block record didn't exist, ignore
    }

    await prisma.auditLog.create({
      data: {
        actorId: blockerId,
        action: 'UNBLOCK_USER',
        targetType: 'User',
        targetId: blockedId,
      },
    });

    return reply.status(200).send({
      message: 'User unblocked successfully',
    });
  });
}
