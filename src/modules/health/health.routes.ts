import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../db/prisma.js';
import { redis } from '../../db/redis.js';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    let dbStatus = 'ok';
    let redisStatus = 'ok';

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (e: any) {
      dbStatus = `error: ${e.message}`;
    }

    try {
      await redis.ping();
    } catch (e: any) {
      redisStatus = `error: ${e.message}`;
    }

    const healthy = dbStatus === 'ok' && redisStatus === 'ok';

    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'UP' : 'DOWN',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
    });
  });
}
