import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './db/prisma.js';
import { redis } from './db/redis.js';

let app: ReturnType<typeof buildApp> | null = null;

async function startServer() {
  app = buildApp();

  try {
    // Attempt initial connect to Redis
    try {
      await redis.connect();
    } catch (e: any) {
      logger.warn({ msg: 'Redis initial connection pending or unreachable', error: e.message });
    }

    await app.listen({ port: env.PORT, host: env.HOST });
    logger.info({ msg: `TrustTrade Backend Server running on http://${env.HOST}:${env.PORT}` });
  } catch (err: any) {
    if (err.code === 'EADDRINUSE') {
      logger.fatal({
        msg: `Port ${env.PORT} is already in use by another process. Is another instance of TrustTrade already running?`,
      });
    } else {
      logger.fatal({ msg: 'Failed to start server', error: err.message });
    }
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  logger.info({ msg: `Received ${signal}, shutting down gracefully...` });

  if (app) {
    try {
      await app.close();
    } catch (e: any) {
      logger.error({ msg: 'Error closing Fastify server', error: e.message });
    }
  }

  try {
    await prisma.$disconnect();
  } catch (e: any) {
    logger.error({ msg: 'Error disconnecting Prisma', error: e.message });
  }

  try {
    redis.disconnect();
  } catch (e: any) {
    logger.error({ msg: 'Error disconnecting Redis', error: e.message });
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer();
