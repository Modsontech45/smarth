import { Response } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';

const VALID_TRIGGER_TYPES  = ['SENSOR_THRESHOLD', 'TIME_BASED', 'DEVICE_STATUS'];
const VALID_CONDITIONS     = ['GT', 'LT', 'EQ', 'GTE', 'LTE'];

const SELECT = `
  SELECT a.*,
         td.name AS trigger_device_name,
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
    action_device_id, action_state,
  } = req.body;

  if (!name || !trigger_type || action_device_id === undefined || action_state === undefined) {
    res.status(400).json({ error: 'name, trigger_type, action_device_id et action_state sont obligatoires' });
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

  // Verify action device belongs to user
  const deviceCheck = await pool.query(
    'SELECT id FROM devices WHERE id = $1 AND owner_id = $2',
    [action_device_id, req.user!.userId]
  );
  if ((deviceCheck.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Appareil d\'action introuvable' });
    return;
  }

  const result = await pool.query(
    `INSERT INTO automations
       (owner_id, name, description, trigger_type, trigger_device_id,
        trigger_condition, trigger_value, trigger_time, action_device_id, action_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      req.user!.userId, name, description || null,
      trigger_type,
      trigger_device_id || null,
      trigger_condition || null,
      trigger_value     ?? null,
      trigger_time      || null,
      action_device_id,
      action_state,
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
    action_device_id, action_state, enabled,
  } = req.body;

  if (trigger_type && !VALID_TRIGGER_TYPES.includes(trigger_type)) {
    res.status(400).json({ error: `trigger_type invalide` });
    return;
  }

  const result = await pool.query(
    `UPDATE automations SET
       name               = COALESCE($1,  name),
       description        = COALESCE($2,  description),
       trigger_type       = COALESCE($3,  trigger_type),
       trigger_device_id  = COALESCE($4,  trigger_device_id),
       trigger_condition  = COALESCE($5,  trigger_condition),
       trigger_value      = COALESCE($6,  trigger_value),
       trigger_time       = COALESCE($7,  trigger_time),
       action_device_id   = COALESCE($8,  action_device_id),
       action_state       = COALESCE($9,  action_state),
       enabled            = COALESCE($10, enabled),
       updated_at         = NOW()
     WHERE id = $11 AND owner_id = $12
     RETURNING *`,
    [
      name          || null,
      description   ?? null,
      trigger_type  || null,
      trigger_device_id ?? null,
      trigger_condition || null,
      trigger_value     ?? null,
      trigger_time      || null,
      action_device_id  ?? null,
      action_state      ?? null,
      enabled           ?? null,
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
