// /api/subscribe.js - Vercel Serverless Function
const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, source, url: auditUrl, name } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const apiKey = process.env.MAILCHIMP_API_KEY;
  const listId = process.env.MAILCHIMP_LIST_ID;
  const dc = apiKey ? apiKey.split('-').pop() : null;

  if (!apiKey || !listId || !dc) {
    console.warn('Mailchimp env vars not set');
    return res.status(200).json({ ok: true });
  }

  const mergeFields = {};
  if (auditUrl) mergeFields.AUDITURL = auditUrl.slice(0, 255);
  if (name) mergeFields.FNAME = name;

  const body = JSON.stringify({
    email_address: email,
    status: 'subscribed',
    tags: [source || 'website'],
    merge_fields: mergeFields
  });

  return new Promise((resolve) => {
    const options = {
      hostname: dc + '.api.mailchimp.com',
      path: '/3.0/lists/' + listId + '/members',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'apikey ' + apiKey,
        'Content-Length': Buffer.byteLength(body),
      }
    };

    const mcReq = https.request(options, (mcRes) => {
      let data = '';
      mcRes.on('data', chunk => { data += chunk; });
      mcRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (mcRes.statusCode === 200 || parsed.title === 'Member Exists') {
            res.status(200).json({ ok: true });
          } else {
            console.error('Mailchimp error:', parsed);
            res.status(200).json({ ok: true });
          }
        } catch {
          res.status(200).json({ ok: true });
        }
        resolve();
      });
    });

    mcReq.on('error', (err) => {
      console.error('Mailchimp error:', err);
      res.status(200).json({ ok: true });
      resolve();
    });

    mcReq.write(body);
    mcReq.end();
  });
};
