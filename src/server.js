import http from 'node:http';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStateValue, setStateValue, getCachedNotes, setCachedNotes, deleteCachedNotes } from './app/db.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');
const envFile = process.env.FEEDSTR_ENV_FILE ?? join(root, '.env');

const port = Number(process.env.FEEDSTR_BIND_PORT ?? process.env.PORT ?? 3002);
const host = process.env.FEEDSTR_BIND_HOST ?? '0.0.0.0';
const nostrBuildUploadUrl = 'https://nostr.build/api/v2/nip96/upload';
const requiredIdenstrScopes = ['profile:read', 'following:read', 'following:write', 'mutes:read', 'mutes:write', 'relays:read', 'sign:kind:1', 'sign:kind:5', 'sign:kind:6', 'sign:kind:7', 'sign:kind:27235'];

let runtimeConfig = readRuntimeConfig();

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/v1/health') {
    const cfg = runtimeConfig;
    return sendJson(res, 200, { status: 'ok', app: 'feedstr', idenstrUrl: cfg.idenstrUrl, idenstrTokenConfigured: Boolean(cfg.idenstrToken), privateRelayUrl: cfg.privateRelayUrl });
  }

  if (req.method === 'GET' && url.pathname === '/api/v1/config') {
    const cfg = runtimeConfig;
    return sendJson(res, 200, {
      app: 'feedstr',
      idenstrUrl: cfg.idenstrUrl,
      idenstrTokenConfigured: Boolean(cfg.idenstrToken),
      idenstrTokenPreview: tokenStatusLabel(cfg.idenstrToken),
      privateRelayUrl: cfg.privateRelayUrl,
      requiredIdenstrScopes,
      envWritable: true
    });
  }

  if (req.method === 'PUT' && url.pathname === '/api/v1/config') {
    const body = await readJson(req);
    return saveConfig(res, body);
  }

  if (req.method === 'GET' && url.pathname === '/api/v1/idenstr/status') {
    return idenstrStatus(res);
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/media/upload') {
    return uploadMedia(req, res);
  }

  // Feedstr's own metadata store: column config, feed rules, mutes, read-position.
  const stateMatch = url.pathname.match(/^\/api\/v1\/state\/([A-Za-z0-9:_-]+)$/);
  if (stateMatch) {
    if (req.method === 'GET') return sendJson(res, 200, { key: stateMatch[1], value: getStateValue(stateMatch[1]) });
    if (req.method === 'PUT') {
      const body = await readJson(req);
      setStateValue(stateMatch[1], body?.value ?? null);
      return sendJson(res, 200, { saved: true, key: stateMatch[1] });
    }
  }

  // Cached observed notes, kept per column so feeds survive a restart.
  const cacheMatch = url.pathname.match(/^\/api\/v1\/cache\/([A-Za-z0-9:_-]+)$/);
  if (cacheMatch) {
    if (req.method === 'GET') return sendJson(res, 200, { columnId: cacheMatch[1], events: getCachedNotes(cacheMatch[1]) });
    if (req.method === 'PUT') {
      const body = await readJson(req);
      const count = setCachedNotes(cacheMatch[1], body?.events);
      return sendJson(res, 200, { saved: true, columnId: cacheMatch[1], count });
    }
    if (req.method === 'DELETE') {
      deleteCachedNotes(cacheMatch[1]);
      return sendJson(res, 200, { deleted: true, columnId: cacheMatch[1] });
    }
  }

  if (url.pathname.startsWith('/api/v1/idenstr/')) {
    const idenstrPath = url.pathname.replace('/api/v1/idenstr', '/api/v1') + url.search;
    return proxyIdenstr(req, res, idenstrPath);
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    return serveStatic(url.pathname, res, req.method === 'HEAD', acceptsGzip);
  }

  sendJson(res, 404, { error: 'not_found' });
}

async function uploadMedia(req, res) {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return sendJson(res, 400, { error: 'invalid_upload', message: 'Expected multipart/form-data upload' });
  }

  const cfg = runtimeConfig;
  if (!cfg.idenstrToken) {
    return sendJson(res, 400, { error: 'idenstr_token_missing', message: 'Feedstr needs an Idenstr token to sign the NIP-98 upload request.' });
  }

  try {
    const started = Date.now();
    const body = await readRawBody(req, 20 * 1024 * 1024);
    console.info(`Media upload received: ${body.length} bytes`);
    const auth = await createNip98Authorization('POST', nostrBuildUploadUrl, body);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    const upstream = await fetch(nostrBuildUploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.length),
        Authorization: auth
      },
      body,
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));
    const text = await upstream.text();
    console.info(`nostr.build upload completed: ${upstream.status} in ${Date.now() - started}ms`);
    let payload = null;
    try { payload = JSON.parse(text); } catch {}
    if (!upstream.ok) {
      return sendJson(res, upstream.status, {
        error: 'nostr_build_upload_failed',
        message: payload?.message || text || upstream.statusText,
        data: payload?.data ?? null
      });
    }
    const urls = extractNostrBuildUrls(payload, text);
    if (!urls.length) {
      return sendJson(res, 502, { error: 'upload_url_missing', message: 'nostr.build did not return a media URL.', response: payload ?? text });
    }
    return sendJson(res, 200, { ok: true, url: urls[0], urls, response: payload ?? text });
  } catch (err) {
    const status = err.code === 'body_too_large' ? 413 : 502;
    const message = err.name === 'AbortError' ? 'nostr.build upload timed out. Try a smaller image or a different file.' : err.message;
    console.warn(`Media upload failed: ${message}`);
    sendJson(res, status, { error: err.code || 'media_upload_failed', message });
  }
}

