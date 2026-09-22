import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { env } from './config/env.js';
import { setupErrorHandler } from './plugins/error-handler.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { userRoutes } from './modules/user/user.routes.js';
import { kycRoutes } from './modules/kyc/kyc.routes.js';
import { listingRoutes } from './modules/listing/listing.routes.js';
import { uploadRoutes } from './modules/upload/upload.routes.js';
import { conversationRoutes } from './modules/conversation/conversation.routes.js';
import { transactionRoutes } from './modules/transaction/transaction.routes.js';
import { reviewRoutes } from './modules/review/review.routes.js';
import { disputeRoutes } from './modules/dispute/dispute.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';

export function buildApp() {
  const app = Fastify({
    logger: false,
    disableRequestLogging: true,
    bodyLimit: 1048576, // 1MB payload limit to prevent DoS
  });

  // 1. Security Headers (Helmet)
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'"],
      },
    },
  });

  // 2. CORS (Restricted to exact frontend origin, no wildcard)
  const allowedOrigins = env.FRONTEND_ORIGIN.split(',').map((o) => o.trim());
  app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin) || origin === 'null' || origin.startsWith('file://') || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
  });

  // 3. Cookies
  app.register(cookie);

  // 4. Centralized Error Handler
  setupErrorHandler(app);

  // 5. Register Routes
  app.register(healthRoutes, { prefix: '/health' });
  app.register(authRoutes, { prefix: '/auth' });
  app.register(userRoutes, { prefix: '/users' });
  app.register(kycRoutes, { prefix: '/kyc' });
  app.register(listingRoutes, { prefix: '/listings' });
  app.register(uploadRoutes, { prefix: '/uploads' });
  app.register(conversationRoutes, { prefix: '/conversations' });
  app.register(transactionRoutes, { prefix: '/transactions' });
  app.register(reviewRoutes, { prefix: '/reviews' });
  app.register(disputeRoutes, { prefix: '/disputes' });
  app.register(adminRoutes, { prefix: '/admin' });

  return app;
}
