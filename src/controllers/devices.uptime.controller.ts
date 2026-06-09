import { Response } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';

// Auto-select bucket granularity from the date range
function getBucketTrunc(from: Date, to: Date): string {
  const hours = (to.getTime() - from.getTime()) / 3_600_000;
  if (hours <= 48)   return 'hour';
  if (hours <= 2160) return 'day';   // ≤ 90 days
  return 'month';
}

function bucketHours(trunc: string): number {
  return trunc === 'hour' ? 1 : trunc === 'day' ? 24 : 720;
}

// ─── GET /api/devices/uptime ──────────────────────────────────
// ?from=ISO  &to=ISO  &device_id=X (optional)
export const getDeviceUptime = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
  const bkHrs  = bucketHours(trunc);

  // Approximate total number of buckets in the range
  const totalHours   = (toDate.getTime() - fromDate.getTime()) / 3_600_000;
  const totalBuckets = Math.ceil(totalHours / bkHrs);

  const baseParams: (string | number | Date)[] = [userId, fromDate, toDate];
  const deviceCond = device_id ? `AND d.id = $4` : '';
  const summaryParams = device_id ? [...baseParams, device_id] : baseParams;

  // ── Summary: online buckets per device ───────────────────────
  const summaryQ = `
    WITH activity AS (
      SELECT sr.device_id,
             date_trunc('${trunc}', sr.recorded_at) AS bucket
      FROM sensor_readings sr
      JOIN devices d ON d.id = sr.device_id
      WHERE d.owner_id = $1
        AND sr.recorded_at BETWEEN $2 AND $3

      UNION

      SELECT er.device_id,
             date_trunc('${trunc}', er.recorded_at) AS bucket
      FROM energy_readings er
      JOIN devices d ON d.id = er.device_id
      WHERE d.owner_id = $1
        AND er.recorded_at BETWEEN $2 AND $3

      UNION

      SELECT h.device_id,
             date_trunc('${trunc}', h.changed_at) AS bucket
      FROM actuator_state_history h
      JOIN devices d ON d.id = h.device_id
      WHERE d.owner_id = $1
        AND h.changed_at BETWEEN $2 AND $3
    )
    SELECT
      d.id                                                                  AS device_id,
      d.name                                                                AS device_name,
      d.zone,
      d.type,
      d.status,
      COUNT(DISTINCT a.bucket)                                              AS online_buckets,
      GREATEST(0, ${totalBuckets} - COUNT(DISTINCT a.bucket)::int)         AS offline_buckets
    FROM devices d
    LEFT JOIN activity a ON a.device_id = d.id
    WHERE d.owner_id = $1
      ${deviceCond}
    GROUP BY d.id, d.name, d.zone, d.type, d.status
    ORDER BY d.zone, d.name
  `;

  const summaryRes = await pool.query(summaryQ, summaryParams);

  const devices = summaryRes.rows.map(r => {
    const online  = Number(r.online_buckets);
    const offline = Math.max(0, totalBuckets - online);
    return {
      device_id:       r.device_id,
      device_name:     r.device_name,
      zone:            r.zone,
      type:            r.type,
      status:          r.status,
      online_buckets:  online,
      offline_buckets: offline,
      total_buckets:   totalBuckets,
      online_hours:    online  * bkHrs,
      offline_hours:   offline * bkHrs,
      online_pct:      totalBuckets > 0 ? Math.round((online / totalBuckets) * 100) : 0,
    };
  });

  // ── Timeline per device (when device_id given) ────────────────
  let timeline: { bucket_start: Date; is_online: boolean }[] = [];

  if (device_id) {
    const timelineQ = `
      WITH all_buckets AS (
        SELECT generate_series(
          date_trunc('${trunc}', $2::timestamptz),
          date_trunc('${trunc}', $3::timestamptz),
          INTERVAL '1 ${trunc}'
        ) AS bucket_start
      ),
      active_buckets AS (
        SELECT DISTINCT date_trunc('${trunc}', recorded_at) AS bucket
        FROM sensor_readings
        WHERE device_id = $4 AND recorded_at BETWEEN $2 AND $3

        UNION

        SELECT DISTINCT date_trunc('${trunc}', recorded_at) AS bucket
        FROM energy_readings
        WHERE device_id = $4 AND recorded_at BETWEEN $2 AND $3

        UNION

        SELECT DISTINCT date_trunc('${trunc}', changed_at) AS bucket
        FROM actuator_state_history
        WHERE device_id = $4 AND changed_at BETWEEN $2 AND $3
      )
      SELECT
        ab.bucket_start,
        (act.bucket IS NOT NULL) AS is_online
      FROM all_buckets ab
      LEFT JOIN active_buckets act ON act.bucket = ab.bucket_start
      ORDER BY ab.bucket_start ASC
    `;

    const tlRes = await pool.query(timelineQ, [userId, fromDate, toDate, device_id]);
    timeline = tlRes.rows;
  }

  res.json({ from: fromDate, to: toDate, trunc, devices, timeline });
};
