import { pool } from './db/pool';
import { emitToUser } from './socket';

export function startScheduler(): void {
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

  console.log('[Scheduler] Device offline detection started (30 s interval)');
}
