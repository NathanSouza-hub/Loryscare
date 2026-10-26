const nodemailer = require("nodemailer");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function createMailer({ user = process.env.SMTP_USER, pass = process.env.SMTP_PASS, logger = console } = {}) {
  const transporter = user && pass
    ? nodemailer.createTransport({ service: "gmail", auth: { user, pass } })
    : null;

  async function sendPasswordReset({ to, name, resetUrl }) {
    if (!transporter) {
      logger.warn(`SMTP não configurado; link de redefinição para ${to}: ${resetUrl}`);
      return;
    }
    await transporter.sendMail({
      from: `"Lory's Care" <${user}>`,
      to,
      subject: "Redefinir sua senha do Lory's Care",
      text: `Olá, ${name}!\n\nRecebemos um pedido para redefinir sua senha. Abra o link abaixo para escolher uma nova senha (válido por 1 hora):\n\n${resetUrl}\n\nSe não foi você, ignore este e-mail; sua senha continua a mesma.`,
      html: `<p>Olá, ${escapeHtml(name)}!</p>
<p>Recebemos um pedido para redefinir sua senha. Clique no botão abaixo para escolher uma nova senha. O link vale por 1 hora.</p>
<p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:12px 20px;background:#176b87;color:#fff;border-radius:8px;text-decoration:none">Redefinir senha</a></p>
<p>Se não foi você, ignore este e-mail; sua senha continua a mesma.</p>`,
    });
  }

  return Object.freeze({ sendPasswordReset });
}

module.exports = createMailer;
