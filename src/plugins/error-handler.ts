import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../config/logger.js';

export function setupErrorHandler(fastify: any) {
  fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    // 1. AppError (Custom application errors)
    if (error instanceof AppError) {
      if (error.statusCode === 403) {
        logger.warn({
          msg: 'Authorization Failure (403)',
          url: request.raw.url,
          method: request.raw.method,
          userId: (request as any).user?.id,
          reason: error.message,
        });
      }
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // 2. Zod Validation Errors
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const message = issue ? `${issue.path.join('.')}: ${issue.message}` : 'Validation error';
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message,
        },
      });
    }

    // 3. Fastify Validation / Rate Limit / Parse Errors
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      const code =
        error.statusCode === 429
          ? 'TOO_MANY_REQUESTS'
          : error.statusCode === 401
          ? 'UNAUTHORIZED'
          : error.statusCode === 403
          ? 'FORBIDDEN'
          : error.statusCode === 404
          ? 'NOT_FOUND'
          : 'BAD_REQUEST';

      if (error.statusCode === 403) {
        logger.warn({
          msg: 'Authorization Failure (403)',
          url: request.raw.url,
          method: request.raw.method,
          userId: (request as any).user?.id,
        });
      }

      return reply.status(error.statusCode).send({
        error: {
          code,
          message: error.message || 'Client error',
        },
      });
    }

    // 4. Unexpected / 5xx Server Errors
    logger.error({
      msg: 'Internal Server Error (5xx)',
      url: request.raw.url,
      method: request.raw.method,
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack,
    });

    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected internal server error occurred. Please try again later.',
      },
    });
  });
}
