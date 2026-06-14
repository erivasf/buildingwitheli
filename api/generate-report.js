import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { marked } from 'marked';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';
import { waitUntil } from '@vercel/functions';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const config = { maxDuration: 300 };

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const FROM_EMAIL = 'reporte@buildingwitheli.com';
const BEEHIIV_TAG = 'market-researcher';
const PROMPT_URL = 'https://github.com/erivasf/buildingwitheli/blob/main/system-prompt.txt';
const CHROMIUM_PACK_URL = 'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar';

const RECURRING_APPENDIX_MD = `

---

## Vuélvelo semanal

Un reporte aislado es útil. Una serie es una ventaja estructural. Tres formas de automatizar este flujo según tu nivel:

### Opción 1 · Claude Project (5 min, recomendado)

Para quien ya tiene Claude Pro. Setup una vez, abres el proyecto cada lunes.

1. claude.ai → Projects → Create new project
2. Nómbralo "Market Intel · [tu marca]"
3. En **Project Instructions**, pega el prompt de [system-prompt.txt](${PROMPT_URL})
4. En **Knowledge**, sube un doc con tus inputs (marca, URL, industria, geografía, competidores, objetivo)
5. Cada lunes: abres el proyecto, escribes "Genera el reporte de esta semana"

### Opción 2 · Notion + Claude (historial apilado)

Para quien vive en Notion. No es automático, pero los reportes quedan uno debajo del otro como repo de conocimiento.

1. Crea una página "Market Intel · [tu marca]"
2. Arriba pones una sección "Inputs" con tus datos
3. Conecta Claude en Notion (Settings → Integrations → Claude)
4. Cada lunes copias el prompt + tus inputs y le preguntas a Claude desde la página

A las pocas semanas tienes el historial completo de tu mercado en un solo lugar.

### Opción 3 · Workflow automático (set and forget)

Para quien ya tiene workflows en n8n, Make, o Zapier. Corre solo cada lunes y te llega al correo.

1. Trigger: cron semanal lunes 7am
2. Inputs guardados en Airtable o Notion DB
3. HTTP request a la API de Anthropic con el prompt + inputs
4. Convertir markdown a PDF
5. Mandar por Gmail o Resend
`;

let cachedSystemPrompt = null;
function loadSystemPrompt() {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  cachedSystemPrompt = readFileSync(join(process.cwd(), 'system-prompt.txt'), 'utf8');
  return cachedSystemPrompt;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'market';
}

function buildUserMessage(input) {
  return [
    `Marca: ${input.brand}`,
    `URL: ${input.url}`,
    `Industria: ${input.industry}`,
    `Geografía: ${input.geografia}`,
    `Competidor o referencia 1: ${input.comp1}`,
    `Competidor o referencia 2: ${input.comp2 || '(no especificado)'}`,
    `Competidor o referencia 3: ${input.comp3 || '(no especificado)'}`,
    `Idioma del reporte: ${input.idioma || 'Español'}`,
    `Objetivo de negocio: ${input.objetivo}`,
    `Fecha de generación: ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}`,
  ].join('\n');
}

async function callClaude(input) {
  const anthropic = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    system: loadSystemPrompt(),
    messages: [{ role: 'user', content: buildUserMessage(input) }],
  });
  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  if (!text.trim()) throw new Error('Claude devolvió un reporte vacío.');
  return text;
}

