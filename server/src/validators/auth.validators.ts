import { z } from 'zod';
import { email, password, personName } from './common.js';

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(200),
});

/**
 * Student self-service account activation. A student can only register if
 * school staff already created a matching profile (same student number and
 * email). The role is never accepted from the client, which prevents
 * privilege escalation through the public registration endpoint.
 */
export const registerSchema = z.object({
  email,
  password,
  studentNumber: z.string().trim().min(1).max(40),
  firstName: personName,
  lastName: personName,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
