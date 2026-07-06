import { Response } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';
import { PLAN_LIMITS, PLAN_PRICES, PlanTier } from '../plans';

// ─── GET /api/subscription ───────────────────────────────────
export const getSubscription = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;

  const [userRow, deviceCount, automationCount, cameraCount] = await Promise.all([
    pool.query<{ plan: PlanTier; plan_expires_at: string | null }>(
      'SELECT plan, plan_expires_at FROM users WHERE id = $1',
      [userId],
    ),
    pool.query<{ count: string }>(
      'SELECT COUNT(*) FROM devices WHERE owner_id = $1',
      [userId],
    ),
    pool.query<{ count: string }>(
      'SELECT COUNT(*) FROM automations WHERE owner_id = $1',
      [userId],
    ),
    pool.query<{ count: string }>(
      'SELECT COUNT(*) FROM cameras WHERE owner_id = $1',
      [userId],
    ),
  ]);

  const plan       = (userRow.rows[0]?.plan ?? 'FREE') as PlanTier;
  const expiresAt  = userRow.rows[0]?.plan_expires_at ?? null;
  const limits     = PLAN_LIMITS[plan];
  const prices     = PLAN_PRICES[plan];

  // If plan is paid and expired, fall back to FREE
  const now        = new Date();
  const isExpired  = expiresAt && new Date(expiresAt) < now;

  res.json({
    plan,
    expiresAt,
    isExpired: isExpired ?? false,
    limits,
    prices,
    usage: {
      devices:     parseInt(deviceCount.rows[0].count),
      automations: parseInt(automationCount.rows[0].count),
      cameras:     parseInt(cameraCount.rows[0].count),
    },
  });
};

// ─── PUT /api/subscription/plan ──────────────────────────────
// In production this would be handled by a payment provider webhook.
// For now it allows direct plan selection (demo / school project use).
export const updatePlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId            = req.user!.userId;
  const { plan, billing } = req.body as { plan: PlanTier; billing: 'monthly' | 'annual' };

  const validPlans = ['FREE', 'BASIC', 'PRO'];
  if (!validPlans.includes(plan)) {
    res.status(400).json({ error: 'Plan invalide' });
    return;
  }

  let expiresAt: Date | null = null;

  if (plan !== 'FREE') {
    expiresAt = new Date();
    if (billing === 'annual') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }
  }

  await pool.query(
    'UPDATE users SET plan = $1, plan_expires_at = $2, updated_at = NOW() WHERE id = $3',
    [plan, expiresAt, userId],
  );

  await pool.query(
    `INSERT INTO subscription_history (user_id, plan, billing, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, plan, billing ?? 'monthly', expiresAt],
  );

  res.json({
    message: `Plan mis à jour : ${plan}`,
    plan,
    expiresAt,
    limits: PLAN_LIMITS[plan],
  });
};
