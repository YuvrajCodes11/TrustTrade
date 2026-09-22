import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger.js';

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

(prisma as any).$on('error', (e: any) => {
  logger.error({ msg: 'Prisma DB Error', error: e.message });
});

(prisma as any).$on('warn', (e: any) => {
  logger.warn({ msg: 'Prisma DB Warning', warning: e.message });
});
