import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { pool } from '../db/pool';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/email.service';
import { AuthenticatedRequest, JWTPayload } from '../types';

const SALT_ROUNDS  = 12;
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: (process.env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn']) || '24h',
  });
}

// ─── POST /api/auth/register ────────────────────────────────
export const register = async (req: Request, res: Response): Promise<void> => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    res.status(400).json({ error: 'Le nom, l\'email et le mot de passe sont obligatoires' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
    return;
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if ((existing.rowCount ?? 0) > 0) {
    res.status(409).json({ error: 'Cet email est déjà utilisé' });
    return;
  }

  const hashedPassword     = await bcrypt.hash(password, SALT_ROUNDS);
  const apiKey             = crypto.randomBytes(Number(process.env.API_KEY_BYTES) || 32).toString('hex');
  const emailVerifyToken   = crypto.randomBytes(32).toString('hex');
  const emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 h

  const result = await pool.query(
    `INSERT INTO users
       (name, email, password, api_key, email_verify_token, email_verify_expires)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, email, role, api_key`,
    [name, email.toLowerCase(), hashedPassword, apiKey, emailVerifyToken, emailVerifyExpires]
  );

  const user = result.rows[0];

  try {
    await sendVerificationEmail(email, name, emailVerifyToken);
  } catch (err) {
    console.error('Échec de l\'envoi de l\'email de vérification :', err);
  }

  res.status(201).json({
    message: 'Compte créé avec succès. Veuillez vérifier votre email pour activer votre compte.',
    api_key: user.api_key,
    user: {
      id:    user.id,
      name:  user.name,
      email: user.email,
      role:  user.role,
    },
  });
};

// ─── POST /api/auth/login ────────────────────────────────────
export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'L\'email et le mot de passe sont obligatoires' });
    return;
  }

  const result = await pool.query(
    'SELECT id, name, email, password, role, email_verified FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(401).json({ error: 'Identifiants incorrects' });
    return;
  }

  const user = result.rows[0];

  if (!user.password) {
    res.status(401).json({ error: 'Ce compte utilise la connexion Google. Veuillez vous connecter avec Google.' });
    return;
  }

  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) {
    res.status(401).json({ error: 'Identifiants incorrects' });
    return;
  }

  if (!user.email_verified) {
    res.status(403).json({ error: 'Veuillez vérifier votre email avant de vous connecter.' });
    return;
  }

  const token = signToken({ userId: user.id, email: user.email, role: user.role });

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
};

// ─── GET /api/auth/verify-email/:token ──────────────────────
export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;

  if (!token) {
    res.status(400).json({ error: 'Le token de vérification est obligatoire' });
    return;
  }

  const result = await pool.query(
    `SELECT id FROM users
     WHERE email_verify_token = $1
       AND email_verify_expires > NOW()
       AND email_verified = FALSE`,
    [token]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(400).json({ error: 'Token invalide ou expiré' });
    return;
  }

  await pool.query(
    `UPDATE users
     SET email_verified = TRUE,
         email_verify_token = NULL,
         email_verify_expires = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [result.rows[0].id]
  );

  res.json({ message: 'Email vérifié avec succès. Vous pouvez maintenant vous connecter.' });
};

// ─── POST /api/auth/forgot-password ─────────────────────────
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;

  if (!email) {
    res.status(400).json({ error: 'L\'email est obligatoire' });
    return;
  }

  const result = await pool.query(
    'SELECT id, name FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  // Toujours répondre 200 pour éviter l'énumération des emails
  if ((result.rowCount ?? 0) === 0) {
    res.json({ message: 'Si cet email est enregistré, un lien de réinitialisation a été envoyé.' });
    return;
  }

  const user    = result.rows[0];
  const token   = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 h

  await pool.query(
    `UPDATE users
     SET reset_password_token = $1,
         reset_password_expires = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [token, expires, user.id]
  );

  try {
    await sendPasswordResetEmail(email, user.name, token);
  } catch (err) {
    console.error('Échec de l\'envoi de l\'email de réinitialisation :', err);
  }

  res.json({ message: 'Si cet email est enregistré, un lien de réinitialisation a été envoyé.' });
};

// ─── POST /api/auth/reset-password ──────────────────────────
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  const { token, password } = req.body;

  if (!token || !password) {
    res.status(400).json({ error: 'Le token et le mot de passe sont obligatoires' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
    return;
  }

  const result = await pool.query(
    `SELECT id FROM users
     WHERE reset_password_token = $1
       AND reset_password_expires > NOW()`,
    [token]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(400).json({ error: 'Token invalide ou expiré' });
    return;
  }

  const hashed = await bcrypt.hash(password, SALT_ROUNDS);

  await pool.query(
    `UPDATE users
     SET password = $1,
         reset_password_token = NULL,
         reset_password_expires = NULL,
         updated_at = NOW()
     WHERE id = $2`,
    [hashed, result.rows[0].id]
  );

  res.json({ message: 'Mot de passe réinitialisé avec succès. Vous pouvez maintenant vous connecter.' });
};

// ─── POST /api/auth/google ───────────────────────────────────
export const googleAuth = async (req: Request, res: Response): Promise<void> => {
  const { id_token } = req.body;

  if (!id_token) {
    res.status(400).json({ error: 'Le id_token est obligatoire' });
    return;
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    res.status(401).json({ error: 'Token Google invalide' });
    return;
  }

  if (!payload?.email || !payload.sub) {
    res.status(401).json({ error: 'Impossible d\'extraire le profil depuis le token Google' });
    return;
  }

  const { sub: googleId, email, name, email_verified } = payload;

  let result = await pool.query(
    'SELECT id, name, email, role FROM users WHERE google_id = $1 OR email = $2',
    [googleId, email.toLowerCase()]
  );

  let user = result.rows[0];

  if (!user) {
    const apiKey = crypto.randomBytes(Number(process.env.API_KEY_BYTES) || 32).toString('hex');

    const insert = await pool.query(
      `INSERT INTO users (name, email, google_id, api_key, email_verified)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, role, api_key`,
      [name || email.split('@')[0], email.toLowerCase(), googleId, apiKey, email_verified ?? true]
    );
    user = insert.rows[0];

    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    res.status(201).json({
      token,
      api_key: user.api_key,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
    return;
  }

  if (!result.rows[0].google_id) {
    await pool.query(
      'UPDATE users SET google_id = $1, email_verified = TRUE, updated_at = NOW() WHERE id = $2',
      [googleId, user.id]
    );
  }

  const token = signToken({ userId: user.id, email: user.email, role: user.role });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
};

// ─── GET /api/auth/me ────────────────────────────────────────
export const getMe = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;

  const result = await pool.query(
    'SELECT id, name, email, role, api_key, email_verified, created_at FROM users WHERE id = $1',
    [userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Utilisateur introuvable' });
    return;
  }

  res.json({ user: result.rows[0] });
};

// ─── POST /api/auth/regenerate-api-key ──────────────────────
export const regenerateApiKey = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const newKey = crypto.randomBytes(Number(process.env.API_KEY_BYTES) || 32).toString('hex');

  await pool.query(
    'UPDATE users SET api_key = $1, updated_at = NOW() WHERE id = $2',
    [newKey, userId]
  );

  res.json({
    message: 'Clé API régénérée avec succès. Mettez à jour le firmware de votre ESP32 avec la nouvelle clé.',
    api_key: newKey,
  });
};
