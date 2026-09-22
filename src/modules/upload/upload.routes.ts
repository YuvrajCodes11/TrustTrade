import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../plugins/auth.js';
import { storageService } from '../../services/storage.service.js';

const uploadUrlSchema = z.object({
  fileType: z.string(),
  fileSizeBytes: z.number().positive(),
});

export async function uploadRoutes(fastify: FastifyInstance) {
  fastify.post('/presigned-url', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.id;
    const body = uploadUrlSchema.parse(request.body);

    const result = await storageService.generatePresignedUploadUrl(userId, body.fileType, body.fileSizeBytes);

    return reply.status(200).send({
      uploadUrl: result.uploadUrl,
      fileKey: result.fileKey,
      publicUrl: result.publicUrl,
    });
  });
}
