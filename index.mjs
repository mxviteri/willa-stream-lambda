// Copied from infrastructure lambda; standalone package for stream processing
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { HttpRequest } from '@smithy/protocol-http';
import { OpenAIUtil } from './src/utils/openai.mjs';

const endpoint = process.env.AOSS_ENDPOINT;
const indexName = process.env.AOSS_INDEX || 'saves';
const tagIndexName = process.env.AOSS_TAG_INDEX || 'discovertags';
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

    // Only index entities we care about: Save and DiscoverTag
    let targetIndex = null;
    if (doc.entityType === 'Save') {
      targetIndex = indexName;
    } else if (doc.entityType === 'DiscoverTag') {
      targetIndex = tagIndexName;
    } else {
      debugLog('skipping entity', { id, entityType: doc.entityType });
      continue;
    }

    // Normalize fields that must be strings to avoid accidental BOOL mapping
    normalizeForIndex(doc);

    // Generate enrichments for saves
    if (doc.entityType === 'Save') {
      doc.enrichments = await OpenAIUtil.generateEnrichments({
        title: doc.title,
        description: doc.description,
        url: doc.url,
      });
    }

    const version = Number(doc.updatedAt || doc.timestamp || 0) || Number((rec.dynamodb || {}).ApproximateCreationDateTime || 0) * 1000 || Date.now();
    ops.push(JSON.stringify({ index: { _index: targetIndex, _id: id, version, version_type: 'external_gte' } }));
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
    // Use root bulk path so meta lines can pick per-doc index
    const req = new HttpRequest({ method: 'POST', protocol: 'https:', hostname: host, path: `/_bulk`, headers: { host, 'content-type': 'application/json' }, body });
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

// Index creation is managed out-of-band; no ensure step in the stream

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

// Ensure specific fields are indexed with the correct types regardless of DDB source types
function normalizeForIndex(doc) {
  // Comments must be text
  if (Object.prototype.hasOwnProperty.call(doc, 'comments')) {
    const raw = doc.comments;
    // If not a user-provided string, drop it (do NOT index "true"/"false")
    if (raw == null) {
      delete doc.comments;
    } else if (typeof raw !== 'string') {
      // was boolean/number/etc → treat as no comment
      delete doc.comments;
    } else {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.toLowerCase() === 'true' || trimmed.toLowerCase() === 'false') {
        delete doc.comments;
      } else {
        doc.comments = trimmed;
      }
    }
  }
  // thirdPartyImage should be a URL string, never boolean
  if (Object.prototype.hasOwnProperty.call(doc, 'thirdPartyImage')) {
    const raw = doc.thirdPartyImage;
    if (typeof raw !== 'string') { delete doc.thirdPartyImage; }
    else {
      const val = raw.trim();
      const isUrl = /^https?:\/\//i.test(val);
      if (!val || val.toLowerCase() === 'true' || val.toLowerCase() === 'false' || !isUrl) {
        delete doc.thirdPartyImage;
      } else {
        doc.thirdPartyImage = val;
      }
    }
  }
}

