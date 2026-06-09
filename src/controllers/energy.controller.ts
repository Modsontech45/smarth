import { Response } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';

// Auto-select bucket granularity from the date range
function getBucketTrunc(from: Date, to: Date): string {
  const hours = (to.getTime() - from.getTime()) / 3_600_000;
  if (hours <= 48)  return 'hour';
  if (hours <= 2160) return 'day';   // ≤ 90 days
  return 'month';
}

function fmtTrunc(trunc: string): string {
  return { hour: 'heure', day: 'jour', month: 'mois' }[trunc] ?? trunc;
}

// ─── GET /api/energy ─────────────────────────────────────────
// ?from=ISO  &to=ISO  &device_id=X (optional)
export const getEnergyStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const fromStr   = req.query.from   as string | undefined;
  const toStr     = req.query.to     as string | undefined;
  const device_id = req.query.device_id ? Number(req.query.device_id) : null;

  if (!fromStr || !toStr) {
    res.status(400).json({ error: 'Les paramètres from et to sont obligatoires (ISO 8601).' });
    return;
  }

  const fromDate = new Date(fromStr);
  const toDate   = new Date(toStr);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    res.status(400).json({ error: 'Dates invalides. Utilisez le format ISO 8601.' });
    return;
  }
  if (fromDate >= toDate) {
    res.status(400).json({ error: 'from doit être antérieur à to.' });
    return;
  }

  const userId = req.user!.userId;
  const trunc  = getBucketTrunc(fromDate, toDate);

  const params: (string | number | Date)[] = [userId, fromDate, toDate];
  let deviceFilter = '';

  if (device_id) {
    const check = await pool.query(
      'SELECT id FROM devices WHERE id=$1 AND owner_id=$2 AND type=$3',
      [device_id, userId, 'OUTPUT'],
    );
    if ((check.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Actionneur introuvable' });
      return;
    }
    params.push(device_id);
    deviceFilter = `AND d.id = $${params.length}`;
  }

  // ── Timeline ───────────────────────────────────────────────
  const timelineQ = `
    SELECT
      date_trunc('${trunc}', er.recorded_at) AS period_start,
      COALESCE(SUM(er.energy_wh), 0)         AS total_wh,
      COALESCE(AVG(er.power_w), 0)           AS avg_power_w
    FROM energy_readings er
    JOIN devices d ON d.id = er.device_id
    WHERE d.owner_id = $1
      AND d.type = 'OUTPUT'
      AND er.recorded_at BETWEEN $2 AND $3
      ${deviceFilter}
    GROUP BY date_trunc('${trunc}', er.recorded_at)
    ORDER BY period_start ASC
  `;

  // ── Per-device totals ──────────────────────────────────────
  const deviceQ = `
    SELECT
      d.id                               AS device_id,
      d.name                             AS device_name,
      d.zone,
      COALESCE(SUM(er.energy_wh), 0)     AS total_wh,
      COALESCE(AVG(er.power_w), 0)       AS avg_power_w,
      COUNT(er.id)                       AS reading_count
    FROM devices d
    LEFT JOIN energy_readings er
      ON er.device_id = d.id
      AND er.recorded_at BETWEEN $2 AND $3
    WHERE d.owner_id = $1
      AND d.type = 'OUTPUT'
      ${deviceFilter}
    GROUP BY d.id, d.name, d.zone
    ORDER BY total_wh DESC
  `;

  const [timelineRes, deviceRes] = await Promise.all([
    pool.query(timelineQ, params),
    pool.query(deviceQ,   params),
  ]);

  const totalWh = deviceRes.rows.reduce((s, r) => s + Number(r.total_wh), 0);

  const byDevice = deviceRes.rows.map(r => ({
    device_id:     r.device_id,
    device_name:   r.device_name,
    zone:          r.zone,
    total_wh:      Number(r.total_wh),
    total_kwh:     Number(r.total_wh) / 1000,
    avg_power_w:   Number(r.avg_power_w),
    reading_count: Number(r.reading_count),
    share_pct:     totalWh > 0 ? Math.round((Number(r.total_wh) / totalWh) * 100) : 0,
  }));

  const timeline = timelineRes.rows.map(r => ({
    period_start: r.period_start,
    total_wh:     Number(r.total_wh),
    total_kwh:    Number(r.total_wh) / 1000,
    avg_power_w:  Number(r.avg_power_w),
  }));

  res.json({
    from:    fromDate,
    to:      toDate,
    trunc,
    trunc_label: fmtTrunc(trunc),
    summary: {
      total_wh:     totalWh,
      total_kwh:    totalWh / 1000,
      device_count: byDevice.length,
    },
    timeline,
    by_device: byDevice,
  });
};
