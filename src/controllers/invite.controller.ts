import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { sendInvitationEmail } from '../services/email.service';
import { AuthenticatedRequest } from '../types';

const SALT_ROUNDS = 12;

// ─── POST /api/auth/invite ───────────────────────────────────
export const inviteUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { email, role } = req.body;

  if (!email) {
    res.status(400).json({ error: 'L\'email est obligatoire' });
    return;
  }

  const validRoles = ['USER', 'GUEST'];
  const assignedRole = role ? String(role).toUpperCase() : 'USER';
  if (!validRoles.includes(assignedRole)) {
    res.status(400).json({ error: 'Le rôle doit être USER ou GUEST' });
    return;
  }

  // Vérifier si l'email est déjà un compte actif
  const existing = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  if ((existing.rowCount ?? 0) > 0) {
    res.status(409).json({ error: 'Un compte avec cet email existe déjà' });
    return;
  }

  // Vérifier si une invitation est déjà en attente pour cet email
  const pendingInvite = await pool.query(
    'SELECT id FROM invitations WHERE email = $1 AND accepted = FALSE AND expires_at > NOW()',
    [email.toLowerCase()]
  );
  if ((pendingInvite.rowCount ?? 0) > 0) {
    res.status(409).json({ error: 'Une invitation est déjà en attente pour cet email' });
    return;
  }

  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 h

  await pool.query(
    `INSERT INTO invitations (email, role, token, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [email.toLowerCase(), assignedRole, token, req.user!.userId, expiresAt]
  );

  // Récupérer le nom de l'admin pour l'email
  const adminResult = await pool.query('SELECT name FROM users WHERE id = $1', [req.user!.userId]);
  const adminName   = adminResult.rows[0]?.name || 'Un administrateur';

  try {
    await sendInvitationEmail(email, adminName, assignedRole, token);
  } catch (err) {
    console.error('Échec de l\'envoi de l\'email d\'invitation :', err);
  }

  res.status(201).json({
    message: `Invitation envoyée à ${email} avec le rôle ${assignedRole}`,
    expires_at: expiresAt,
  });
};

// ─── POST /api/auth/accept-invite ───────────────────────────
export const acceptInvite = async (req: Request, res: Response): Promise<void> => {
  const { token, name, password } = req.body;

  if (!token || !name || !password) {
    res.status(400).json({ error: 'Le token, le nom et le mot de passe sont obligatoires' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
    return;
  }

  // Trouver l'invitation valide
  const inviteResult = await pool.query(
    `SELECT id, email, role, invited_by
     FROM invitations
     WHERE token = $1 AND accepted = FALSE AND expires_at > NOW()`,
    [token]
  );

  if ((inviteResult.rowCount ?? 0) === 0) {
    res.status(400).json({ error: 'Invitation invalide ou expirée' });
    return;
  }

  const invite = inviteResult.rows[0];

  // Vérifier que l'email n'a pas été inscrit entre-temps
  const existingUser = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [invite.email]
  );
  if ((existingUser.rowCount ?? 0) > 0) {
    res.status(409).json({ error: 'Un compte avec cet email existe déjà' });
    return;
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
  const apiKey         = crypto.randomBytes(Number(process.env.API_KEY_BYTES) || 32).toString('hex');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `INSERT INTO users (name, email, password, role, api_key, email_verified)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, name, email, role, api_key`,
      [name, invite.email, hashedPassword, invite.role, apiKey]
    );

    await client.query(
      'UPDATE invitations SET accepted = TRUE WHERE id = $1',
      [invite.id]
    );

    await client.query('COMMIT');

    const user = userResult.rows[0];

    res.status(201).json({
      message: 'Compte créé avec succès. Vous pouvez maintenant vous connecter.',
      api_key: user.api_key,
      user: {
        id:    user.id,
        name:  user.name,
        email: user.email,
        role:  user.role,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── GET /api/auth/invitations ──────────────────────────────
export const getInvitations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    `SELECT i.id, i.email, i.role, i.accepted, i.expires_at, i.created_at,
            u.name AS invited_by_name
     FROM invitations i
     JOIN users u ON u.id = i.invited_by
     WHERE i.invited_by = $1
     ORDER BY i.created_at DESC`,
    [req.user!.userId]
  );

  res.json({ invitations: result.rows });
};

// ─── DELETE /api/auth/invitations/:id ───────────────────────
export const cancelInvitation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    `DELETE FROM invitations
     WHERE id = $1 AND invited_by = $2 AND accepted = FALSE
     RETURNING id, email`,
    [req.params.id, req.user!.userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Invitation introuvable ou déjà acceptée' });
    return;
  }

  res.json({ message: `Invitation pour ${result.rows[0].email} annulée` });
};
