// POST /api/generate
// Stub: valida el payload del Market Researcher y devuelve confirmación.
// Pendiente de cablear: prompt de Claude, render a PDF, almacén de leads, envío por correo.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const {
    brand, url, industry,
    comp1, comp2 = '', comp3 = '',
    frequency = 'weekly',
    email, subscribe = false,
  } = body;

  if (!brand || !url || !industry || !comp1 || !email) {
    return res.status(400).json({ error: 'Faltan campos requeridos.' });
  }
  if (!/.+@.+\..+/.test(email)) {
    return res.status(400).json({ error: 'Correo inválido.' });
  }

  // TODO (1): llamar a la API de Claude con el prompt y los inputs del usuario.
  //   import Anthropic from '@anthropic-ai/sdk';
  //   const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  //   const msg = await anthropic.messages.create({
  //     model: 'claude-sonnet-4-6',
  //     max_tokens: 4096,
  //     messages: [{ role: 'user', content: buildPrompt({ brand, url, industry, comp1, comp2, comp3 }) }]
  //   });
  //   const report = msg.content[0].text;
  // TODO (2): renderizar `report` a PDF.
  // TODO (3): guardar lead (brand, email, subscribe, frequency) en tu store.
  // TODO (4): enviar el PDF por correo (Resend / Postmark / etc.).

  console.log('[market-researcher:lead]', {
    brand, url, industry, comp1, comp2, comp3, frequency, email, subscribe,
    at: new Date().toISOString(),
  });

  return res.status(200).json({
    success: true,
    message: 'Listo. Te enviamos el reporte a tu correo en los próximos minutos.',
  });
}
