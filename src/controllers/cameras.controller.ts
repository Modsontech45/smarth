import { Response } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';

const VALID_TYPES = ['mjpeg', 'snapshot', 'hls', 'iframe'];

// ── GET /api/cameras ──────────────────────────────────────────
export const getCameras = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { rows } = await pool.query(
    `SELECT id, name, url, stream_type, zone, refresh_ms, enabled, created_at
     FROM cameras WHERE owner_id = $1 ORDER BY zone, name`,
    [req.user!.userId],
  );
  res.json({ cameras: rows });
};

// ── POST /api/cameras ─────────────────────────────────────────
export const createCamera = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { name, url, stream_type = 'mjpeg', zone = 'main', refresh_ms = 1000, enabled = true } = req.body;

  if (!name?.trim() || !url?.trim()) {
    res.status(400).json({ error: 'name et url sont obligatoires.' });
    return;
  }
  if (!VALID_TYPES.includes(stream_type)) {
    res.status(400).json({ error: `stream_type doit être : ${VALID_TYPES.join(', ')}` });
    return;
  }

  const { rows } = await pool.query(
    `INSERT INTO cameras (owner_id, name, url, stream_type, zone, refresh_ms, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user!.userId, name.trim(), url.trim(), stream_type, zone?.trim() || 'main', Number(refresh_ms), Boolean(enabled)],
  );
  res.status(201).json({ camera: rows[0] });
};

// ── PUT /api/cameras/:id ──────────────────────────────────────
export const updateCamera = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const { name, url, stream_type, zone, refresh_ms, enabled } = req.body;

  if (stream_type && !VALID_TYPES.includes(stream_type)) {
    res.status(400).json({ error: `stream_type doit être : ${VALID_TYPES.join(', ')}` });
    return;
  }

  const { rows, rowCount } = await pool.query(
    `UPDATE cameras
     SET name        = COALESCE($3, name),
         url         = COALESCE($4, url),
         stream_type = COALESCE($5, stream_type),
         zone        = COALESCE($6, zone),
         refresh_ms  = COALESCE($7, refresh_ms),
         enabled     = COALESCE($8, enabled),
         updated_at  = NOW()
     WHERE id = $1 AND owner_id = $2
     RETURNING *`,
    [id, req.user!.userId,
     name?.trim() || null, url?.trim() || null, stream_type || null,
     zone?.trim() || null, refresh_ms != null ? Number(refresh_ms) : null,
     enabled != null ? Boolean(enabled) : null],
  );

  if (!rowCount) { res.status(404).json({ error: 'Caméra introuvable.' }); return; }
  res.json({ camera: rows[0] });
};

// ── DELETE /api/cameras/:id ───────────────────────────────────
export const deleteCamera = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { rowCount } = await pool.query(
    'DELETE FROM cameras WHERE id = $1 AND owner_id = $2',
    [Number(req.params.id), req.user!.userId],
  );
  if (!rowCount) { res.status(404).json({ error: 'Caméra introuvable.' }); return; }
  res.json({ message: 'Caméra supprimée.' });
};
