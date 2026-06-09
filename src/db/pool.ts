import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const _pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

_pool.on('error', (err) => {
  console.error('[pool] idle client error:', err.message);
});

// Wraps pool.query with up to 3 retries on Neon cold-start resets.
async function resilientQuery(text: any, values?: any): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return values !== undefined
        ? await _pool.query(text, values)
        : await _pool.query(text);
    } catch (err: any) {
      const retryable =
        err.code === 'ECONNRESET' ||
        err.code === 'ECONNREFUSED' ||
        err.message?.includes('Connection terminated') ||
        err.message?.includes('connection timeout');

      if (retryable && attempt < 2) {
        const delay = 600 * (attempt + 1);
        console.warn(`[pool] retry ${attempt + 1}/3 in ${delay}ms — ${err.code ?? err.message}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// Export a pool-shaped object so all controllers keep using pool.query unchanged.
// Cast query to Pool's overloaded signature so generic calls like pool.query<T>() still compile.
export const pool = {
  query:   resilientQuery as typeof _pool.query,
  connect: _pool.connect.bind(_pool),
  end:     _pool.end.bind(_pool),
};
