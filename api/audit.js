// /api/audit.js - Vercel Serverless Function
const https = require('https');
const http = require('http');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL is required' });

  let parsedUrl;
  try { parsedUrl = new URL(url); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }

  let pageHtml = '';
  try { pageHtml = await fetchPage(parsedUrl.href); }
  catch (err) { return res.status(400).json({ error: 'Could not fetch that page: ' + err.message }); }

  const trimmed = pageHtml.slice(0, 6000);

  const systemPrompt = 'You are a senior CRO and UX consultant. Analyze landing pages for conversion issues. Respond ONLY with valid JSON, no markdown: { "score": <integer 0-100>, "summary": "<one sentence>", "findings": [ { "title": "<short title>", "severity": "<high|medium|low>", "description": "<2 sentences>", "recommendation": "<1 sentence fix>" } ] }. Return 5-8 findings ordered by severity. Focus on: CTA placement, above-the-fold value prop, mobile experience, trust signals, form friction, copy clarity, social proof.';

  const userPrompt = 'Audit this landing page.\nURL: ' + parsedUrl.href + '\nHTML:\n' + trimmed + '\nReturn JSON only.';

  try {
    const claudeRes = await callClaude(systemPrompt, userPrompt);
    const cleaned = claudeRes.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: 'Audit failed. Please try again.' });
  }
};

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JGoinsAudit/1.0)', 'Accept': 'text/html' },
      timeout: 8000,
    }, (response) => {
      if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
        return fetchPage(response.headers.location).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) return reject(new Error('HTTP ' + response.statusCode));
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function callClaude(system, user) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: user }]
    });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      }
    };
    const req = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.content?.[0]?.text || '');
        } catch { reject(new Error('Failed to parse Claude response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
