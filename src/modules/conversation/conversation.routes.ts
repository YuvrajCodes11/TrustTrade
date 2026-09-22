import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../plugins/auth.js';
import { prisma } from '../../db/prisma.js';
import { evaluateScamRules } from '../message/scam-engine.js';
import { AppError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { createRateLimiter } from '../../plugins/rate-limit.js';

const createConvoSchema = z.object({
  listingId: z.string().uuid(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1).max(2000),
});

const messageRateLimiter = createRateLimiter({
  keyPrefix: 'message',
  limit: 30,
  windowSeconds: 60,
  message: 'Too many messages sent. Please wait a minute before sending more.',
  useUserId: true,
});

export async function conversationRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.id;

    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        listing: {
          select: { id: true, title: true, priceInr: true, category: true, status: true },
        },
        buyer: { select: { id: true, name: true, kycStatus: true } },
        seller: { select: { id: true, name: true, kycStatus: true } },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { content: true, flagged: true, createdAt: true },
        },
      },
    });

    return reply.status(200).send({
      conversations,
    });
  });

  fastify.post('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.id;
    const body = createConvoSchema.parse(request.body);

    const listing = await prisma.listing.findUnique({ where: { id: body.listingId } });
    if (!listing || listing.status === 'REMOVED') {
      throw new NotFoundError('Listing not found or removed');
    }

    if (listing.sellerId === userId) {
      throw new AppError('You cannot message yourself on your own listing', 400, 'SELF_MESSAGE_BLOCKED');
    }

    // Block check: check if either buyer or seller has blocked the other
    const isBlocked = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: listing.sellerId },
          { blockerId: listing.sellerId, blockedId: userId },
        ],
      },
    });

    if (isBlocked) {
      throw new ForbiddenError('Communication is blocked between these accounts');
    }

    let conversation = await prisma.conversation.findUnique({
      where: {
        listingId_buyerId: {
          listingId: body.listingId,
          buyerId: userId,
        },
      },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          listingId: body.listingId,
          buyerId: userId,
          sellerId: listing.sellerId,
        },
      });
    }

    return reply.status(200).send({
      conversation,
    });
  });

  fastify.get('/:id/messages', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const userId = request.user!.id;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }

    if (conversation.buyerId !== userId && conversation.sellerId !== userId) {
      throw new ForbiddenError('You do not have access to messages in this conversation');
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });

    return reply.status(200).send({
      messages,
    });
  });

  fastify.post('/:id/messages', { preHandler: [authenticate, messageRateLimiter] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const userId = request.user!.id;
    const body = sendMessageSchema.parse(request.body);

    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }

    if (conversation.buyerId !== userId && conversation.sellerId !== userId) {
      throw new ForbiddenError('You do not have access to send messages in this conversation');
    }

    // Block check: check if communication is blocked between participants
    const isBlocked = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: conversation.buyerId, blockedId: conversation.sellerId },
          { blockerId: conversation.sellerId, blockedId: conversation.buyerId },
        ],
      },
    });

    if (isBlocked) {
      throw new ForbiddenError('You cannot send messages because communication is blocked');
    }

    const scanResult = await evaluateScamRules(body.content);

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        senderId: userId,
        content: body.content,
        flagged: scanResult.flagged,
        flagReason: scanResult.reason || null,
      },
    });

    return reply.status(201).send({
      message,
      scanWarning: scanResult.flagged
        ? {
            flagged: true,
            reason: scanResult.reason,
          }
        : undefined,
    });
  });
}
