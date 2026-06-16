// POST /api/subscribe — newsletter signup
// Intenta suscribir vía Beehiiv. Si faltan env vars o Beehiiv falla, loguea
// y devuelve success igual para no romper UX (mientras se conecta Beehiiv).

import { isValidEmail, maskEmail, checkLengths, fetchWithRetry } from './_security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Método no permitido.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const { email, source = 'newsletter' } = body;
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'Correo inválido.' });
  }
  const lenErr = checkLengths({ email, source });
  if (lenErr) {
    return res.status(400).json({ success: false, error: lenErr });
  }

  const masked = maskEmail(email);

  // Airtable save (fire-and-forget)
  const airtableKey = process.env.AIRTABLE_API_KEY;
  const airtableBase = process.env.AIRTABLE_BASE_ID;
  const airtableTable = process.env.AIRTABLE_TABLE_NAME || 'Leads';
  if (airtableKey && airtableBase) {
    try {
      const r = await fetchWithRetry(
        `https://api.airtable.com/v0/${airtableBase}/${encodeURIComponent(airtableTable)}`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${airtableKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            records: [{ fields: { email, source: 'Newsletter Card', subscribed: true } }],
            typecast: true,
          }),
        },
        { timeoutMs: 10000, maxRetries: 1 }
      );
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        console.error('[subscribe:airtable]', r.status, t.slice(0, 200), 'email:', masked);
      }
    } catch (err) {
      console.error('[subscribe:airtable]', err.message, 'email:', masked);
    }
  }

  const apiKey = process.env.BEEHIIV_API_KEY;
  const pubId = process.env.BEEHIIV_PUBLICATION_ID;

  if (!apiKey || !pubId) {
    console.warn('[subscribe] Beehiiv env vars missing; lead pending:', { email: masked, source });
    return res.status(200).json({ success: true, pending: true });
  }

  try {
    const r = await fetchWithRetry(
      `https://api.beehiiv.com/v2/publications/${pubId}/subscriptions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          reactivate_existing: true,
          send_welcome_email: false, // OFF hasta tener rate limit + double opt-in
          utm_source: source,
          utm_medium: 'website',
          custom_fields: [{ name: 'source_tool', value: source }],
        }),
      },
      { timeoutMs: 10000, maxRetries: 1 }
    );
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('[subscribe:beehiiv]', r.status, t.slice(0, 200), 'email:', masked);
    }
  } catch (err) {
    console.error('[subscribe]', err.message, 'email:', masked);
  }

  return res.status(200).json({ success: true });
}
