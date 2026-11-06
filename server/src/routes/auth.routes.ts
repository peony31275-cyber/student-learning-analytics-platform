import { type RequestHandler, Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { type CredentialRateLimit, credentialLimiter } from '../middleware/rate-limit.js';

const noLimit: RequestHandler = (_req, _res, next) => next();

/** `limits: null` turns rate limiting off (the shared integration-test app). */
export function createAuthRouter(limits: CredentialRateLimit | null) {
  // One limiter (and counter) per endpoint: failed registrations must not lock
  // the same network out of signing in. Session checks and logout are not limited.
  const limiter = () => (limits ? credentialLimiter(limits) : noLimit);
  const router = Router();
  router.post('/login', limiter(), auth.login);
  router.post('/register', limiter(), auth.register);
  router.post('/logout', auth.logout);
  router.post('/logout-all', authenticate, auth.logoutAll);
  router.get('/me', authenticate, auth.me);
  router.patch('/password', authenticate, limiter(), auth.changePassword);
  return router;
}
