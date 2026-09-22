import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../../plugins/auth.js';
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';
import { createRateLimiter } from '../../plugins/rate-limit.js';

const adminRateLimiter = createRateLimiter({
  keyPrefix: 'admin',
  limit: 60,
  windowSeconds: 60,
  message: 'Admin rate limit exceeded. Maximum 60 requests per minute.',
  useUserId: true,
});

const banUserSchema = z.object({
  banned: z.boolean(),
  reason: z.string().optional(),
});

const resolveDisputeSchema = z.object({
  resolution: z.enum(['RESOLVED_BUYER', 'RESOLVED_SELLER']),
  notes: z.string().min(5),
});

const scamRuleSchema = z.object({
  pattern: z.string().min(3),
  reason: z.string().min(5),
  active: z.boolean().default(true),
});

export async function adminRoutes(fastify: FastifyInstance) {
  // Apply authentication, admin privilege, and rate limiting on all admin routes
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireAdmin);
  fastify.addHook('preHandler', adminRateLimiter);

  /**
   * GET /admin/audit-logs
   */
  fastify.get('/audit-logs', async (request: FastifyRequest, reply: FastifyReply) => {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        actor: { select: { id: true, name: true, phone: true } },
      },
    });

    return reply.status(200).send({ auditLogs: logs });
  });

  /**
   * GET /admin/flagged-messages
   */
  fastify.get('/flagged-messages', async (request: FastifyRequest, reply: FastifyReply) => {
    const messages = await prisma.message.findMany({
      where: { flagged: true },
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { id: true, name: true, phone: true, kycStatus: true } },
        conversation: { select: { listingId: true, buyerId: true, sellerId: true } },
      },
    });

    return reply.status(200).send({ flaggedMessages: messages });
  });

  /**
   * GET /admin/reports
   */
  fastify.get('/reports', async (request: FastifyRequest, reply: FastifyReply) => {
    const reports = await prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { id: true, name: true, phone: true } },
        reportedUser: { select: { id: true, name: true, phone: true, kycStatus: true, banned: true } },
        relatedConversation: { select: { id: true, listingId: true } },
      },
    });

    return reply.status(200).send({ reports });
  });

  /**
   * POST /admin/users/:id/ban
   * Ban/unban user & write AuditLog
   */
  fastify.post('/users/:id/ban', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const adminId = request.user!.id;
    const body = banUserSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        banned: body.banned,
        bannedReason: body.banned ? body.reason || 'Banned by moderator' : null,
      },
    });

    // Mandatory AuditLog write (Section 4 & 30)
    await prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: body.banned ? 'BAN_USER' : 'UNBAN_USER',
        targetType: 'User',
        targetId: id,
        metadata: {
          banned: body.banned,
          reason: body.reason,
          userPhone: user.phone,
        },
      },
    });

    logger.info({ msg: 'Admin modified user ban status', adminId, targetUserId: id, banned: body.banned });

    return reply.status(200).send({
      message: body.banned ? 'User banned successfully' : 'User unbanned successfully',
      user: updated,
    });
  });

  /**
   * POST /admin/disputes/:id/resolve
   * Resolve dispute & write AuditLog
   */
  fastify.post('/disputes/:id/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const adminId = request.user!.id;
    const body = resolveDisputeSchema.parse(request.body);

    const dispute = await prisma.dispute.findUnique({ where: { id } });
    if (!dispute) {
      throw new NotFoundError('Dispute not found');
    }

    const updatedDispute = await prisma.dispute.update({
      where: { id },
      data: {
        status: body.resolution,
        resolutionNotes: body.notes,
        resolvedById: adminId,
        resolvedAt: new Date(),
      },
    });

    // Update underlying transaction status if applicable
    const txStatus = body.resolution === 'RESOLVED_BUYER' ? 'REFUNDED' : 'COMPLETED';
    await prisma.transaction.update({
      where: { id: dispute.transactionId },
      data: { status: txStatus },
    });

    // Mandatory AuditLog write (Section 4 & 30)
    await prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'RESOLVE_DISPUTE',
        targetType: 'Dispute',
        targetId: id,
        metadata: {
          resolution: body.resolution,
          notes: body.notes,
          transactionId: dispute.transactionId,
        },
      },
    });

    logger.info({ msg: 'Admin resolved dispute', adminId, disputeId: id, resolution: body.resolution });

    return reply.status(200).send({
      message: 'Dispute resolved successfully',
      dispute: updatedDispute,
    });
  });

  /**
   * GET /admin/scam-rules
   */
  fastify.get('/scam-rules', async (request: FastifyRequest, reply: FastifyReply) => {
    const rules = await prisma.scamRule.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return reply.status(200).send({ scamRules: rules });
  });

  /**
   * POST /admin/scam-rules
   * Add/edit scam pattern & write AuditLog
   */
  fastify.post('/scam-rules', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminId = request.user!.id;
    const body = scamRuleSchema.parse(request.body);

    const rule = await prisma.scamRule.create({
      data: {
        pattern: body.pattern,
        reason: body.reason,
        active: body.active,
      },
    });

    // Mandatory AuditLog write (Section 4 & 30)
    await prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'CREATE_SCAM_RULE',
        targetType: 'ScamRule',
        targetId: rule.id,
        metadata: {
          pattern: body.pattern,
          reason: body.reason,
        },
      },
    });

    logger.info({ msg: 'Admin created scam rule', adminId, ruleId: rule.id });

    return reply.status(201).send({
      message: 'Scam detection rule created successfully',
      scamRule: rule,
    });
  });
}
