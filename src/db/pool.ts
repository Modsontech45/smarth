import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const isLocal = (process.env.DATABASE_URL ?? '').includes('localhost');

const _pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

_pool.on('error', (err) => {
  console.error('[pool] idle client error:', err.message);
});

// Circuit breaker — opens after OPEN_AFTER consecutive failures,
// stays open for COOLDOWN_MS before allowing one probe through.
let _failures   = 0;
let _circuitUntil = 0;
const OPEN_AFTER  = 3;
const COOLDOWN_MS = 60_000;

export function dbIsOnline(): boolean {
  return _failures < OPEN_AFTER || Date.now() >= _circuitUntil;
}

async function resilientQuery(text: any, values?: any): Promise<any> {
  if (!dbIsOnline()) {
    throw Object.assign(new Error('DB circuit open'), { code: 'DB_CIRCUIT_OPEN' });
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = values !== undefined
        ? await _pool.query(text, values)
        : await _pool.query(text);

      if (_failures > 0) {
        console.log('[pool] DB connection restored');
        _failures = 0;
      }
      return result;
    } catch (err: any) {
      // AggregateError (multi-host DNS) exposes code on the first inner error
      const code = err.code ?? (err.errors as any[] | undefined)?.[0]?.code ?? '';
      const msg  = String(err.message ?? '');
      const retryable =
        code === 'ECONNRESET'   ||
        code === 'ECONNREFUSED' ||
        code === 'ETIMEDOUT'    ||
        msg.includes('Connection terminated') ||
        msg.includes('connection timeout');

      if (retryable && attempt < 2) {
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }

      _failures++;
      if (_failures >= OPEN_AFTER) {
        _circuitUntil = Date.now() + COOLDOWN_MS;
        if (_failures === OPEN_AFTER) {
          console.warn(`[pool] circuit OPEN — DB unreachable (${code || msg}). Retrying in ${COOLDOWN_MS / 1000}s`);
        }
      }
      throw err;
    }
  }
}

export const pool = {
  query:   resilientQuery as typeof _pool.query,
  connect: _pool.connect.bind(_pool),
  end:     _pool.end.bind(_pool),
};