async function readRawBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error('Upload is too large. Maximum size is 20 MB.');
      err.code = 'body_too_large';
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function createNip98Authorization(method, targetUrl, body) {
  const payload = createHash('sha256').update(body).digest('hex');
  const createdAt = Math.floor(Date.now() / 1000);
  const { event } = await callIdenstr('/api/v1/sign', {
    method: 'POST',
    body: JSON.stringify({
      kind: 27235,
      created_at: createdAt,
      content: '',
      tags: [
        ['u', targetUrl],
        ['method', method.toUpperCase()],
        ['payload', payload]
      ]
    })
  });
  return `Nostr ${Buffer.from(JSON.stringify(event), 'utf8').toString('base64')}`;
}

async function callIdenstr(path, options = {}) {
  const cfg = runtimeConfig;
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  if (cfg.idenstrToken) headers.Authorization = `Bearer ${cfg.idenstrToken}`;
  const response = await fetch(`${cfg.idenstrUrl}${path}`, { ...options, headers });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(body?.message || body?.error || text || `${response.status} ${response.statusText}`);
  return body ?? {};
}

function extractNostrBuildUrls(payload, text) {
  const urls = new Set();
  const add = (value) => {
    if (typeof value !== 'string') return;
    const clean = value.trim();
    if (/^https?:\/\//i.test(clean)) urls.add(clean);
  };
  const walk = (value) => {
    if (!value) return;
    if (typeof value === 'string') return add(value);
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value === 'object') return Object.values(value).forEach(walk);
  };
  walk(payload?.data ?? payload);
  for (const match of String(text ?? '').match(/https?:\/\/[^\s"'<>]+/g) ?? []) add(match);
  return [...urls];
}

async function saveConfig(res, body) {
  const updates = {};
  try {
    if ('idenstrUrl' in body) updates.FEEDSTR_IDENSTR_URL = normalizeHttpUrl(body.idenstrUrl, 'idenstrUrl');
    if ('idenstrToken' in body && String(body.idenstrToken ?? '').trim()) updates.FEEDSTR_IDENSTR_TOKEN = String(body.idenstrToken).trim();
    if ('privateRelayUrl' in body) updates.FEEDSTR_PRIVATE_RELAY_URL = normalizeWsUrl(body.privateRelayUrl, 'privateRelayUrl');
  } catch (err) {
    return sendJson(res, 400, { error: 'invalid_value', message: err.message });
  }

  if (!Object.keys(updates).length) return sendJson(res, 400, { error: 'no_updates' });

  try {
    const next = await updateEnvFile(envFile, updates);
    for (const [key, value] of Object.entries(updates)) process.env[key] = value;
    runtimeConfig = readRuntimeConfig();
    sendJson(res, 200, {
      saved: true,
      restartRequired: false,
      config: {
        idenstrUrl: runtimeConfig.idenstrUrl,
        idenstrTokenConfigured: Boolean(runtimeConfig.idenstrToken),
        idenstrTokenPreview: tokenStatusLabel(runtimeConfig.idenstrToken),
        privateRelayUrl: runtimeConfig.privateRelayUrl
      },
      envFile: next.path
    });
  } catch (err) {
    sendJson(res, 500, { error: 'env_save_failed', message: err.message });
  }
}

async function updateEnvFile(path, updates) {
  let text = '';
  try { text = await readFile(path, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  const seen = new Set();
  const lines = text.split(/\r?\n/).filter((line, index, arr) => index < arr.length - 1 || line !== '');
  const next = lines.map((line) => {
    if (!line || line.trimStart().startsWith('#') || !line.includes('=')) return line;
    const key = line.split('=', 1)[0].trim();
    if (!Object.hasOwn(updates, key)) return line;
    seen.add(key);
    return `${key}=${escapeEnvValue(updates[key])}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${escapeEnvValue(value)}`);
  }
  await writeFile(path, next.join('\n').replace(/\n*$/, '\n'));
  return { path };
}

function escapeEnvValue(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_:/.,@%+=-]*$/.test(text)) return text;
  return JSON.stringify(text);
}

function readRuntimeConfig() {
  return {
    idenstrUrl: (process.env.FEEDSTR_IDENSTR_URL ?? process.env.IDENSTR_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    idenstrToken: process.env.FEEDSTR_IDENSTR_TOKEN ?? process.env.IDENSTR_API_TOKEN ?? '',
    privateRelayUrl: process.env.FEEDSTR_PRIVATE_RELAY_URL ?? ''
  };
}

function normalizeHttpUrl(value, field) {
  const text = String(value ?? '').trim().replace(/\/$/, '');
  if (!/^https?:\/\/[^\s]+$/i.test(text)) throw new Error(`${field} must be an http:// or https:// URL`);
  return text;
}

function normalizeWsUrl(value, field) {
  const text = String(value ?? '').trim().replace(/\/$/, '');
  if (text === '') return '';
  if (!/^wss?:\/\/[^\s]+$/i.test(text)) throw new Error(`${field} must be a ws:// or wss:// URL`);
  return text;
}

async function proxyIdenstr(req, res, path) {
  const cfg = runtimeConfig;
  const targetUrl = `${cfg.idenstrUrl}${path}`;
  const headers = { 'Content-Type': req.headers['content-type'] ?? 'application/json' };
  if (cfg.idenstrToken) headers.Authorization = `Bearer ${cfg.idenstrToken}`;

  let body = null;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }

  try {
    const upstream = await fetch(targetUrl, { method: req.method, headers, body });
    const data = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(data);
  } catch (err) {
    sendJson(res, 502, { error: 'idenstr_unreachable', message: err.message });
  }
}

async function idenstrStatus(res) {
  const cfg = runtimeConfig;
  const results = {};
  for (const [name, path] of Object.entries({
    health: '/api/v1/system/health',
    whoami: '/api/v1/whoami',
    stack: '/api/v1/stack'
  })) {
    try {
      const response = await fetch(`${cfg.idenstrUrl}${path}`, {
        headers: cfg.idenstrToken ? { Authorization: `Bearer ${cfg.idenstrToken}` } : {}
      });
      let body = null;
      try { body = await response.json(); } catch {}
      results[name] = { ok: response.ok, status: response.status, body };
    } catch (err) {
      results[name] = { ok: false, error: err.message };
    }
  }
  const granted = results.whoami?.body?.principal?.scopes ?? [];
  const missingScopes = requiredIdenstrScopes.filter((scope) => !granted.includes('admin') && !granted.includes(scope));
  sendJson(res, 200, {
    idenstrUrl: cfg.idenstrUrl,
    tokenConfigured: Boolean(cfg.idenstrToken),
    tokenPreview: tokenStatusLabel(cfg.idenstrToken),
    requiredScopes: requiredIdenstrScopes,
    grantedScopes: granted,
    missingScopes,
    privateRelayUrl: cfg.privateRelayUrl,
    stack: results.stack?.body ?? null,
    ok: Boolean(results.health?.ok && results.whoami?.ok && results.stack?.ok && missingScopes.length === 0),
    checks: results
  });
}

function tokenStatusLabel(token) {
  return token ? 'configured' : '';
}

async function serveStatic(pathname, res, headOnly = false, acceptsGzip = false) {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  if (normalized.includes('..')) return sendJson(res, 400, { error: 'bad_path' });
  const filePath = join(publicDir, normalized);
  try {
    const data = await readFile(filePath);
    const type = contentType(filePath);
    const headers = { 'Content-Type': type, 'Cache-Control': cacheControl(filePath), 'Vary': 'Accept-Encoding' };
    const compressible = /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg)/.test(type);
    if (headOnly) { res.writeHead(200, headers); return res.end(); }
    if (acceptsGzip && compressible && data.length > 1024) {
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      return res.end(gzipSync(data));
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') return sendJson(res, 404, { error: 'not_found' });
    throw err;
  }
}

function contentType(filePath) {
  const ext = extname(filePath);
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
  }[ext] ?? 'application/octet-stream';
}

function cacheControl(filePath) {
  const ext = extname(filePath);
  if (['.html', '.css', '.js', '.json', '.webmanifest'].includes(ext)) return 'no-store';
  return 'public, max-age=3600';
}

async function readJson(req, maxBytes = 16 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error('Request body too large');
      err.code = 'body_too_large';
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    sendJson(res, 500, { error: 'internal_error', message: err.message });
  }
});

server.listen(port, host, () => {
  console.log(`Feedstr listening on http://${host}:${port}`);
  console.log(`Idenstr upstream: ${runtimeConfig.idenstrUrl}`);
  console.log(`Idenstr token: ${runtimeConfig.idenstrToken ? 'configured' : 'missing'}`);
});