function wrapHtml(markdownHtml, brand) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte de mercado · ${escapeHtml(brand)}</title>
<style>
  @page { size: A4; margin: 22mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #ffffff; color: #0f0f0f;
    font-size: 10.5pt; line-height: 1.6;
    margin: 0; padding: 0;
  }
  .container { max-width: 720px; margin: 0 auto; }
  .header {
    border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 24px;
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 9pt; color: #999; letter-spacing: 0.04em;
  }
  .brand { font-weight: 600; color: #0f0f0f; }
  .accent { color: #ff4d00; }
  h1 { color: #ff4d00; font-size: 20pt; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; margin: 0 0 6px; }
  h2 { color: #0f0f0f; font-size: 14pt; font-weight: 700; letter-spacing: -0.01em; border-bottom: 2px solid #ff4d00; padding-bottom: 6px; margin: 22px 0 8px; }
  h3 { color: #0f0f0f; font-size: 12pt; font-weight: 600; margin: 14px 0 4px; }
  p { margin: 0 0 8px; }
  ul, ol { margin: 0 0 10px 18px; padding: 0; }
  li { margin-bottom: 4px; }
  strong { color: #0f0f0f; }
  em { color: #555; font-style: italic; }
  blockquote { color: #ff4d00; border-left: 2px solid #ff4d00; padding-left: 12px; margin: 10px 0; font-style: normal; }
  hr { border: none; border-top: 1px solid #eee; margin: 18px 0; }
  .footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #eee; font-size: 10pt; color: #999; text-align: center; letter-spacing: 0.04em; }
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="brand">Building with Eli<span class="accent">.</span></span>
      <span>Market Researcher</span>
    </div>
    ${markdownHtml}
    <div class="footer">Generado por buildingwitheli.com · @buildingwitheli</div>
  </div>
</body>
</html>`;
}

async function renderPdf(html) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
    headless: chromium.headless,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}

async function sendEmail({ to, brand, pdfBuffer }) {
  const resend = new Resend(requireEnv('RESEND_API_KEY'));
  const b = escapeHtml(brand);
  return resend.emails.send({
    from: `Building with Eli <${FROM_EMAIL}>`,
    to,
    subject: `Tu reporte de mercado · ${brand}`,
    text:
`Hola,

Aquí va tu reporte para ${brand}.

Empieza por el TL;DR. Si te resuena, baja a la sección de Acciones. Son 5 decisiones concretas para esta semana.

El valor de un reporte así no está en uno. Está en la serie. Múltiples reportes consecutivos te dan patrones, decisiones validadas y oportunidades que un reporte aislado no muestra.

En la última página te dejé las 3 formas más fáciles de automatizarlo. La más rápida toma 5 minutos.

Cualquier cosa no dudes en escribirme a este correo.

Un abrazo,
Elías
buildingwitheli.com`,
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #0f0f0f; max-width: 560px;">
<p>Hola,</p>
<p>Aquí va tu reporte para <strong>${b}</strong>.</p>
<p>Empieza por el TL;DR. Si te resuena, baja a la sección de Acciones. Son 5 decisiones concretas para esta semana.</p>
<p>El valor de un reporte así no está en uno. Está en la serie. Múltiples reportes consecutivos te dan patrones, decisiones validadas y oportunidades que un reporte aislado no muestra.</p>
<p>En la última página te dejé las 3 formas más fáciles de automatizarlo. La más rápida toma 5 minutos.</p>
<p>Cualquier cosa no dudes en escribirme a este correo.</p>
<p>Un abrazo,<br>Elías<br><a href="https://buildingwitheli.com" style="color:#ff4d00;text-decoration:none;">buildingwitheli.com</a></p>
</div>`,
    attachments: [{
      filename: `market-intelligence-${slug(brand)}.pdf`,
      content: pdfBuffer,
    }],
  });
}

async function subscribeToBeehiiv({ email }) {
  const apiKey = requireEnv('BEEHIIV_API_KEY');
  const pubId = requireEnv('BEEHIIV_PUBLICATION_ID');
  const res = await fetch(
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
        send_welcome_email: false,
        utm_source: BEEHIIV_TAG,
        utm_medium: 'tool',
        custom_fields: [{ name: 'source_tool', value: BEEHIIV_TAG }],
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Beehiiv ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function processReport(input) {
  const ctx = { email: input.email, brand: input.brand };

  // Step 1: Claude
  let reportMd;
  try {
    reportMd = await callClaude(input);
  } catch (err) {
    console.error('[step:claude]', ctx, err.message);
    throw err;
  }

  // Step 2: Markdown → PDF (con appendix estático "Vuélvelo semanal")
  let pdfBuffer;
  try {
    const fullMd = reportMd + RECURRING_APPENDIX_MD;
    const html = wrapHtml(marked.parse(fullMd), input.brand);
    pdfBuffer = await renderPdf(html);
  } catch (err) {
    console.error('[step:pdf]', ctx, err.message);
    throw err;
  }

  // Step 3: Resend
  try {
    await sendEmail({ to: input.email, brand: input.brand, pdfBuffer });
  } catch (err) {
    console.error('[step:resend]', ctx, err.message);
    throw err;
  }

  // Step 4: Beehiiv (no rompe el flujo si falla)
  if (input.subscribe) {
    try {
      await subscribeToBeehiiv({ email: input.email });
    } catch (err) {
      console.error('[step:beehiiv]', ctx, err.message);
    }
  }

  console.log('[report:delivered]', ctx);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Método no permitido.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const {
    brand, url, industry, geografia,
    comp1, comp2 = '', comp3 = '',
    objetivo = '',
    idioma = 'Español',
    email, subscribe = true,
  } = body;

  if (!objetivo || !String(objetivo).trim()) {
    return res.status(400).json({ success: false, error: 'El objetivo de negocio es requerido para generar el reporte.' });
  }
  if (!brand || !url || !industry || !geografia || !comp1 || !email) {
    return res.status(400).json({ success: false, error: 'Faltan campos requeridos.' });
  }
  if (!/.+@.+\..+/.test(email)) {
    return res.status(400).json({ success: false, error: 'Correo inválido.' });
  }

  // Respondemos al frontend de inmediato. El trabajo pesado sigue en background.
  res.status(200).json({ success: true });

  waitUntil(
    processReport({
      brand, url, industry, geografia,
      comp1, comp2, comp3,
      objetivo: String(objetivo).trim(),
      idioma,
      email, subscribe,
    }).catch(err => {
      console.error('[processReport:fatal]', { email, brand }, err.message);
    })
  );
}
