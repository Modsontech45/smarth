import { Response } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';
import { PLAN_LIMITS, PlanTier } from '../plans';

const VALID_TRIGGER_TYPES  = ['SENSOR_THRESHOLD', 'TIME_BASED', 'DEVICE_STATUS'];
const VALID_CONDITIONS     = ['GT', 'LT', 'EQ', 'GTE', 'LTE'];

const SELECT = `
  SELECT a.*,
         td.name AS trigger_device_name, td.unit AS trigger_unit,
         td.signal_type AS trigger_signal_type,
         ad.name AS action_device_name
  FROM automations a
  LEFT JOIN devices td ON td.id = a.trigger_device_id
  LEFT JOIN devices ad ON ad.id = a.action_device_id
`;

// ─── GET /api/automations ────────────────────────────────────
export const getAutomations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    `${SELECT} WHERE a.owner_id = $1 ORDER BY a.created_at DESC`,
    [req.user!.userId]
  );
  res.json({ automations: result.rows });
};

// ─── GET /api/automations/:id ────────────────────────────────
export const getAutomationById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    `${SELECT} WHERE a.id = $1 AND a.owner_id = $2`,
    [req.params.id, req.user!.userId]
  );
  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Automatisation introuvable' });
    return;
  }
  res.json({ automation: result.rows[0] });
};

