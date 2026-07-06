import { Response } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';

// Bucket granularity — used only for the per-device timeline chart
function getBucketTrunc(from: Date, to: Date): string {
  const hours = (to.getTime() - from.getTime()) / 3_600_000;
  if (hours <= 48)   return 'hour';
  if (hours <= 2160) return 'day';
  return 'month';
}

// Max gap (seconds) between consecutive sensor readings before we call it "offline"
const SENSOR_GAP_SEC = 3600; // 1 hour

// ─── GET /api/devices/uptime ─────────────────────────────────────────────────
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

  const userId     = req.user!.userId;
  const deviceCond = device_id ? `AND d.id = $4` : '';
  const params: (string | number | Date)[] = [userId, fromDate, toDate];
  if (device_id) params.push(device_id);

  // ── Real-data uptime query ────────────────────────────────────────────────
  //
  // INPUT  devices: sum of consecutive-reading intervals ≤ SENSOR_GAP_SEC
  // OUTPUT devices: sum of actuator ON-intervals from state_history,
  //                 seeded with the last known state before $from
  //
  const summaryQ = `
  WITH

  -- ── Sensor coverage (INPUT / all devices with sensor data) ───────
  sensor_ts AS (
    SELECT DISTINCT sr.device_id, sr.recorded_at AS ts
    FROM   sensor_readings sr
    JOIN   devices d ON d.id = sr.device_id
    WHERE  d.owner_id = $1
      AND  sr.recorded_at BETWEEN $2 AND $3
      ${deviceCond}

    UNION

    SELECT DISTINCT er.device_id, er.recorded_at AS ts
    FROM   energy_readings er
    JOIN   devices d ON d.id = er.device_id
    WHERE  d.owner_id = $1
      AND  er.recorded_at BETWEEN $2 AND $3
      ${deviceCond}
  ),
  sensor_lead AS (
    SELECT device_id, ts,
           LEAD(ts) OVER (PARTITION BY device_id ORDER BY ts) AS next_ts
    FROM   sensor_ts
  ),
  sensor_online AS (
    SELECT device_id,
           COALESCE(SUM(
             CASE WHEN next_ts IS NOT NULL
                   AND EXTRACT(EPOCH FROM (next_ts - ts)) <= ${SENSOR_GAP_SEC}
                  THEN EXTRACT(EPOCH FROM (next_ts - ts))
                  ELSE 0
             END
           ), 0) AS online_seconds
    FROM   sensor_lead
    GROUP  BY device_id
  ),

  -- ── Actuator ON-time (OUTPUT devices) ────────────────────────────
  -- Seed with the last known state BEFORE $from so we know if it was
  -- already ON when the period started.
  last_state_before AS (
    SELECT DISTINCT ON (h.device_id)
           h.device_id, h.state
    FROM   actuator_state_history h
    JOIN   devices d ON d.id = h.device_id
    WHERE  d.owner_id = $1
      AND  h.changed_at < $2
      ${deviceCond}
    ORDER  BY h.device_id, h.changed_at DESC
  ),
  state_in_range AS (
    SELECT h.device_id, h.changed_at, h.state
    FROM   actuator_state_history h
    JOIN   devices d ON d.id = h.device_id
    WHERE  d.owner_id = $1
      AND  h.changed_at BETWEEN $2 AND $3
      ${deviceCond}
  ),
  all_states AS (
    SELECT device_id, $2::timestamptz AS changed_at, state
    FROM   last_state_before
    UNION ALL
    SELECT device_id, changed_at, state
    FROM   state_in_range
  ),
  state_with_next AS (
    SELECT device_id, changed_at, state,
           LEAD(changed_at) OVER (PARTITION BY device_id ORDER BY changed_at) AS next_at
    FROM   all_states
  ),
  actuator_on_time AS (
    SELECT swn.device_id,
           COALESCE(SUM(
             CASE WHEN swn.state = true
                  THEN EXTRACT(EPOCH FROM (
                    LEAST(
                      COALESCE(swn.next_at,
                        -- Cap open ON intervals at last_seen when ESP32 is offline
                        CASE WHEN d.status = 'OFFLINE' AND d.last_seen IS NOT NULL
                             THEN LEAST(d.last_seen, $3::timestamptz)
                             ELSE $3::timestamptz
                        END
                      ),
                      $3::timestamptz
                    ) - swn.changed_at
                  ))
                  ELSE 0
             END
           ), 0) AS online_seconds
    FROM   state_with_next swn
    JOIN   devices d ON d.id = swn.device_id
    WHERE  swn.changed_at < $3::timestamptz
    GROUP  BY swn.device_id
  )

  -- ── Final result ─────────────────────────────────────────────────
  SELECT
    d.id                                                            AS device_id,
    d.name                                                          AS device_name,
    d.zone,
    d.type,
    d.status,
    GREATEST(0, LEAST(
      CASE
        WHEN d.type = 'OUTPUT' THEN COALESCE(ao.online_seconds, 0)
        ELSE COALESCE(so.online_seconds, 0)
      END,
      EXTRACT(EPOCH FROM ($3::timestamptz - $2::timestamptz))
    ))                                                              AS online_seconds,
    EXTRACT(EPOCH FROM ($3::timestamptz - $2::timestamptz))         AS total_seconds
  FROM      devices d
  LEFT JOIN sensor_online    so ON so.device_id = d.id
  LEFT JOIN actuator_on_time ao ON ao.device_id = d.id
  WHERE  d.owner_id = $1
    ${deviceCond}
  ORDER BY d.zone, d.name
  `;

  const summaryRes = await pool.query(summaryQ, params);

  const devices = summaryRes.rows.map(r => {
    const onlineSec  = Math.round(parseFloat(r.online_seconds)  || 0);
    const totalSec   = Math.round(parseFloat(r.total_seconds)   || 0);
    const offlineSec = Math.max(0, totalSec - onlineSec);
    return {
      device_id:       r.device_id,
      device_name:     r.device_name,
      zone:            r.zone,
      type:            r.type,
      status:          r.status,
      online_seconds:  onlineSec,
      offline_seconds: offlineSec,
      total_seconds:   totalSec,
      online_pct:      totalSec > 0 ? Math.round((onlineSec / totalSec) * 100) : 0,
    };
  });

  // ── Timeline per device (when device_id given) — bucket chart ────────────
  const trunc = getBucketTrunc(fromDate, toDate);
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
