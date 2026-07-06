import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host:              process.env.SMTP_HOST || 'smtp.gmail.com',
  port:              Number(process.env.SMTP_PORT) || 587,
  secure:            false,
  connectionTimeout: 8000,
  greetingTimeout:   8000,
  socketTimeout:     8000,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const FROM       = process.env.SMTP_FROM  || 'Skylorx <noreply@skylorx.io>';

export async function sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
  const link = `${CLIENT_URL}/verify-email/${token}`;
  await transporter.sendMail({
    from:    FROM,
    to,
    subject: 'Vérifiez votre compte Skylorx',
    html: `
      <h2>Bonjour ${name},</h2>
      <p>Merci de vous être inscrit. Cliquez sur le lien ci-dessous pour vérifier votre adresse email :</p>
      <p><a href="${link}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Vérifier mon email</a></p>
      <p>Ce lien expire dans <strong>24 heures</strong>.</p>
      <p>Si vous n'avez pas créé de compte, vous pouvez ignorer cet email.</p>
    `,
  });
}

export async function sendInvitationEmail(
  to: string,
  inviterName: string,
  role: string,
  token: string
): Promise<void> {
  const link      = `${CLIENT_URL}/accept-invite?token=${token}`;
  const roleLabel = role === 'GUEST' ? 'Invité' : 'Utilisateur';
  await transporter.sendMail({
    from:    FROM,
    to,
    subject: `${inviterName} vous invite à rejoindre Skylorx`,
    html: `
      <h2>Vous avez été invité !</h2>
      <p><strong>${inviterName}</strong> vous invite à rejoindre son système Skylorx en tant que <strong>${roleLabel}</strong>.</p>
      <p>Cliquez sur le bouton ci-dessous pour créer votre compte :</p>
      <p><a href="${link}" style="background:#16a34a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Accepter l'invitation</a></p>
      <p>Ce lien expire dans <strong>48 heures</strong>.</p>
      <p>Si vous ne connaissez pas cette personne, vous pouvez ignorer cet email.</p>
    `,
  });
}

export async function sendPasswordResetEmail(to: string, name: string, token: string): Promise<void> {
  const link = `${CLIENT_URL}/reset-password?token=${token}`;
  await transporter.sendMail({
    from:    FROM,
    to,
    subject: 'Réinitialisation de votre mot de passe Skylorx',
    html: `
      <h2>Bonjour ${name},</h2>
      <p>Vous avez demandé une réinitialisation de mot de passe. Cliquez sur le lien ci-dessous pour définir un nouveau mot de passe :</p>
      <p><a href="${link}" style="background:#dc2626;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Réinitialiser mon mot de passe</a></p>
      <p>Ce lien expire dans <strong>1 heure</strong>.</p>
      <p>Si vous n'avez pas fait cette demande, vous pouvez ignorer cet email. Votre mot de passe ne sera pas modifié.</p>
    `,
  });
}
