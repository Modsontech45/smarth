import { Response } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';

type Period = 'day' | 'week' | 'month' | 'year';

const VALID_PERIODS: Period[] = ['day', 'week', 'month', 'year'];

function periodLabel(period: Period): string {
  return { day: 'jour', week: 'semaine', month: 'mois', year: 'année' }[period];
}

// ─── GET /api/sensors/stats ──────────────────────────────────
// ?period=day|week|month|year  &device_id=X  &limit=N
export const getSensorStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const period    = (req.query.period as Period) || 'day';
  const device_id = req.query.device_id ? Number(req.query.device_id) : null;
  const limit     = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '30'))));

  if (!VALID_PERIODS.includes(period)) {
    res.status(400).json({ error: 'period doit être : day, week, month ou year' });
    return;
  }

  const params: (string | number)[] = [req.user!.userId];
  let deviceFilter = '';

  if (device_id) {
    // Vérifier que l'appareil appartient au compte
    const check = await pool.query(
      'SELECT id FROM devices WHERE id = $1 AND owner_id = $2 AND type = $3',
      [device_id, req.user!.userId, 'INPUT']
    );
    if ((check.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Capteur introuvable' });
      return;
    }
    params.push(device_id);
    deviceFilter = `AND sr.device_id = $${params.length}`;
  }

  params.push(limit);

  const query = `
    SELECT
      sr.device_id,
      d.name                                        AS device_name,
      d.zone,
      date_trunc('${period}', sr.recorded_at)       AS period_start,
      -- Température
      ROUND(MIN(sr.temperature)::numeric, 2)        AS temp_min,
      ROUND(MAX(sr.temperature)::numeric, 2)        AS temp_max,
      ROUND(AVG(sr.temperature)::numeric, 2)        AS temp_avg,
      -- Humidité
      ROUND(MIN(sr.humidity)::numeric, 2)           AS humidity_min,
      ROUND(MAX(sr.humidity)::numeric, 2)           AS humidity_max,
      ROUND(AVG(sr.humidity)::numeric, 2)           AS humidity_avg,
      -- Gaz
      ROUND(MIN(sr.gas_ppm)::numeric, 2)            AS gas_ppm_min,
      ROUND(MAX(sr.gas_ppm)::numeric, 2)            AS gas_ppm_max,
      ROUND(AVG(sr.gas_ppm)::numeric, 2)            AS gas_ppm_avg,
      -- Qualité d'air
      ROUND(MIN(sr.air_quality)::numeric, 2)        AS air_quality_min,
      ROUND(MAX(sr.air_quality)::numeric, 2)        AS air_quality_max,
      ROUND(AVG(sr.air_quality)::numeric, 2)        AS air_quality_avg,
      -- Luminosité
      ROUND(MIN(sr.light_lux)::numeric, 2)          AS light_lux_min,
      ROUND(MAX(sr.light_lux)::numeric, 2)          AS light_lux_max,
      ROUND(AVG(sr.light_lux)::numeric, 2)          AS light_lux_avg,
      -- Compteurs booléens
      COUNT(*) FILTER (WHERE sr.motion = TRUE)      AS motion_detections,
      COUNT(*) FILTER (WHERE sr.water_leak = TRUE)  AS water_leak_detections,
      COUNT(*)                                       AS reading_count
    FROM sensor_readings sr
    JOIN devices d ON d.id = sr.device_id
    WHERE d.owner_id = $1 AND d.type = 'INPUT'
    ${deviceFilter}
    GROUP BY sr.device_id, d.name, d.zone, date_trunc('${period}', sr.recorded_at)
    ORDER BY period_start DESC, sr.device_id
    LIMIT $${params.length}
  `;

  const result = await pool.query(query, params);

  res.json({
    period: periodLabel(period),
    stats:  result.rows,
  });
};
