import { Response } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';

type Period = 'day' | 'week' | 'month' | 'year';

const VALID_PERIODS: Period[] = ['day', 'week', 'month', 'year'];

function periodLabel(period: Period): string {
  return { day: 'jour', week: 'semaine', month: 'mois', year: 'année' }[period];
}

// ─── GET /api/actuators/stats ────────────────────────────────
// ?period=day|week|month|year  &device_id=X  &limit=N
export const getActuatorStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
    const check = await pool.query(
      'SELECT id FROM devices WHERE id = $1 AND owner_id = $2 AND type = $3',
      [device_id, req.user!.userId, 'OUTPUT']
    );
    if ((check.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Actionneur introuvable' });
      return;
    }
    params.push(device_id);
    deviceFilter = `AND h.device_id = $${params.length}`;
  }

  params.push(limit);

  // Calcul des durées ON/OFF via window function LEAD
  // Pour chaque changement d'état, on calcule le temps jusqu'au prochain changement
  const query = `
    WITH state_intervals AS (
      SELECT
        h.device_id,
        h.state,
        h.changed_by,
        h.changed_at,
        LEAD(h.changed_at) OVER (
          PARTITION BY h.device_id
          ORDER BY h.changed_at
        ) AS next_changed_at
      FROM actuator_state_history h
      JOIN devices d ON d.id = h.device_id
      WHERE d.owner_id = $1 AND d.type = 'OUTPUT'
      ${deviceFilter}
    )
    SELECT
      si.device_id,
      d.name                                               AS device_name,
      d.zone,
      date_trunc('${period}', si.changed_at)               AS period_start,

      -- Durée totale ON (secondes)
      COALESCE(SUM(
        CASE WHEN si.state = TRUE AND si.next_changed_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (si.next_changed_at - si.changed_at))
          ELSE 0
        END
      ), 0)::BIGINT                                        AS on_duration_seconds,

      -- Durée totale OFF (secondes)
      COALESCE(SUM(
        CASE WHEN si.state = FALSE AND si.next_changed_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (si.next_changed_at - si.changed_at))
          ELSE 0
        END
      ), 0)::BIGINT                                        AS off_duration_seconds,

      -- Nombre de basculements
      COUNT(*)                                             AS toggle_count,

      -- Nombre d'allumages
      COUNT(*) FILTER (WHERE si.state = TRUE)              AS on_count,

      -- Nombre d'extinctions
      COUNT(*) FILTER (WHERE si.state = FALSE)             AS off_count

    FROM state_intervals si
    JOIN devices d ON d.id = si.device_id
    GROUP BY si.device_id, d.name, d.zone, date_trunc('${period}', si.changed_at)
    ORDER BY period_start DESC, si.device_id
    LIMIT $${params.length}
  `;

  const result = await pool.query(query, params);

  // Convertir les secondes en format lisible
  const stats = result.rows.map((row) => ({
    ...row,
    on_duration_formatted:  formatDuration(Number(row.on_duration_seconds)),
    off_duration_formatted: formatDuration(Number(row.off_duration_seconds)),
  }));

  res.json({
    period: periodLabel(period),
    stats,
  });
};

function formatDuration(seconds: number): string {
  if (seconds < 60)   return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}min`;
}
