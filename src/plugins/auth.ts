import { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { logger } from '../config/logger.js';

export interface UserPayload {
  id: string;
  phone: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserPayload;
  }
}

export function generateAccessToken(payload: UserPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
}

export function generateRefreshToken(payload: UserPayload & { tokenId: string }): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
}

export function verifyAccessToken(token: string): UserPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as UserPayload;
  } catch (err: any) {
    logger.info({ msg: 'Access token verification failed', error: err.message });
    throw new UnauthorizedError('Invalid or expired access token');
  }
}

export function verifyRefreshToken(token: string): UserPayload & { tokenId: string } {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET) as UserPayload & { tokenId: string };
  } catch (err: any) {
    logger.info({ msg: 'Refresh token verification failed', error: err.message });
    throw new UnauthorizedError('Invalid or expired refresh token');
  }
}

/**
 * Fastify middleware guard to authenticate requests via Bearer token
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }

  const token = authHeader.substring(7);
  const payload = verifyAccessToken(token);

  // Check if user is banned
  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: { banned: true, bannedReason: true },
  });

  if (!user) {
    throw new UnauthorizedError('User account not found');
  }

  if (user.banned) {
    throw new ForbiddenError(`Account banned: ${user.bannedReason || 'Violation of terms'}`);
  }

  request.user = { id: payload.id, phone: payload.phone };
}

/**
 * Fastify middleware guard to enforce admin privileges via admin_roles table
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    throw new UnauthorizedError('Authentication required');
  }

  const adminRole = await prisma.adminRole.findUnique({
    where: { userId: request.user.id },
  });

  if (!adminRole) {
    logger.warn({
      msg: 'Admin authorization check failed',
      userId: request.user.id,
      url: request.raw.url,
    });
    throw new ForbiddenError('Admin privileges required');
  }
}
