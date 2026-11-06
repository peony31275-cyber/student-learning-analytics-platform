import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { isProduction } from '../config/env.js';
import { AUTH_COOKIE } from '../middleware/authenticate.js';
import { currentUser } from '../middleware/authorize.js';
import * as activationService from '../services/activation.service.js';
import * as authService from '../services/auth.service.js';
import { created, noContent, ok } from '../utils/http.js';
import {
  activateSchema,
  activationTokenSchema,
  changePasswordSchema,
  loginSchema,
} from '../validators/auth.validators.js';

/**
 * The JWT is delivered in an httpOnly cookie: JavaScript (and therefore an XSS
 * payload) cannot read it. SameSite=Lax stops the browser from attaching it to
 * cross-site POST/PUT/PATCH/DELETE requests, which mitigates CSRF.
 */
const baseCookie: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
};

function setAuthCookie(res: Response, token: string) {
  const { exp } = jwt.decode(token) as { exp: number };
  res.cookie(AUTH_COOKIE, token, { ...baseCookie, expires: new Date(exp * 1000) });
}

export async function login(req: Request, res: Response) {
  const { user, token } = await authService.login(loginSchema.parse(req.body));
  setAuthCookie(res, token);
  ok(res, { user });
}

/** Public: checks an activation link (token in the body, never in the URL or logs). */
export async function verifyActivation(req: Request, res: Response) {
  const { token } = activationTokenSchema.parse(req.body);
  ok(res, await activationService.previewActivation(token));
}

/** Public: creates the student's login. No session is started; the student signs in next. */
export async function activate(req: Request, res: Response) {
  created(res, await activationService.activateAccount(activateSchema.parse(req.body)));
}

export function logout(_req: Request, res: Response) {
  res.clearCookie(AUTH_COOKIE, baseCookie);
  noContent(res);
}

export async function logoutAll(req: Request, res: Response) {
  await authService.revokeAllSessions(currentUser(req).id);
  res.clearCookie(AUTH_COOKIE, baseCookie);
  noContent(res);
}

export function me(req: Request, res: Response) {
  ok(res, { user: authService.toSessionUser(currentUser(req)) });
}

/** Changes the password and ends every session, this one included: sign in again. */
export async function changePassword(req: Request, res: Response) {
  const input = changePasswordSchema.parse(req.body);
  await authService.changePassword(currentUser(req).id, input);
  res.clearCookie(AUTH_COOKIE, baseCookie);
  noContent(res);
}
