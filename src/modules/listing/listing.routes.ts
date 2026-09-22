import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../plugins/auth.js';
import { prisma } from '../../db/prisma.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { calculateTrustScore } from '../user/trust-score.js';
import { createRateLimiter } from '../../plugins/rate-limit.js';

const createListingLimiter = createRateLimiter({
  keyPrefix: 'create_listing',
  limit: 10,
  windowSeconds: 3600,
  message: 'Maximum 10 listings created per hour.',
  useUserId: true,
});

const createListingSchema = z.object({
  title: z.string().min(3).max(120),
  category: z.enum(['ELECTRONICS', 'FURNITURE', 'VEHICLES', 'APPLIANCES', 'OTHER']),
  priceInr: z.number().int().positive(),
  condition: z.enum(['NEW', 'USED_LIKE_NEW', 'USED_GOOD', 'FOR_PARTS']),
  description: z.string().min(10).max(2000),
  photoUrls: z.array(z.string().url()).optional().default([]),
  protectRecommended: z.boolean().optional().default(false),
});

const updateListingSchema = createListingSchema.partial().extend({
  status: z.enum(['ACTIVE', 'SOLD', 'REMOVED']).optional(),
});

const querySchema = z.object({
  category: z.enum(['ELECTRONICS', 'FURNITURE', 'VEHICLES', 'APPLIANCES', 'OTHER']).optional(),
  sellerId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'SOLD', 'REMOVED']).optional().default('ACTIVE'),
  page: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 1)),
  limit: z.string().optional().transform((v) => (v ? Math.min(parseInt(v, 10), 50) : 20)),
});

export async function listingRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = querySchema.parse(request.query);
    const skip = (query.page - 1) * query.limit;

    const where: any = { status: query.status };
    if (query.category) where.category = query.category;
    if (query.sellerId) where.sellerId = query.sellerId;

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          seller: {
            select: {
              id: true,
              name: true,
              kycStatus: true,
              createdAt: true,
            },
          },
        },
      }),
      prisma.listing.count({ where }),
    ]);

    const formattedListings = await Promise.all(
      listings.map(async (l: any) => {
        const trustScore = await calculateTrustScore(l.seller.id);
        return {
          ...l,
          seller: {
            ...l.seller,
            trustScore,
            verified: l.seller.kycStatus === 'VERIFIED',
          },
        };
      })
    );

    return reply.status(200).send({
      listings: formattedListings,
      pagination: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  });

  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const listing = await prisma.listing.findUnique({
      where: { id },
      include: {
        seller: {
          select: {
            id: true,
            name: true,
            kycStatus: true,
            createdAt: true,
          },
        },
      },
    });

    if (!listing) {
      throw new NotFoundError('Listing not found');
    }

    const trustScore = await calculateTrustScore(listing.seller.id);

    return reply.status(200).send({
      listing: {
        ...listing,
        seller: {
          ...listing.seller,
          trustScore,
          verified: listing.seller.kycStatus === 'VERIFIED',
        },
      },
    });
  });

  fastify.post('/', { preHandler: [authenticate, createListingLimiter] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.id;
    const body = createListingSchema.parse(request.body);

    const listing = await prisma.listing.create({
      data: {
        ...body,
        sellerId: userId,
        status: 'ACTIVE',
      },
    });

    return reply.status(201).send({
      message: 'Listing created successfully',
      listing,
    });
  });

  fastify.patch('/:id', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const userId = request.user!.id;
    const body = updateListingSchema.parse(request.body);

    const existing = await prisma.listing.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Listing not found');
    }

    if (existing.sellerId !== userId) {
      throw new ForbiddenError('You can only modify your own listings');
    }

    const updated = await prisma.listing.update({
      where: { id },
      data: body,
    });

    return reply.status(200).send({
      message: 'Listing updated successfully',
      listing: updated,
    });
  });

  fastify.delete('/:id', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const userId = request.user!.id;

    const existing = await prisma.listing.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Listing not found');
    }

    const isAdmin = await prisma.adminRole.findUnique({ where: { userId } });

    if (existing.sellerId !== userId && !isAdmin) {
      throw new ForbiddenError('You do not have permission to delete this listing');
    }

    await prisma.listing.update({
      where: { id },
      data: { status: 'REMOVED' },
    });

    return reply.status(200).send({
      message: 'Listing removed successfully',
    });
  });

  fastify.post('/import-url', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const importSchema = z.object({ url: z.string().url() });
    const { url } = importSchema.parse(request.body);

    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'TrustTradeBot/1.0' } });
      const html = await res.text();

      const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
      const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/i);
      const imageMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);

      return reply.status(200).send({
        imported: {
          title: titleMatch ? titleMatch[1] : 'Imported Resale Item',
          description: descMatch ? descMatch[1] : '',
          photoUrls: imageMatch ? [imageMatch[1]] : [],
          sourceUrl: url,
        },
      });
    } catch (err: any) {
      return reply.status(200).send({
        imported: {
          title: 'External Listing',
          description: `Imported from: ${url}`,
          photoUrls: [],
          sourceUrl: url,
        },
      });
    }
  });
}
