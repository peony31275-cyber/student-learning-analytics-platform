import { z } from 'zod';
import { email, password } from './common.js';

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(200),
});

/**
 * Student activation through a one-time invite link. The token's format is
 * checked by the service, so a malformed token gets the same answer as an
 * unknown one. Email, name and role come from the student profile, never from
 * the client.
 */
export const activationTokenSchema = z.object({ token: z.string().max(200) });
export const activateSchema = activationTokenSchema.extend({ password });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(200),
    newPassword: password,
  })
  .refine((p) => p.newPassword !== p.currentPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current password',
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ActivateInput = z.infer<typeof activateSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
