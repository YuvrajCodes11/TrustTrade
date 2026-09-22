import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let lastLoggedErrorTime = 0;

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  retryStrategy(times) {
    if (times > 5) {
      // Stop retrying endlessly when Redis is unreachable
      return null;
    }
    return Math.min(times * 200, 2000);
  },
});

redis.on('error', (err) => {
  const now = Date.now();
  // Throttle error logging to at most once every 10 seconds to prevent console spam
  if (now - lastLoggedErrorTime > 10000) {
    lastLoggedErrorTime = now;
    logger.warn({ msg: 'Redis connection issue', error: err.message });
  }
});

redis.on('connect', () => {
  logger.info({ msg: 'Connected to Redis' });
});
