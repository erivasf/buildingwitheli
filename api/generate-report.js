import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { marked } from 'marked';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const config = { maxDuration: 60 };

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const FROM_EMAIL = 'reporte@buildingwitheli.com';
const BEEHIIV_TAG = 'market-researcher';

let cachedSystemPrompt = null;
function loadSystemPrompt() {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const path = join(process.cwd(), 'system-prompt.txt');
  cachedSystemPrompt = readFileSync(path, 'utf8');
  return cachedSystemPrompt;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function buildUserMessage(input) {
  const competitors = [input.comp1, input.comp2, input.comp3].filter(Boolean);
  return [
    `Marca: ${input.brand}`,
    `URL: ${input.url}`,
    `Industria: ${input.industry}`,
    `Competidores: ${competitors.join(', ')}`,
    `Frecuencia: ${input.frequency || 'weekly'}`,
    `Fecha del reporte: ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}`,
  ].join('\n');
}

async function generateReportMarkdown(input) {
  const anthropic = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
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
    font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #1a1a1a; font-size: 11pt; line-height: 1.55;
    margin: 0; padding: 0;
  }
  .header {
    border-bottom: 1px solid #ddd; padding-bottom: 10px; margin-bottom: 24px;
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 9pt; color: #888; letter-spacing: 0.04em;
  }
  .brand { font-weight: 600; color: #1a1a1a; }
  .accent { color: #ff4d00; }
  h1 { font-size: 22pt; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 4px; line-height: 1.1; }
  h2 { font-size: 13pt; font-weight: 700; letter-spacing: -0.01em; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #eee; }
  h3 { font-size: 11pt; font-weight: 700; margin: 14px 0 4px; }
  p { margin: 0 0 8px; }
  ul, ol { margin: 0 0 10px 18px; padding: 0; }
  li { margin-bottom: 4px; }
  em { color: #888; font-style: normal; font-size: 9.5pt; letter-spacing: 0.02em; }
  strong { color: #1a1a1a; }
  hr { border: none; border-top: 1px solid #eee; margin: 18px 0; }
  .footer {
    margin-top: 36px; padding-top: 12px; border-top: 1px solid #ddd;
    font-size: 8.5pt; color: #999; text-align: center; letter-spacing: 0.04em;
  }
</style>
</head>
<body>
  <div class="header">
    <span class="brand">Building with Eli<span class="accent">.</span></span>
    <span>Market Researcher</span>
  </div>
  ${markdownHtml}
  <div class="footer">Generado por buildingwitheli.com · @buildingwitheli</div>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function renderPdf(html) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

async function sendEmail({ to, brand, pdfBuffer }) {
  const resend = new Resend(requireEnv('RESEND_API_KEY'));
  return resend.emails.send({
    from: `Building with Eli <${FROM_EMAIL}>`,
    to,
    subject: `Tu reporte de mercado: ${brand}`,
    text:
`Listo. Adjunto va tu reporte de mercado.

Lee el resumen ejecutivo primero, luego las acciones para esta semana. Esa es la parte que mueve la aguja.

Si quieres uno nuevo, regresa a buildingwitheli.com/market y vuelve a llenar el formulario.

Eli`,
    attachments: [
      {
        filename: `reporte-${slug(brand)}.pdf`,
        content: pdfBuffer,
      },
    ],
  });
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'market';
}

async function subscribeToBeehiiv({ email, brand }) {
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
        utm_campaign: BEEHIIV_TAG,
        referring_site: 'buildingwitheli.com/market',
        custom_fields: [
          { name: 'tool', value: BEEHIIV_TAG },
          { name: 'brand', value: brand },
        ],
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Beehiiv ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

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
    email, subscribe = true,
  } = body;

  if (!brand || !url || !industry || !comp1 || !email) {
    return res.status(400).json({ error: 'Faltan campos requeridos.' });
  }
  if (!/.+@.+\..+/.test(email)) {
    return res.status(400).json({ error: 'Correo inválido.' });
  }

  try {
    const reportMd = await generateReportMarkdown({
      brand, url, industry, comp1, comp2, comp3, frequency,
    });
    const html = wrapHtml(marked.parse(reportMd), brand);
    const pdfBuffer = await renderPdf(html);

    await sendEmail({ to: email, brand, pdfBuffer });

    if (subscribe) {
      try {
        await subscribeToBeehiiv({ email, brand });
      } catch (err) {
        console.error('[beehiiv]', err.message);
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[generate-report]', err);
    return res.status(500).json({
      error: 'No pudimos generar tu reporte. Intenta de nuevo en un momento.',
    });
  }
}
