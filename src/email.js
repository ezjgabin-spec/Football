// EMAIL VERIFICATION for new accounts: type an email, get a 6-digit code, enter it, THEN pick a username and password.
// The server never keeps the email itself: only a salted hash, so one email = one account without storing anybody's address.
const enc = s => new TextEncoder().encode(s);
const hex = u8 => [...new Uint8Array(u8)].map(x => x.toString(16).padStart(2, '0')).join('');
export const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc(s)));
const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mailnesia.com', 'mintemail.com', 'emailondeck.com']);
// one real mailbox -> one address: lowercase, drop +tags, and Gmail ignores dots
export function normEmail(raw) {
  const e = String(raw || '').trim().toLowerCase(); if (e.length > 80 || !/^[a-z0-9._%+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)+$/.test(e)) return null;
  let [l, d] = e.split('@'); l = l.split('+')[0]; if (d === 'googlemail.com') d = 'gmail.com'; if (d === 'gmail.com') l = l.replace(/\./g, ''); if (!l) return null;
  return { n: l + '@' + d, domain: d };
}
export async function sendMail(env, to, code) {
  if (env.EMAIL_DEV === '1') return { ok: true, dev: code };                                  // local testing only
  const subject = 'Your Ultimate Team code: ' + code, text = 'Your Ultimate Team sign-up code is ' + code + '. It works for 10 minutes. If you did not ask for it, ignore this email.';
  try {
    if (env.RESEND_API_KEY && env.MAIL_FROM) { const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.RESEND_API_KEY }, body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }) }); return r.ok ? { ok: true } : { ok: false, err: 'the mail service refused it (' + r.status + ')' }; }
    if (env.BREVO_API_KEY && env.MAIL_FROM) { const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'content-type': 'application/json', 'api-key': env.BREVO_API_KEY }, body: JSON.stringify({ sender: { email: env.MAIL_FROM, name: 'Ultimate Team' }, to: [{ email: to }], subject, textContent: text }) }); return r.ok ? { ok: true } : { ok: false, err: 'the mail service refused it (' + r.status + ')' }; }
  } catch (e) { return { ok: false, err: 'could not reach the mail service' }; }
  return { ok: false, err: 'email sign-up is not set up on the server yet' };
}
