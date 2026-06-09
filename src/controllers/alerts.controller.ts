import { Response } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';
import { emitToUser } from '../socket';

// ─── GET /api/alerts ─────────────────────────────────────────
export const getAlerts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { resolved, severity, type, page = '1', limit = '20' } = req.query;

  const pageNum  = Math.max(1, parseInt(String(page)));
  const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));
  const offset   = (pageNum - 1) * limitNum;

  let query = `
    SELECT a.id, a.type, a.zone, a.severity, a.message,
           a.resolved, a.created_at,
           d.name AS device_name,
           u.name AS resolved_by_name
    FROM alerts a
    LEFT JOIN devices d ON d.id = a.device_id
    LEFT JOIN users u   ON u.id = a.resolved_by
    WHERE (d.owner_id = $1 OR a.device_id IS NULL)
  `;
  const params: (string | number | boolean)[] = [req.user!.userId];

  if (resolved !== undefined) {
    params.push(resolved === 'true');
    query += ` AND a.resolved = $${params.length}`;
  }
  if (severity) {
    params.push(String(severity).toUpperCase());
    query += ` AND a.severity = $${params.length}`;
  }
  if (type) {
    params.push(String(type).toUpperCase());
    query += ` AND a.type = $${params.length}`;
  }

  query += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limitNum, offset);

  const result = await pool.query(query, params);

  res.json({ alerts: result.rows });
};

// ─── GET /api/alerts/:id ─────────────────────────────────────
export const getAlertById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    `SELECT a.id, a.type, a.zone, a.severity, a.message,
            a.resolved, a.created_at,
            d.name AS device_name,
            u.name AS resolved_by_name
     FROM alerts a
     LEFT JOIN devices d ON d.id = a.device_id
     LEFT JOIN users u   ON u.id = a.resolved_by
     WHERE a.id = $1 AND d.owner_id = $2`,
    [req.params.id, req.user!.userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Alerte introuvable' });
    return;
  }

  res.json({ alert: result.rows[0] });
};

// ─── PATCH /api/alerts/:id/resolve ───────────────────────────
export const resolveAlert = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    `UPDATE alerts a
     SET resolved = TRUE, resolved_by = $1
     FROM devices d
     WHERE a.id = $2
       AND a.device_id = d.id
       AND d.owner_id = $1
       AND a.resolved = FALSE
     RETURNING a.id, a.type, a.severity, a.resolved`,
    [req.user!.userId, req.params.id]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Alerte introuvable ou déjà résolue' });
    return;
  }

  emitToUser(req.user!.userId, 'alert:resolved', { id: result.rows[0].id });
  res.json({ message: 'Alerte marquée comme résolue', alert: result.rows[0] });
};
