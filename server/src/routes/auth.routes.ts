import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { isTest } from '../config/env.js';
import * as auth from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';

/** Brute-force protection for credential endpoints (per IP). */
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => isTest,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, please try again later' } },
});

export const authRouter = Router();

authRouter.post('/login', credentialLimiter, auth.login);
authRouter.post('/register', credentialLimiter, auth.register);
authRouter.post('/logout', auth.logout);
authRouter.post('/logout-all', authenticate, auth.logoutAll);
authRouter.get('/me', authenticate, auth.me);
authRouter.patch('/password', authenticate, credentialLimiter, auth.changePassword);
