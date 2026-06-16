// POST /api/admin/retry — reprocesa un lead existente en Airtable.
// Útil cuando algún step (Claude / PDF / Resend) falló y queremos
// regenerar el reporte sin pedirle al usuario que vuelva a llenar el form.
//
// Auth: header `x-admin-secret` (preferido) o query `?secret=...`.
// Body JSON: { "email": "..." }
//
// Ejemplo:
//   curl -X POST https://buildingwitheli.com/api/admin/retry \
//     -H "x-admin-secret: $ADMIN_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"email":"manu.vem9708@gmail.com"}'

import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { isValidEmail, maskEmail } from '../_security.js';
import { processReport, findLeadByEmail } from '../generate-report.js';

export const config = { maxDuration: 300 };

function isValidSecret(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Método no permitido.' });
  }

  const expected = process.env.ADMIN_SECRET;
  if (!expected) {
    return res.status(500).json({ success: false, error: 'ADMIN_SECRET no configurado.' });
  }

  const provided = req.headers['x-admin-secret'] || req.query?.secret;
  if (!isValidSecret(provided, expected)) {
    return res.status(401).json({ success: false, error: 'Unauthorized.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const email = body.email || req.query?.email;
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'Email inválido.' });
  }

  let lead;
  try {
    lead = await findLeadByEmail(email);
  } catch (err) {
    console.error('[admin:retry:lookup]', { email: maskEmail(email) }, err.message);
    return res.status(500).json({ success: false, error: `Lookup falló: ${err.message}` });
  }

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead no encontrado en Airtable.' });
  }

  const f = lead.fields || {};
  const input = {
    email: f.email,
    brand: f.brand,
    url: f.url,
    industry: f.industry,
    geografia: f.geografia,
    comp1: f.comp1,
    comp2: f.comp2 || '',
    comp3: f.comp3 || '',
    objetivo: f.objetivo,
    idioma: 'Español',
    subscribe: !!f.subscribed,
  };

  // Validación mínima de los campos rescatados
  if (!input.brand || !input.url || !input.industry || !input.geografia || !input.comp1 || !input.objetivo) {
    return res.status(422).json({
      success: false,
      error: 'Lead encontrado pero le faltan campos requeridos para regenerar el reporte.',
      missing: Object.entries(input).filter(([_, v]) => !v).map(([k]) => k),
    });
  }

  console.log('[admin:retry] reprocessing', { email: maskEmail(email), brand: input.brand });

  // Responde de inmediato. El procesamiento corre en background.
  res.status(202).json({
    success: true,
    message: 'Reprocesando en background. El reporte llega en 30-90s.',
    email: maskEmail(email),
    brand: input.brand,
  });

  waitUntil(
    processReport(input, { skipAirtable: true, skipBeehiiv: true, tag: 'retry' })
      .catch(err => console.error('[admin:retry:fatal]', { email: maskEmail(email) }, err.message))
  );
}
