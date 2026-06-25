import { Response } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';

// ─── POST /api/devices/reset-data ────────────────────────────────────────────
// Clears all time-series data scoped to the requesting user's devices
export const resetData = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const [r1, r2, r3, r4] = await Promise.all([
      client.query('DELETE FROM sensor_readings        WHERE device_id IN (SELECT id FROM devices WHERE owner_id = $1)', [userId]),
      client.query('DELETE FROM energy_readings        WHERE device_id IN (SELECT id FROM devices WHERE owner_id = $1)', [userId]),
      client.query('DELETE FROM actuator_state_history WHERE device_id IN (SELECT id FROM devices WHERE owner_id = $1)', [userId]),
      client.query('DELETE FROM alerts                 WHERE device_id IN (SELECT id FROM devices WHERE owner_id = $1)', [userId]),
    ]);

    const r5 = await client.query(
      `UPDATE actuator_states
         SET state = false, triggered_by = 'manual',
             energy_today_wh = 0, total_energy_wh = 0, updated_at = NOW()
       WHERE device_id IN (SELECT id FROM devices WHERE owner_id = $1)`,
      [userId],
    );

    const r6 = await client.query(
      'UPDATE automations SET last_triggered_at = NULL WHERE owner_id = $1',
      [userId],
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      deleted: {
        sensor_readings:        r1.rowCount,
        energy_readings:        r2.rowCount,
        actuator_state_history: r3.rowCount,
        alerts:                 r4.rowCount,
      },
      reset: {
        actuator_states: r5.rowCount,
        automations:     r6.rowCount,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[resetData]', err);
    res.status(500).json({ error: 'Erreur lors de la réinitialisation des données.' });
  } finally {
    client.release();
  }
};

// ─── GET /api/devices/actuator-analytics ─────────────────────────────────────
// ?from=ISO  &to=ISO
// Returns per-device activation stats + hourly distribution + daily distribution
export const getActuatorAnalytics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const fromStr = req.query.from as string | undefined;
  const toStr   = req.query.to   as string | undefined;

  if (!fromStr || !toStr) {
    res.status(400).json({ error: 'Les paramètres from et to sont obligatoires.' });
    return;
  }

  const fromDate = new Date(fromStr);
  const toDate   = new Date(toStr);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    res.status(400).json({ error: 'Dates invalides.' });
    return;
  }
  if (fromDate >= toDate) {
    res.status(400).json({ error: 'from doit être antérieur à to.' });
    return;
  }

  const userId = req.user!.userId;
  const params = [userId, fromDate, toDate];

  // Shared CTE that builds ON intervals for all actuators
  const ON_INTERVALS_CTE = `
    seed AS (
      SELECT DISTINCT ON (h.device_id)
             h.device_id, h.state, $2::timestamptz AS changed_at
      FROM   actuator_state_history h
      JOIN   devices d ON d.id = h.device_id
      WHERE  d.owner_id = $1 AND d.type = 'OUTPUT'
        AND  h.changed_at < $2
      ORDER BY h.device_id, h.changed_at DESC
    ),
    in_range AS (
      SELECT h.device_id, h.changed_at, h.state
      FROM   actuator_state_history h
      JOIN   devices d ON d.id = h.device_id
      WHERE  d.owner_id = $1 AND d.type = 'OUTPUT'
        AND  h.changed_at BETWEEN $2 AND $3
    ),
    all_events AS (
      SELECT device_id, changed_at, state FROM seed
      UNION ALL
      SELECT device_id, changed_at, state FROM in_range
    ),
    with_next AS (
      SELECT device_id, changed_at, state,
             LEAD(changed_at) OVER (PARTITION BY device_id ORDER BY changed_at) AS next_at
      FROM   all_events
    ),
    on_intervals AS (
      SELECT
        device_id,
        changed_at  AS on_at,
        LEAST(COALESCE(next_at, $3::timestamptz), $3::timestamptz) AS off_at,
        EXTRACT(EPOCH FROM (
          LEAST(COALESCE(next_at, $3::timestamptz), $3::timestamptz) - changed_at
        ))::int AS duration_sec
      FROM with_next
      WHERE state = true AND changed_at < $3::timestamptz
    )
  `;

  // ── Query 1: per-device stats ─────────────────────────────────────────────
  const deviceQ = `
    WITH ${ON_INTERVALS_CTE},
    device_stats AS (
      SELECT
        oi.device_id,
        COUNT(*)::int                          AS activation_count,
        COALESCE(ROUND(AVG(duration_sec)), 0)::int AS avg_duration_sec,
        COALESCE(SUM(duration_sec), 0)::int    AS total_on_sec,
        COALESCE(MAX(duration_sec), 0)::int    AS max_duration_sec
      FROM on_intervals oi
      GROUP BY oi.device_id
    )
    SELECT
      d.id                                          AS device_id,
      d.name                                        AS device_name,
      d.zone,
      COALESCE(ds.activation_count, 0)              AS activation_count,
      COALESCE(ds.avg_duration_sec,  0)             AS avg_duration_sec,
      COALESCE(ds.total_on_sec,      0)             AS total_on_sec,
      COALESCE(ds.max_duration_sec,  0)             AS max_duration_sec
    FROM      devices d
    LEFT JOIN device_stats ds ON ds.device_id = d.id
    WHERE  d.owner_id = $1 AND d.type = 'OUTPUT'
    ORDER BY COALESCE(ds.activation_count, 0) DESC
  `;

  // ── Query 2: hourly distribution (aggregated across all actuators) ─────────
  const hourlyQ = `
    WITH ${ON_INTERVALS_CTE}
    SELECT
      EXTRACT(HOUR FROM on_at)::int AS hour,
      COUNT(*)::int                 AS activations
    FROM on_intervals
    GROUP BY hour
    ORDER BY hour
  `;

  // ── Query 3: daily distribution ───────────────────────────────────────────
  const dailyQ = `
    WITH ${ON_INTERVALS_CTE}
    SELECT
      DATE(on_at)::text        AS day,
      COUNT(*)::int            AS activations,
      SUM(duration_sec)::int   AS total_on_sec
    FROM on_intervals
    GROUP BY day
    ORDER BY day
  `;

  const [deviceRes, hourlyRes, dailyRes] = await Promise.all([
    pool.query(deviceQ,  params),
    pool.query(hourlyQ,  params),
    pool.query(dailyQ,   params),
  ]);

  // Fill hourly gaps (ensure 0–23 all present)
  const hourlyMap = new Map<number, number>(
    hourlyRes.rows.map(r => [Number(r.hour), Number(r.activations)]),
  );
  const hourly = Array.from({ length: 24 }, (_, h) => ({
    hour:        h,
    activations: hourlyMap.get(h) ?? 0,
  }));

  res.json({
    from:    fromDate,
    to:      toDate,
    devices: deviceRes.rows.map(r => ({
      device_id:        Number(r.device_id),
      device_name:      r.device_name,
      zone:             r.zone,
      activation_count: Number(r.activation_count),
      avg_duration_sec: Number(r.avg_duration_sec),
      total_on_sec:     Number(r.total_on_sec),
      max_duration_sec: Number(r.max_duration_sec),
    })),
    hourly,
    daily: dailyRes.rows.map(r => ({
      day:          r.day,
      activations:  Number(r.activations),
      total_on_sec: Number(r.total_on_sec),
    })),
  });
};
