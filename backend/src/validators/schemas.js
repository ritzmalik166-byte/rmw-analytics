import { z } from 'zod';
import { websiteSettingsSchema } from '@rmw-analytics/shared';
import { ROLES } from '../config/rbac.js';
import { LEAD_STATUSES } from '../services/leadService.js';
import { ALERT_TYPES } from '../services/alertService.js';
import { STEP_TYPES } from '../services/funnelService.js';

const password = z.string().min(10, 'Password must be at least 10 characters').max(200)
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Password must contain letters and numbers');
const email = z.string().trim().toLowerCase().email('Enter a valid email').max(254);
export const mobile = z.string().trim().transform((v, ctx) => {
  const d = v.replace(/\D/g, '');
  const n = d.length === 10 ? `91${d}` : d;
  if (!/^\d{11,15}$/.test(n)) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid mobile number' }); return z.NEVER; }
  return n;
});
const fullName = z.string().trim().min(2).max(100);
const otpCode = z.string().trim().regex(/^\d{4,8}$/, 'Enter the code you received');
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

export const registerSchema = z.object({ fullName, email, password, mobile: mobile.optional(), organization: z.string().trim().min(2).max(100).optional() });
export const otpVerifySchema = z.object({ challenge: z.string().min(10).max(200), otp: otpCode });
export const otpResendSchema = z.object({ challenge: z.string().min(10).max(200) });
export const mobileChangeSchema = z.object({ mobile, currentPassword: z.string().min(1).max(200) });
export const memberCreateSchema = z.object({ fullName, email, mobile, password, role: z.enum(ROLES) });
export const memberUpdateSchema = z.object({ fullName: fullName.optional(), mobile: mobile.optional(), newPassword: password.optional(), isActive: z.boolean().optional() });
export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });
export const acceptInviteSchema = z.object({ token: z.string().min(10).max(200), fullName: z.string().trim().min(2).max(100), password });

export const inviteSchema = z.object({ email, role: z.enum(ROLES).refine((r) => r !== 'owner', 'Owners cannot be invited') });
export const memberRoleSchema = z.object({ role: z.enum(ROLES) });
export const orgSettingsSchema = z.object({ name: z.string().trim().min(2).max(100).optional(), timezone: z.string().max(64).optional() });

export const websiteCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().max(8).optional(),
  domain: z.string().trim().min(3).max(255),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  allowedOrigins: z.array(z.string().max(255)).max(20).optional(),
  timezone: z.string().max(64).optional(),
  settings: websiteSettingsSchema.partial().optional(),
});
export const websiteUpdateSchema = websiteCreateSchema.partial();

export const leadUpdateSchema = z.object({ status: z.enum(LEAD_STATUSES).optional(), note: z.string().trim().min(1).max(2000).optional() })
  .refine((v) => v.status || v.note, 'Nothing to update');

export const funnelSchema = z.object({
  name: z.string().trim().min(2).max(120),
  websiteId: objectId.nullable().optional(),
  windowHours: z.number().int().min(1).max(24 * 90).optional(),
  steps: z.array(z.object({ type: z.enum(STEP_TYPES), match: z.string().max(200).optional().default(''), label: z.string().max(80).optional() })).min(2).max(10),
});

export const goalSchema = z.object({
  websiteId: objectId,
  name: z.string().trim().min(2).max(80),
  type: z.enum(['event', 'path']),
  match: z.string().trim().min(1).max(200),
  value: z.number().min(0).max(1e12).optional(),
  currency: z.string().max(3).optional(),
});

export const alertSchema = z.object({
  name: z.string().trim().max(120).optional(),
  type: z.enum(Object.keys(ALERT_TYPES)),
  websiteId: objectId.nullable().optional(),
  threshold: z.number().min(0).max(1e12).nullable().optional(),
  windowMinutes: z.number().int().min(5).max(24 * 60).optional(),
  cooldownMinutes: z.number().int().min(0).max(7 * 24 * 60).optional(),
  enabled: z.boolean().optional(),
  channels: z.object({ inApp: z.boolean().optional(), emails: z.array(email).max(20).optional(), webhookUrl: z.string().url().max(500).nullable().optional() }).optional(),
});

export const reportScheduleSchema = z.object({
  websiteId: objectId.nullable().optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  recipients: z.array(email).min(1).max(20),
});
