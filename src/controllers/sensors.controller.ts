import { Response } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';

// ─── GET /api/sensors/latest ─────────────────────────────────
export const getLatest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    `SELECT sr.id, sr.device_id, d.name AS device_name, d.zone,
            sr.temperature, sr.humidity, sr.gas_ppm, sr.air_quality,
            sr.motion, sr.light_lux, sr.water_leak, sr.recorded_at
     FROM sensor_readings sr
     JOIN devices d ON d.id = sr.device_id
     WHERE d.owner_id = $1
     ORDER BY sr.recorded_at DESC
     LIMIT 1`,
    [req.user!.userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Aucun relevé disponible' });
    return;
  }

  res.json({ reading: result.rows[0] });
};

// ─── GET /api/sensors/history ────────────────────────────────
export const getHistory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { from, to, page = '1', limit = '20' } = req.query;

  const pageNum  = Math.max(1, parseInt(String(page)));
  const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));
  const offset   = (pageNum - 1) * limitNum;

  let query = `
    SELECT sr.id, sr.device_id, d.name AS device_name, d.zone,
           sr.temperature, sr.humidity, sr.gas_ppm, sr.air_quality,
           sr.motion, sr.light_lux, sr.water_leak, sr.recorded_at
    FROM sensor_readings sr
    JOIN devices d ON d.id = sr.device_id
    WHERE d.owner_id = $1
  `;
  const params: (string | number)[] = [req.user!.userId];

  if (from) {
    params.push(String(from));
    query += ` AND sr.recorded_at >= $${params.length}`;
  }
  if (to) {
    params.push(String(to));
    query += ` AND sr.recorded_at <= $${params.length}`;
  }

  query += ` ORDER BY sr.recorded_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limitNum, offset);

  const countQuery = query.replace(
    /SELECT[\s\S]+?FROM/,
    'SELECT COUNT(*) FROM'
  ).split('ORDER BY')[0];

  const [data, count] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery.replace(/LIMIT \$\d+ OFFSET \$\d+/, ''), params.slice(0, -2)),
  ]);

  res.json({
    readings:   data.rows,
    pagination: {
      page:       pageNum,
      limit:      limitNum,
      total:      parseInt(count.rows[0].count),
      totalPages: Math.ceil(parseInt(count.rows[0].count) / limitNum),
    },
  });
};

// ─── GET /api/sensors/device/:device_id ─────────────────────
export const getByDevice = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { device_id } = req.params;
  const { page = '1', limit = '20' } = req.query;

  const pageNum  = Math.max(1, parseInt(String(page)));
  const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));
  const offset   = (pageNum - 1) * limitNum;

  // Vérifier que l'appareil appartient au compte
  const deviceCheck = await pool.query(
    'SELECT id, name, zone FROM devices WHERE id = $1 AND owner_id = $2',
    [device_id, req.user!.userId]
  );
  if ((deviceCheck.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Appareil introuvable' });
    return;
  }

  const result = await pool.query(
    `SELECT id, temperature, humidity, gas_ppm, air_quality,
            motion, light_lux, water_leak, recorded_at
     FROM sensor_readings
     WHERE device_id = $1
     ORDER BY recorded_at DESC
     LIMIT $2 OFFSET $3`,
    [device_id, limitNum, offset]
  );

  const countResult = await pool.query(
    'SELECT COUNT(*) FROM sensor_readings WHERE device_id = $1',
    [device_id]
  );

  res.json({
    device:   deviceCheck.rows[0],
    readings: result.rows,
    pagination: {
      page:       pageNum,
      limit:      limitNum,
      total:      parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limitNum),
    },
  });
};
