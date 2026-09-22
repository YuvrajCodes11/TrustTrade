import { FastifyReply, FastifyRequest } from 'fastify';
import { redis } from '../db/redis.js';
import { RateLimitError } from '../utils/errors.js';
import { logger } from '../config/logger.js';

interface RateLimitOptions {
  keyPrefix: string;
  limit: number;
  windowSeconds: number;
  message: string;
  useUserId?: boolean;
}

/**
 * Creates a Fastify preHandler hook for Redis-backed rate limiting
 */
export function createRateLimiter(options: RateLimitOptions) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const identifier = options.useUserId && request.user ? request.user.id : request.ip;
    const redisKey = `ratelimit:${options.keyPrefix}:${identifier}`;

    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, options.windowSeconds);
    }

    if (count > options.limit) {
      logger.warn({
        msg: 'Rate limit exceeded',
        keyPrefix: options.keyPrefix,
        identifier,
        limit: options.limit,
        windowSeconds: options.windowSeconds,
      });
      throw new RateLimitError(options.message);
    }
  };
}
