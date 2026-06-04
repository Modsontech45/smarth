import { Router } from 'express';
import {
  register,
  login,
  verifyEmail,
  forgotPassword,
  resetPassword,
  googleAuth,
  getMe,
  regenerateApiKey,
} from '../controllers/auth.controller';
import {
  inviteUser,
  acceptInvite,
  getInvitations,
  cancelInvitation,
} from '../controllers/invite.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Authentification
 *   description: Endpoints d'authentification
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Créer un nouveau compte
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name:     { type: string, example: Alice }
 *               email:    { type: string, format: email, example: alice@smarthome.com }
 *               password: { type: string, minLength: 8, example: "motdepasse1!" }
 *     responses:
 *       201:
 *         description: Compte créé — api_key retournée une seule fois
 *       400:
 *         description: Erreur de validation
 *       409:
 *         description: Email déjà utilisé
 */
router.post('/register', register);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Connexion avec email et mot de passe
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:    { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Connexion réussie — retourne un token JWT
 *       401:
 *         description: Identifiants incorrects
 *       403:
 *         description: Email non vérifié
 */
router.post('/login', login);

/**
 * @swagger
 * /api/auth/verify-email/{token}:
 *   get:
 *     summary: Vérifier l'adresse email
 *     tags: [Authentification]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Email vérifié avec succès
 *       400:
 *         description: Token invalide ou expiré
 */
router.get('/verify-email/:token', verifyEmail);

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Demander un lien de réinitialisation du mot de passe
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Email envoyé (toujours 200 pour éviter l'énumération des emails)
 */
router.post('/forgot-password', forgotPassword);

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Réinitialiser le mot de passe avec le token reçu par email
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token:    { type: string }
 *               password: { type: string, minLength: 8 }
 *     responses:
 *       200:
 *         description: Mot de passe réinitialisé avec succès
 *       400:
 *         description: Token invalide/expiré ou mot de passe trop court
 */
router.post('/reset-password', resetPassword);

/**
 * @swagger
 * /api/auth/google:
 *   post:
 *     summary: Connexion ou inscription via Google
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_token]
 *             properties:
 *               id_token: { type: string, description: "Token Google ID obtenu côté client" }
 *     responses:
 *       200:
 *         description: Utilisateur existant connecté
 *       201:
 *         description: Nouveau compte créé via Google — api_key retournée une seule fois
 *       401:
 *         description: Token Google invalide
 */
router.post('/google', googleAuth);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Obtenir le profil de l'utilisateur connecté
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profil utilisateur avec api_key
 *       401:
 *         description: Non authentifié
 */
router.get('/me', verifyJWT, getMe);

/**
 * @swagger
 * /api/auth/regenerate-api-key:
 *   post:
 *     summary: Régénérer la clé API du compte
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Nouvelle api_key retournée — mettre à jour le firmware ESP32
 *       401:
 *         description: Non authentifié
 */
router.post('/regenerate-api-key', verifyJWT, regenerateApiKey);

/**
 * @swagger
 * /api/auth/invite:
 *   post:
 *     summary: Inviter un utilisateur ou un invité (ADMIN)
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *               role:  { type: string, enum: [USER, GUEST], default: USER }
 *     responses:
 *       201:
 *         description: Invitation envoyée par email (lien valable 48h)
 *       409:
 *         description: Email déjà inscrit ou invitation déjà en attente
 *       403:
 *         description: Permissions insuffisantes
 */
router.post('/invite', verifyJWT, requireRole('ADMIN'), inviteUser);

/**
 * @swagger
 * /api/auth/accept-invite:
 *   post:
 *     summary: Accepter une invitation et créer son compte
 *     tags: [Authentification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, name, password]
 *             properties:
 *               token:    { type: string }
 *               name:     { type: string }
 *               password: { type: string, minLength: 8 }
 *     responses:
 *       201:
 *         description: Compte créé avec le rôle assigné par l'ADMIN
 *       400:
 *         description: Token invalide/expiré ou données manquantes
 */
router.post('/accept-invite', acceptInvite);

/**
 * @swagger
 * /api/auth/invitations:
 *   get:
 *     summary: Lister toutes les invitations envoyées (ADMIN)
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des invitations
 */
router.get('/invitations', verifyJWT, requireRole('ADMIN'), getInvitations);

/**
 * @swagger
 * /api/auth/invitations/{id}:
 *   delete:
 *     summary: Annuler une invitation en attente (ADMIN)
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Invitation annulée
 *       404:
 *         description: Invitation introuvable ou déjà acceptée
 */
router.delete('/invitations/:id', verifyJWT, requireRole('ADMIN'), cancelInvitation);

export default router;
