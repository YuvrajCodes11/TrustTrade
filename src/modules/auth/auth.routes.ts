import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { redis } from '../../db/redis.js';
import { prisma } from '../../db/prisma.js';
import { getSmsService } from '../../services/sms.service.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  authenticate,
} from '../../plugins/auth.js';
import { AppError, RateLimitError, UnauthorizedError } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';

const requestOtpSchema = z.object({
  phone: z
    .string()
    .transform((val) => val.trim().replace(/\s+/g, ''))
    .refine((val) => /^\+?[1-9]\d{9,14}$/.test(val) || /^\d{10}$/.test(val), {
      message: 'Invalid phone number format. Provide a 10-digit number or E.164 string.',
    }),
});

const verifyOtpSchema = z.object({
  phone: z
    .string()
    .transform((val) => val.trim().replace(/\s+/g, '')),
  otp: z.string().length(6, 'OTP must be exactly 6 digits'),
  name: z.string().min(2).optional(),
});

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/otp/request', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = requestOtpSchema.parse(request.body);
    const phone = body.phone.startsWith('+') ? body.phone : `+91${body.phone}`;
    const ip = request.ip;

    const phoneLimitKey = `ratelimit:otp:phone:${phone}`;
    const ipLimitKey = `ratelimit:otp:ip:${ip}`;

    const phoneReqCount = await redis.incr(phoneLimitKey);
    if (phoneReqCount === 1) {
      await redis.expire(phoneLimitKey, 600);
    }
    if (phoneReqCount > 3) {
      logger.warn({ msg: 'OTP rate limit exceeded for phone', phone });
      throw new RateLimitError('Maximum 3 OTP requests allowed per 10 minutes for this phone number');
    }

    const ipReqCount = await redis.incr(ipLimitKey);
    if (ipReqCount === 1) {
      await redis.expire(ipLimitKey, 3600);
    }
    if (ipReqCount > 10) {
      logger.warn({ msg: 'OTP rate limit exceeded for IP', ip });
      throw new RateLimitError('Maximum 10 OTP requests allowed per hour from this IP address');
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpRedisKey = `otp:phone:${phone}`;
    await redis.set(otpRedisKey, otp, 'EX', 300);

    const smsService = getSmsService();
    const sent = await smsService.sendOtp(phone, otp);

    if (!sent) {
      logger.error({ msg: 'SMS delivery failed', phone });
      throw new AppError('Failed to send OTP SMS. Please try again later.', 500, 'SMS_SEND_FAILED');
    }

    return reply.status(200).send({
      message: 'OTP sent successfully',
      phone,
      expiresInSeconds: 300,
    });
  });

  fastify.post('/otp/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = verifyOtpSchema.parse(request.body);
    const phone = body.phone.startsWith('+') ? body.phone : `+91${body.phone}`;
    const otpRedisKey = `otp:phone:${phone}`;

    const storedOtp = await redis.get(otpRedisKey);

    if (!storedOtp || storedOtp !== body.otp) {
      logger.warn({ msg: 'OTP verification failed - invalid or expired', phone });
      throw new AppError('Invalid or expired OTP', 400, 'INVALID_OTP');
    }

    await redis.del(otpRedisKey);

    let user = await prisma.user.findUnique({ where: { phone } });

    if (!user) {
      const userName = body.name || `User ${phone.slice(-4)}`;
      user = await prisma.user.create({
        data: {
          name: userName,
          phone,
          phoneVerifiedAt: new Date(),
          kycStatus: 'NONE',
        },
      });
      logger.info({ msg: 'Created new user upon OTP verification', userId: user.id });
    } else if (!user.phoneVerifiedAt) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { phoneVerifiedAt: new Date() },
      });
    }

    if (user.banned) {
      throw new AppError(`Account banned: ${user.bannedReason || 'Violation of terms'}`, 403, 'FORBIDDEN');
    }

    const tokenId = crypto.randomUUID();
    const accessToken = generateAccessToken({ id: user.id, phone: user.phone });
    const refreshToken = generateRefreshToken({ id: user.id, phone: user.phone, tokenId });

    await redis.sadd(`user_tokens:${user.id}`, tokenId);

    reply.setCookie('tt_refresh_token', refreshToken, {
      path: '/auth',
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60,
    });

    return reply.status(200).send({
      message: 'Authentication successful',
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        kycStatus: user.kycStatus,
        phoneVerifiedAt: user.phoneVerifiedAt,
      },
    });
  });

  fastify.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const cookieToken = request.cookies.tt_refresh_token;

    if (!cookieToken) {
      throw new UnauthorizedError('Missing refresh token cookie');
    }

    const payload = verifyRefreshToken(cookieToken);

    const isTokenActive = await redis.sismember(`user_tokens:${payload.id}`, payload.tokenId);
    if (!isTokenActive) {
      logger.warn({ msg: 'Attempted use of revoked refresh token', userId: payload.id });
      throw new UnauthorizedError('Invalid or revoked refresh token');
    }

    await redis.srem(`user_tokens:${payload.id}`, payload.tokenId);

    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user || user.banned) {
      throw new UnauthorizedError('Account invalid or banned');
    }

    const newTokenId = crypto.randomUUID();
    const newAccessToken = generateAccessToken({ id: user.id, phone: user.phone });
    const newRefreshToken = generateRefreshToken({ id: user.id, phone: user.phone, tokenId: newTokenId });

    await redis.sadd(`user_tokens:${user.id}`, newTokenId);

    reply.setCookie('tt_refresh_token', newRefreshToken, {
      path: '/auth',
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60,
    });

    return reply.status(200).send({
      accessToken: newAccessToken,
    });
  });

  fastify.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const cookieToken = request.cookies.tt_refresh_token;

    if (cookieToken) {
      try {
        const payload = verifyRefreshToken(cookieToken);
        await redis.srem(`user_tokens:${payload.id}`, payload.tokenId);
      } catch (e) {
        // Token already invalid or expired
      }
    }

    reply.clearCookie('tt_refresh_token', { path: '/auth' });

    return reply.status(200).send({
      message: 'Logged out successfully',
    });
  });

  fastify.post('/recover', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const schema = z.object({ newPhone: z.string() });
    const { newPhone } = schema.parse(request.body);
    const userId = request.user!.id;

    const formattedNewPhone = newPhone.startsWith('+') ? newPhone : `+91${newPhone}`;

    const existing = await prisma.user.findUnique({ where: { phone: formattedNewPhone } });
    if (existing && existing.id !== userId) {
      throw new AppError('Phone number already associated with another account', 400, 'PHONE_IN_USE');
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    await redis.set(`otp:recover:${userId}:${formattedNewPhone}`, otp, 'EX', 300);

    const smsService = getSmsService();
    await smsService.sendOtp(formattedNewPhone, otp);

    return reply.status(200).send({
      message: 'Recovery verification code sent to new phone number',
    });
  });

  fastify.post('/recover/verify', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const schema = z.object({
      newPhone: z.string(),
      otp: z.string().length(6),
    });
    const { newPhone, otp } = schema.parse(request.body);
    const userId = request.user!.id;
    const formattedNewPhone = newPhone.startsWith('+') ? newPhone : `+91${newPhone}`;

    const redisKey = `otp:recover:${userId}:${formattedNewPhone}`;
    const storedOtp = await redis.get(redisKey);

    if (!storedOtp || storedOtp !== otp) {
      throw new AppError('Invalid or expired recovery OTP', 400, 'INVALID_OTP');
    }

    await redis.del(redisKey);

    // Update phone number
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        phone: formattedNewPhone,
        phoneVerifiedAt: new Date(),
      },
    });

    // Revoke all existing refresh tokens for security
    await redis.del(`user_tokens:${userId}`);

    // Log to AuditLog
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'UPDATE_PHONE_NUMBER',
        targetType: 'User',
        targetId: userId,
        metadata: { newPhone: formattedNewPhone },
      },
    });

    return reply.status(200).send({
      message: 'Phone number updated successfully. Please log in with your new phone number.',
      user: {
        id: updatedUser.id,
        phone: updatedUser.phone,
      },
    });
  });
}
