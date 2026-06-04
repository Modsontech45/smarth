import { Response } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';

// ─── GET /api/devices ────────────────────────────────────────
export const getDevices = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { type, status, zone } = req.query;

  let query = `
    SELECT id, name, type, status, zone, description, created_at, updated_at
    FROM devices
    WHERE owner_id = $1
  `;
  const params: (string | number)[] = [req.user!.userId];

  if (type) {
    params.push(String(type).toUpperCase());
    query += ` AND type = $${params.length}`;
  }
  if (status) {
    params.push(String(status).toUpperCase());
    query += ` AND status = $${params.length}`;
  }
  if (zone) {
    params.push(String(zone));
    query += ` AND zone = $${params.length}`;
  }

  query += ' ORDER BY created_at DESC';

  const result = await pool.query(query, params);
  res.json({ devices: result.rows });
};

// ─── GET /api/devices/:id ────────────────────────────────────
export const getDeviceById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    `SELECT id, name, type, status, zone, description, created_at, updated_at
     FROM devices WHERE id = $1 AND owner_id = $2`,
    [req.params.id, req.user!.userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Appareil introuvable' });
    return;
  }

  res.json({ device: result.rows[0] });
};

// ─── POST /api/devices ───────────────────────────────────────
export const createDevice = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { name, type, zone, description } = req.body;

  if (!name || !type) {
    res.status(400).json({ error: 'Le nom et le type sont obligatoires' });
    return;
  }

  const validTypes = ['INPUT', 'OUTPUT'];
  if (!validTypes.includes(String(type).toUpperCase())) {
    res.status(400).json({ error: 'Le type doit être INPUT ou OUTPUT' });
    return;
  }

  const deviceKey = crypto.randomBytes(Number(process.env.DEVICE_TOKEN_BYTES) || 32).toString('hex');

  const result = await pool.query(
    `INSERT INTO devices (owner_id, name, type, zone, description, device_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, type, status, zone, description, device_key, created_at`,
    [req.user!.userId, name, type.toUpperCase(), zone || 'main', description || null, deviceKey]
  );

  const device = result.rows[0];

  res.status(201).json({
    message: 'Appareil ajouté avec succès',
    device: {
      id:          device.id,
      name:        device.name,
      type:        device.type,
      status:      device.status,
      zone:        device.zone,
      description: device.description,
      device_key:  device.device_key,
      created_at:  device.created_at,
    },
  });
};

// ─── PUT /api/devices/:id ────────────────────────────────────
export const updateDevice = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { name, zone, description } = req.body;

  const existing = await pool.query(
    'SELECT id FROM devices WHERE id = $1 AND owner_id = $2',
    [req.params.id, req.user!.userId]
  );
  if ((existing.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Appareil introuvable' });
    return;
  }

  const result = await pool.query(
    `UPDATE devices
     SET name        = COALESCE($1, name),
         zone        = COALESCE($2, zone),
         description = COALESCE($3, description),
         updated_at  = NOW()
     WHERE id = $4 AND owner_id = $5
     RETURNING id, name, type, status, zone, description, updated_at`,
    [name || null, zone || null, description || null, req.params.id, req.user!.userId]
  );

  res.json({ message: 'Appareil mis à jour', device: result.rows[0] });
};

// ─── DELETE /api/devices/:id ─────────────────────────────────
export const deleteDevice = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    'DELETE FROM devices WHERE id = $1 AND owner_id = $2 RETURNING id, name',
    [req.params.id, req.user!.userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Appareil introuvable' });
    return;
  }

  res.json({ message: `Appareil "${result.rows[0].name}" supprimé avec succès` });
};

// ─── PATCH /api/devices/:id/status ──────────────────────────
export const updateDeviceStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { status } = req.body;

  const validStatuses = ['ONLINE', 'OFFLINE'];
  if (!status || !validStatuses.includes(String(status).toUpperCase())) {
    res.status(400).json({ error: 'Le statut doit être ONLINE ou OFFLINE' });
    return;
  }

  const result = await pool.query(
    `UPDATE devices
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND owner_id = $3
     RETURNING id, name, status, updated_at`,
    [status.toUpperCase(), req.params.id, req.user!.userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Appareil introuvable' });
    return;
  }

  res.json({ message: 'Statut mis à jour', device: result.rows[0] });
};
