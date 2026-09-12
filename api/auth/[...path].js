const http = require('http');
const https = require('https');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function authSuffix(req) {
  const segments = req.query.path;
  if (Array.isArray(segments) && segments.length) return segments.join('/');
  if (typeof segments === 'string' && segments) return segments;

  const incoming = req.url || '';
  const pathPart = incoming.split('?')[0];
  const marker = '/api/auth/';
  const idx = pathPart.indexOf(marker);
  if (idx >= 0) return pathPart.slice(idx + marker.length);
  return pathPart.replace(/^\/+/, '');
}

function proxyRequest(backend, req, res) {
  const incoming = req.url || '';
  const queryPart = incoming.includes('?') ? incoming.slice(incoming.indexOf('?')) : '';
  const suffix = authSuffix(req);
  const target = `${backend.replace(/\/$/, '')}/api/auth/${suffix}${queryPart}`;
  const url = new URL(target);
  const transport = url.protocol === 'https:' ? https : http;

  return readBody(req).then((body) =>
    new Promise((resolve) => {
      const headers = { ...req.headers, host: url.host };
      delete headers['content-length'];

      const upstream = transport.request(
        url,
        {
          method: req.method,
          headers
        },
        (upstreamRes) => {
          res.statusCode = upstreamRes.statusCode || 502;
          for (const [key, value] of Object.entries(upstreamRes.headers)) {
            if (!value || key === 'transfer-encoding') continue;
            res.setHeader(key, value);
          }
          upstreamRes.pipe(res);
          upstreamRes.on('end', resolve);
        }
      );

      upstream.on('error', (error) => {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            error: `Не удалось подключиться к API: ${error.message}`
          })
        );
        resolve();
      });

      if (body.length) upstream.write(body);
      upstream.end();
    })
  );
}

module.exports = async (req, res) => {
  const backend = process.env.MAX_API_URL || '';
  if (!backend) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: 'Сервер авторизации не настроен. Задайте MAX_API_URL в Vercel.'
      })
    );
    return;
  }

  await proxyRequest(backend, req, res);
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};
