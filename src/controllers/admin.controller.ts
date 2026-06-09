import { Response } from 'express';
import { pool }     from '../db/pool';
import { AuthenticatedRequest } from '../types';

// ─── GET /api/admin/users ─────────────────────────────────────
export const listUsers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(`
    SELECT
      u.id, u.name, u.email, u.role, u.email_verified,
      u.created_at,
      COALESCE(
        json_agg(uzr.zone ORDER BY uzr.zone)
          FILTER (WHERE uzr.zone IS NOT NULL),
        '[]'
      ) AS restricted_zones
    FROM users u
    LEFT JOIN user_zone_restrictions uzr ON uzr.user_id = u.id
    WHERE u.email IN (
      SELECT email FROM invitations
      WHERE invited_by = $1 AND accepted = TRUE
    )
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `, [req.user!.userId]);

  res.json({ users: result.rows });
};

// ─── PUT /api/admin/users/:id/role ───────────────────────────
export const updateUserRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { role } = req.body;
  if (!['USER', 'GUEST'].includes(String(role))) {
    res.status(400).json({ error: 'Rôle invalide (USER | GUEST)' });
    return;
  }
  const ownership = await pool.query(
    `SELECT u.id FROM users u
     JOIN invitations i ON i.email = u.email
     WHERE u.id = $1 AND i.invited_by = $2 AND i.accepted = TRUE`,
    [req.params.id, req.user!.userId]
  );
  if ((ownership.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Utilisateur introuvable' });
    return;
  }
  const result = await pool.query(
    `UPDATE users SET role = $1 WHERE id = $2
     RETURNING id, name, email, role`,
    [role, req.params.id]
  );
  res.json({ user: result.rows[0] });
};

// ─── PUT /api/admin/users/:id/restrictions ───────────────────
// Body: { restricted_zones: string[] }
// Empty array = no restrictions (full access).
export const setUserRestrictions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { restricted_zones } = req.body;
  if (!Array.isArray(restricted_zones)) {
    res.status(400).json({ error: 'restricted_zones doit être un tableau' });
    return;
  }

  const userId = parseInt(req.params.id);

  const ownership = await pool.query(
    `SELECT u.id FROM users u
     JOIN invitations i ON i.email = u.email
     WHERE u.id = $1 AND i.invited_by = $2 AND i.accepted = TRUE`,
    [userId, req.user!.userId]
  );
  if ((ownership.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Utilisateur introuvable' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_zone_restrictions WHERE user_id = $1', [userId]);
    for (const zone of restricted_zones as string[]) {
      await client.query(
        'INSERT INTO user_zone_restrictions (user_id, zone) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, String(zone)]
      );
    }
    await client.query('COMMIT');
    res.json({ restricted_zones });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── DELETE /api/admin/users/:id ─────────────────────────────
export const deleteUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const ownership = await pool.query(
    `SELECT u.id, u.name, u.email FROM users u
     JOIN invitations i ON i.email = u.email
     WHERE u.id = $1 AND i.invited_by = $2 AND i.accepted = TRUE`,
    [req.params.id, req.user!.userId]
  );
  if ((ownership.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Utilisateur introuvable' });
    return;
  }
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ message: `Utilisateur "${ownership.rows[0].name}" supprimé` });
};