// ─── POST /api/automations ───────────────────────────────────
export const createAutomation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const {
    name, description,
    trigger_type, trigger_device_id, trigger_condition, trigger_value, trigger_time,
    trigger_field,
    action_device_id, action_state, action_all_devices, action_duration_seconds,
  } = req.body;

  if (!name || !trigger_type || action_state === undefined) {
    res.status(400).json({ error: 'name, trigger_type et action_state sont obligatoires' });
    return;
  }
  if (!action_all_devices && action_device_id === undefined) {
    res.status(400).json({ error: "Choisissez un appareil cible ou activez 'Tous les actionneurs'" });
    return;
  }
  if (!VALID_TRIGGER_TYPES.includes(trigger_type)) {
    res.status(400).json({ error: `trigger_type invalide. Valeurs : ${VALID_TRIGGER_TYPES.join(', ')}` });
    return;
  }
  if (trigger_condition && !VALID_CONDITIONS.includes(trigger_condition)) {
    res.status(400).json({ error: `trigger_condition invalide. Valeurs : ${VALID_CONDITIONS.join(', ')}` });
    return;
  }

  // Enforce plan automation limit
  const planRow = await pool.query<{ plan: PlanTier; count: string }>(
    `SELECT u.plan, COUNT(a.id)::text AS count
     FROM users u LEFT JOIN automations a ON a.owner_id = u.id
     WHERE u.id = $1 GROUP BY u.plan`,
    [req.user!.userId],
  );
  const userPlan = (planRow.rows[0]?.plan ?? 'FREE') as PlanTier;
  const autoCount = parseInt(planRow.rows[0]?.count ?? '0');
  const autoLimit = PLAN_LIMITS[userPlan].automations;
  if (autoLimit !== -1 && autoCount >= autoLimit) {
    res.status(403).json({
      error: `Limite atteinte : votre plan ${userPlan} autorise ${autoLimit} automatisations maximum.`,
      code: 'PLAN_LIMIT_AUTOMATIONS',
    });
    return;
  }

  // Verify action device belongs to user (only when not targeting all devices)
  if (!action_all_devices && action_device_id !== undefined) {
    const deviceCheck = await pool.query(
      'SELECT id FROM devices WHERE id = $1 AND owner_id = $2',
      [action_device_id, req.user!.userId]
    );
    if ((deviceCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "Appareil d'action introuvable" });
      return;
    }
  }

  const result = await pool.query(
    `INSERT INTO automations
       (owner_id, name, description, trigger_type, trigger_device_id,
        trigger_condition, trigger_value, trigger_time, trigger_field,
        action_device_id, action_state, action_all_devices, action_duration_seconds)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      req.user!.userId, name, description || null,
      trigger_type,
      trigger_device_id || null,
      trigger_condition || null,
      trigger_value     ?? null,
      trigger_time      || null,
      trigger_field     || null,
      action_all_devices ? null : (action_device_id ?? null),
      action_state,
      action_all_devices ?? false,
      action_duration_seconds ? parseInt(action_duration_seconds) : null,
    ]
  );

  res.status(201).json({ message: 'Automatisation créée', automation: result.rows[0] });
};

// ─── PUT /api/automations/:id ────────────────────────────────
export const updateAutomation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const existing = await pool.query(
    'SELECT id FROM automations WHERE id = $1 AND owner_id = $2',
    [req.params.id, req.user!.userId]
  );
  if ((existing.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Automatisation introuvable' });
    return;
  }

  const {
    name, description,
    trigger_type, trigger_device_id, trigger_condition, trigger_value, trigger_time,
    trigger_field,
    action_device_id, action_state, action_all_devices, action_duration_seconds, enabled,
  } = req.body;

  if (trigger_type && !VALID_TRIGGER_TYPES.includes(trigger_type)) {
    res.status(400).json({ error: `trigger_type invalide` });
    return;
  }

  // When switching to action_all_devices, clear action_device_id; otherwise use provided value or keep existing
  const effectiveActionDeviceId = action_all_devices === true
    ? null
    : (action_device_id ?? null);

  const result = await pool.query(
    `UPDATE automations SET
       name                    = COALESCE($1,  name),
       description             = COALESCE($2,  description),
       trigger_type            = COALESCE($3,  trigger_type),
       trigger_device_id       = COALESCE($4,  trigger_device_id),
       trigger_condition       = COALESCE($5,  trigger_condition),
       trigger_value           = COALESCE($6,  trigger_value),
       trigger_time            = COALESCE($7,  trigger_time),
       trigger_field           = COALESCE($8,  trigger_field),
       action_all_devices      = COALESCE($9,  action_all_devices),
       action_device_id        = CASE
                                   WHEN $9::boolean = true       THEN NULL
                                   WHEN $10::integer IS NOT NULL THEN $10::integer
                                   ELSE action_device_id
                                 END,
       action_state            = COALESCE($11, action_state),
       action_duration_seconds = COALESCE($12, action_duration_seconds),
       enabled                 = COALESCE($13, enabled),
       updated_at              = NOW()
     WHERE id = $14 AND owner_id = $15
     RETURNING *`,
    [
      name          || null,
      description   ?? null,
      trigger_type  || null,
      trigger_device_id ?? null,
      trigger_condition || null,
      trigger_value     ?? null,
      trigger_time      || null,
      trigger_field     || null,
      action_all_devices ?? null,
      effectiveActionDeviceId,
      action_state            ?? null,
      action_duration_seconds !== undefined ? (action_duration_seconds || 0) : null,
      enabled                 ?? null,
      req.params.id,
      req.user!.userId,
    ]
  );

  res.json({ message: 'Automatisation mise à jour', automation: result.rows[0] });
};

// ─── DELETE /api/automations/:id ─────────────────────────────
export const deleteAutomation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    'DELETE FROM automations WHERE id = $1 AND owner_id = $2 RETURNING id, name',
    [req.params.id, req.user!.userId]
  );
  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Automatisation introuvable' });
    return;
  }
  res.json({ message: `Automatisation "${result.rows[0].name}" supprimée` });
};

// ─── PATCH /api/automations/:id/toggle ───────────────────────
export const toggleAutomation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    `UPDATE automations
     SET enabled = NOT enabled, updated_at = NOW()
     WHERE id = $1 AND owner_id = $2
     RETURNING id, name, enabled`,
    [req.params.id, req.user!.userId]
  );
  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Automatisation introuvable' });
    return;
  }
  const { name, enabled } = result.rows[0];
  res.json({ message: `Automatisation "${name}" ${enabled ? 'activée' : 'désactivée'}`, automation: result.rows[0] });
};
