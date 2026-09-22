import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../plugins/auth.js';
import { prisma } from '../../db/prisma.js';
import { getKycService } from '../../services/kyc.service.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';

const kycVerifySchema = z.object({
  idDocumentType: z.enum(['AADHAAR', 'PAN', 'DRIVING_LICENSE']).optional(),
  documentNumber: z.string().optional(),
});

export async function kycRoutes(fastify: FastifyInstance) {
  fastify.post('/verify', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.id;
    const body = kycVerifySchema.parse(request.body || {});

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError('User not found', 404, 'NOT_FOUND');
    }

    if (user.kycStatus === 'VERIFIED') {
      return reply.status(200).send({
        message: 'Account is already verified',
        kycStatus: 'VERIFIED',
      });
    }

    const kycService = getKycService();
    const result = await kycService.verifyIdentity(userId, body);

    if (!result.success || result.status !== 'VERIFIED') {
      logger.warn({ msg: 'KYC verification failed or rejected', userId, reason: result.reason });

      await prisma.user.update({
        where: { id: userId },
        data: { kycStatus: 'REJECTED' },
      });

      return reply.status(400).send({
        error: {
          code: 'KYC_VERIFICATION_FAILED',
          message: result.reason || 'Identity verification could not be completed',
        },
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        kycStatus: 'VERIFIED',
        kycProviderRef: result.vendorRef,
        phoneVerifiedAt: user.phoneVerifiedAt || new Date(),
      },
    });

    logger.info({ msg: 'User KYC successfully verified', userId });

    return reply.status(200).send({
      message: 'KYC verification successful',
      kycStatus: updatedUser.kycStatus,
      verifiedAt: updatedUser.phoneVerifiedAt,
    });
  });
}
