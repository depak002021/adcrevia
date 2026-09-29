import { deliverEmail } from "./deliver"

type ResetEmail = { to: string; name: string | null; resetUrl: string }

export async function sendPasswordResetEmail(input: ResetEmail) {
  const greeting = input.name ? `Hi ${escapeHtml(input.name)},` : "Hello,"
  await deliverEmail({
    to: input.to,
    subject: "Reset your Adcrevia password",
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;padding:32px;color:#17151f">
        <p style="color:#7357ff;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Adcrevia</p>
        <h1 style="font-size:28px">Reset your password</h1>
        <p>${greeting}</p>
        <p>Use the secure link below to choose a new password. It expires in one hour and works once.</p>
        <p style="margin:28px 0"><a href="${escapeHtml(input.resetUrl)}" style="background:#7357ff;color:white;padding:13px 20px;border-radius:10px;text-decoration:none;font-weight:700">Choose a new password</a></p>
        <p style="color:#6f6b78;font-size:13px">If you did not request this, you can safely ignore this email.</p>
      </div>`,
    text: `Reset your Adcrevia password: ${input.resetUrl}\n\nThis link expires in one hour and works once.`,
  })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character)
}
