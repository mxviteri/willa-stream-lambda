// Copied from infrastructure lambda; standalone package for stream processing
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { HttpRequest } from '@smithy/protocol-http';

const endpoint = process.env.AOSS_ENDPOINT;
const indexName = process.env.AOSS_INDEX || 'saves';
const region = process.env.AWS_REGION;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

function debugLog(message, meta) {
  if (LOG_LEVEL === 'debug') {
    try {
      console.log(message, meta ? JSON.stringify(meta) : '');
    } catch (_) {
      console.log(message);
    }
  }
}

const signer = new SignatureV4({ service: 'aoss', region, credentials: defaultProvider(), sha256: Sha256 });
const http = new NodeHttpHandler();

export async function handler(event) {
  console.log('ddb-to-aoss invoked', { records: (event.Records || []).length, indexName });
  await ensureIndexExists();
  const ops = [];
  for (const rec of event.Records || []) {
    const keys = (rec.dynamodb && rec.dynamodb.Keys) || {};
    const id = Object.values(keys).map((v) => Object.values(v)[0]).join('#') || 'unknown';
    debugLog('processing record', { eventName: rec.eventName, id });

    if (rec.eventName === 'REMOVE') {
      ops.push(JSON.stringify({ delete: { _index: indexName, _id: id } }));
      continue;
    }
    const img = rec.dynamodb && rec.dynamodb.NewImage;
    if (!img) continue;
    const doc = unmarshall(img);

    // Only index entities of type "Save"; ignore all others in our single-table design
    if (doc.entityType !== 'Save') {
      debugLog('skipping non-save entity', { id, entityType: doc.entityType });
      continue;
    }

    const version = Number(doc.updatedAt || doc.timestamp || 0) || Number((rec.dynamodb || {}).ApproximateCreationDateTime || 0) * 1000 || Date.now();
    ops.push(JSON.stringify({ index: { _index: indexName, _id: id, version, version_type: 'external_gte' } }));
    ops.push(JSON.stringify(doc));
  }
  if (ops.length === 0) {
    debugLog('no operations generated from event', {});
    return { status: 'no-op' };
  }

  const body = ops.join('\n') + '\n';
  const maxAttempts = 4;
  let attempt = 0;
  // retry loop
  while (true) {
    attempt++;
    const host = endpoint.replace(/^https?:\/\//, '');
    // Target the specific index for bulk operations
    const req = new HttpRequest({ method: 'POST', protocol: 'https:', hostname: host, path: `/${indexName}/_bulk`, headers: { host, 'content-type': 'application/json' }, body });
    const signed = await signer.sign({ method: req.method, protocol: req.protocol, hostname: req.hostname, path: req.path, headers: { ...req.headers }, query: req.query, body: req.body });
    const signedReq = new HttpRequest({ ...req, headers: signed.headers });
    debugLog('sending bulk request', { attempt, ops: ops.length });
    const { response } = await http.handle(signedReq);
    const chunks = [];
    for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
    const respBody = Buffer.concat(chunks).toString('utf8');
    const status = response.statusCode || 0;
    if (status >= 200 && status < 300) {
      const parsed = JSON.parse(respBody);
      if (!parsed.errors) {
        console.log('bulk success', { items: (parsed.items || []).length });
        return { status: 'ok', items: (parsed.items || []).length };
      }
      console.error('bulk partial errors', { body: respBody.substring(0, 500) });
      throw new Error('Bulk partial errors');
    }
    if ((status === 429 || status >= 500) && attempt < maxAttempts) {
      const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    console.error('bulk failed', { status, body: respBody.substring(0, 500) });
    throw new Error('Bulk failed ' + status);
  }
}

async function ensureIndexExists() {
  const host = endpoint.replace(/^https?:\/\//, '');
  const req = new HttpRequest({ method: 'PUT', protocol: 'https:', hostname: host, path: `/${indexName}`, headers: { host, 'content-type': 'application/json' }, body: JSON.stringify({}) });
  const signed = await signer.sign({ method: req.method, protocol: req.protocol, hostname: req.hostname, path: req.path, headers: { ...req.headers }, query: req.query, body: req.body });
  const signedReq = new HttpRequest({ ...req, headers: signed.headers });
  try {
    debugLog('ensuring index exists', { indexName });
    const { response } = await http.handle(signedReq);
    if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) return;
  } catch (_) {
    debugLog('ensure index call resulted in non-2xx (likely exists already)', {});
  }
}

function unmarshall(image) {
  const out = {};
  Object.entries(image || {}).forEach(([k, v]) => {
    const type = Object.keys(v)[0];
    const val = v[type];
    switch (type) {
      case 'S': out[k] = String(val); break;
      case 'N': out[k] = Number(val); break;
      case 'BOOL': out[k] = !!val; break;
      case 'M': out[k] = unmarshall(val); break;
      case 'L': out[k] = (val || []).map(unmarshallAny); break;
      default: out[k] = val;
    }
  });
  return out;
}

function unmarshallAny(v) {
  const type = Object.keys(v)[0];
  const val = v[type];
  switch (type) {
    case 'S': return String(val);
    case 'N': return Number(val);
    case 'BOOL': return !!val;
    case 'M': return unmarshall(val);
    case 'L': return (val || []).map(unmarshallAny);
    default: return val;
  }
}

