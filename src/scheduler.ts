import { pool } from './db/pool';
import { emitToUser } from './socket';
import https from 'https';

export function startScheduler(): void {
  // Offline detection — runs every 30 s
  setInterval(async () => {
    try {
      const { rows } = await pool.query<{ id: number; owner_id: number }>(
        `UPDATE devices SET status = 'OFFLINE'
         WHERE last_seen < NOW() - INTERVAL '90 seconds' AND status = 'ONLINE'
         RETURNING id, owner_id`,
      );
      for (const d of rows) {
        emitToUser(d.owner_id, 'device:status', { deviceId: d.id, status: 'OFFLINE' });
      }
      if (rows.length > 0) {
        console.log(`[Scheduler] Marked ${rows.length} device(s) OFFLINE`);
      }
    } catch (err) {
      console.error('[Scheduler] Offline detection error:', err);
    }
  }, 30_000);

  // Self-ping every 10 min — prevents Render free tier from sleeping
  const selfUrl = process.env.RENDER_EXTERNAL_URL ?? process.env.BACKEND_URL;
  if (selfUrl) {
    setInterval(() => {
      https.get(`${selfUrl}/health`, (res) => {
        res.resume();
      }).on('error', () => {});
    }, 10 * 60 * 1000);
    console.log('[Scheduler] Keep-alive ping started (10 min interval)');
  }

  console.log('[Scheduler] Device offline detection started (30 s interval)');
}
