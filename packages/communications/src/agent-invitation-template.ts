const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
export const invitationSubject =
  "You're invited to your Weatherly agent portal";
export const invitationFrom = "Ireland at Weatherly <ireland@weatherlytc.com>";
export const invitationSignatureFallback =
  "Ireland Weatherly, Founder, Weatherly Transaction Co.";

/** Saved merge-field signatures are plain text, just as in transaction templates. */
export function renderAgentInvitation({
  url,
  name,
  signature,
}: {
  url: string;
  name?: string | null;
  signature?: string | null;
}) {
  const firstName = name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const signed = signature?.trim() || invitationSignatureFallback;
  const [signatureName, ...signatureLines] = signed.split(/\r?\n/);
  const signatureHtml = `<strong>${escape(signatureName)}</strong>${signatureLines.map((line) => `<br>${escape(line)}`).join("")}`;
  const origin = new URL(url).origin;
  const logo = new URL("/brand/handoffs/weatherly-wordmark.png", origin).href;
  const mark = new URL("/brand/handoffs/weatherly-mark.png", origin).href;
  const introduction =
    "Thank you for choosing Weatherly Transaction Co. I've set up your agent portal, where you'll find every file we work on together: deadlines, documents and updates, all in one place.";
  const instruction =
    "Click below to create your account. It only takes a minute.";
  const note =
    "This link is just for you. If it stops working, reply to this email and I'll send a fresh one.";
  const closing = "I'm looking forward to working with you!";
  const text = `Your agent portal is ready.\n\n${greeting}\n\n${introduction}\n\n${instruction}\n\nAccept your invitation: ${url}\n\n${note}\n\n${closing}\n\n${signed}`;
  const html = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(invitationSubject)}</title>
<style>@font-face{font-family:Montserrat;src:url('${escape(origin)}/fonts/process-montserrat-latin.woff2') format('woff2');font-weight:400 600}@font-face{font-family:'Cormorant Garamond';src:url('${escape(origin)}/fonts/cormorant-garamond-latin.woff2') format('woff2');font-weight:400 600}@media(max-width:600px){.outer{padding:16px 10px!important}.content{padding:30px 24px!important}.heading{font-size:34px!important}.invite-button{display:block!important;text-align:center!important}.logo{width:250px!important;max-width:100%!important}}</style></head>
<body style="margin:0;background:#f6f3ee;color:#1e1c1a;font-family:Montserrat,Arial,sans-serif">
<div lang="en" dir="ltr" class="outer" style="padding:32px 20px">
<div style="display:none;max-height:0;overflow:hidden">Your Weatherly agent portal is ready. Accept your personal invitation to get started.</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #e6ded2">
<tr><td style="padding:36px 24px;text-align:center;border-bottom:1px solid #eee8df"><img class="logo" src="${escape(logo)}" width="290" alt="Weatherly Transaction Co." style="display:block;width:290px;max-width:100%;height:auto;margin:0 auto"></td></tr>
<tr><td class="content" style="padding:38px 48px 44px;font-size:17px;line-height:1.65">
<h1 class="heading" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:42px;line-height:1.15;font-weight:600;margin:0 0 28px">Your agent portal is ready.</h1>
<p style="margin:0 0 24px">${escape(greeting)}</p>
<p style="margin:0 0 24px">${escape(introduction)}</p>
<p style="margin:0 0 28px">${escape(instruction)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#1e1c1a" style="border-radius:7px"><a class="invite-button" href="${escape(url)}" style="display:inline-block;padding:17px 26px;border:1px solid #1e1c1a;border-radius:7px;background:#1e1c1a;color:#ffffff;font-size:18px;font-weight:600;text-decoration:none">Accept your invitation</a></td></tr></table>
<p style="margin:28px 0 30px;color:#625a52;font-size:16px">${escape(note)}</p>
<p style="margin:0 0 12px">${escape(closing)}</p>
<img src="${escape(mark)}" width="120" alt="" style="display:block;width:120px;height:auto;margin:0 0 8px">
<p style="margin:0;overflow-wrap:anywhere">${signatureHtml}</p>
</td></tr></table></div></body></html>`;
  return { text, html };
}
