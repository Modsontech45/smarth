import { Response } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';

// ─── GET /api/actuators ──────────────────────────────────────
export const getActuators = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    `SELECT d.id, d.name, d.zone, d.status,
            a.state, a.triggered_by, a.updated_at
     FROM devices d
     LEFT JOIN actuator_states a ON a.device_id = d.id
     WHERE d.owner_id = $1 AND d.type = 'OUTPUT'
     ORDER BY d.zone, d.name`,
    [req.user!.userId]
  );

  res.json({ actuators: result.rows });
};

// ─── POST /api/actuators/command ─────────────────────────────
export const sendCommand = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { device_id, state } = req.body;

  if (device_id === undefined || state === undefined) {
    res.status(400).json({ error: 'device_id et state sont obligatoires' });
    return;
  }
  if (typeof state !== 'boolean') {
    res.status(400).json({ error: 'state doit être un booléen (true ou false)' });
    return;
  }

  // Vérifier que l'appareil est un OUTPUT et appartient au compte
  const deviceResult = await pool.query(
    `SELECT id, name, zone, status FROM devices
     WHERE id = $1 AND owner_id = $2 AND type = 'OUTPUT'`,
    [device_id, req.user!.userId]
  );

  if ((deviceResult.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Actionneur introuvable' });
    return;
  }

  const device = deviceResult.rows[0];

  // Mettre à jour ou insérer l'état courant
  await pool.query(
    `INSERT INTO actuator_states (device_id, state, triggered_by, updated_at)
     VALUES ($1, $2, 'manual', NOW())
     ON CONFLICT (device_id)
     DO UPDATE SET state = $2, triggered_by = 'manual', updated_at = NOW()`,
    [device_id, state]
  );

  // Logger le changement d'état pour les statistiques de durée
  await pool.query(
    `INSERT INTO actuator_state_history (device_id, state, changed_by, changed_at)
     VALUES ($1, $2, 'manual', NOW())`,
    [device_id, state]
  );

  res.json({
    message: `Commande envoyée : ${device.name} → ${state ? 'ON' : 'OFF'}`,
    actuator: {
      id:           device.id,
      name:         device.name,
      zone:         device.zone,
      state,
      triggered_by: 'manual',
      updated_at:   new Date().toISOString(),
    },
  });
};
