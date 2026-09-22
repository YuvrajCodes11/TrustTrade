import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'otp',
      '*.otp',
      'password',
      '*.password',
      'token',
      '*.token',
      'accessToken',
      'refreshToken',
      'authorization',
      'headers.authorization',
      'cookie',
      'headers.cookie',
      'aadhaar',
      'pan',
      'kycNumber',
      'idNumber',
    ],
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'SYS:standard',
          },
        }
      : undefined,
});
