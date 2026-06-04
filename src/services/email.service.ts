import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const FROM       = process.env.SMTP_FROM  || 'SmartHome <noreply@smarthome.local>';

export async function sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
  const link = `${CLIENT_URL}/verify-email?token=${token}`;
  await transporter.sendMail({
    from:    FROM,
    to,
    subject: 'Vérifiez votre compte SmartHome',
    html: `
      <h2>Bonjour ${name},</h2>
      <p>Merci de vous être inscrit. Cliquez sur le lien ci-dessous pour vérifier votre adresse email :</p>
      <p><a href="${link}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Vérifier mon email</a></p>
      <p>Ce lien expire dans <strong>24 heures</strong>.</p>
      <p>Si vous n'avez pas créé de compte, vous pouvez ignorer cet email.</p>
    `,
  });
}

export async function sendPasswordResetEmail(to: string, name: string, token: string): Promise<void> {
  const link = `${CLIENT_URL}/reset-password?token=${token}`;
  await transporter.sendMail({
    from:    FROM,
    to,
    subject: 'Réinitialisation de votre mot de passe SmartHome',
    html: `
      <h2>Bonjour ${name},</h2>
      <p>Vous avez demandé une réinitialisation de mot de passe. Cliquez sur le lien ci-dessous pour définir un nouveau mot de passe :</p>
      <p><a href="${link}" style="background:#dc2626;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Réinitialiser mon mot de passe</a></p>
      <p>Ce lien expire dans <strong>1 heure</strong>.</p>
      <p>Si vous n'avez pas fait cette demande, vous pouvez ignorer cet email. Votre mot de passe ne sera pas modifié.</p>
    `,
  });
}
