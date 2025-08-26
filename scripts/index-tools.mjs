#!/usr/bin/env node
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { fromIni } from '@aws-sdk/credential-provider-ini';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { HttpRequest } from '@smithy/protocol-http';

// Parse CLI flags: --profile/-p and --region/-r
const argv = process.argv.slice(2);
const cmd = argv[0];
function getFlag(names) {
  for (let i = 0; i < argv.length; i++) {
    if (names.includes(argv[i])) return argv[i + 1];
  }
  return undefined;
}
const profileFlag = getFlag(['--profile', '-p']);
const regionFlag = getFlag(['--region', '-r']);

const endpoint = process.env.AOSS_ENDPOINT || 'https://bfu5iw7ep5xbsu43xc1f.us-east-1.aoss.amazonaws.com';
const indexName = process.env.AOSS_INDEX || 'saves';
const region = regionFlag || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

if (!endpoint) throw new Error('AOSS_ENDPOINT env not set');

// Prefer CLI --profile, then AWS_PROFILE, then default chain
const profile = profileFlag || process.env.AWS_PROFILE || process.env.ASSUME_PROFILE;
const credentials = profile ? fromIni({ profile }) : defaultProvider();
const signer = new SignatureV4({ service: 'aoss', region, credentials, sha256: Sha256 });
const http = new NodeHttpHandler();

const indexMappings = {
  settings: { index: { number_of_shards: 1 } },
  mappings: {
    dynamic: true,
    dynamic_templates: [
      {
        strings_as_text_and_keyword: {
          match_mapping_type: 'string',
          mapping: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } }
        }
      }
    ],
    properties: {
      username: { type: 'keyword' },
      url: { type: 'keyword' },
      title: { type: 'text' },
      description: { type: 'text' },
      publisher: { type: 'keyword' },
      image: { type: 'keyword' },
      imageKey: { type: 'keyword' },
      thirdPartyImage: { type: 'keyword' },
      comments: { type: 'text' },
      isArchived: { type: 'boolean' },
      createdAt: { type: 'date' },
      updatedAt: { type: 'date' },
      entityType: { type: 'keyword' },
      id: { type: 'keyword' },
      pk: { type: 'keyword' },
      sk: { type: 'keyword' }
    }
  }
};

async function signedHandle(req) {
  const signed = await signer.sign({ method: req.method, protocol: req.protocol, hostname: req.hostname, path: req.path, headers: { ...req.headers }, query: req.query, body: req.body });
  const signedReq = new HttpRequest({ ...req, headers: signed.headers });
  const { response } = await http.handle(signedReq);
  const chunks = [];
  for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return { status: response.statusCode || 0, text };
}

async function create() {
  const host = endpoint.replace(/^https?:\/\//, '');
  const put = new HttpRequest({ method: 'PUT', protocol: 'https:', hostname: host, path: `/${indexName}`, headers: { host, 'content-type': 'application/json' }, body: JSON.stringify(indexMappings) });
  const { status, text } = await signedHandle(put);
  if (status < 200 || status >= 300) throw new Error(`Create failed: ${status} ${text?.slice(0,500)}`);
  console.log('Index created', { indexName, status });
}

async function del() {
  const host = endpoint.replace(/^https?:\/\//, '');
  const delReq = new HttpRequest({ method: 'DELETE', protocol: 'https:', hostname: host, path: `/${indexName}`, headers: { host } });
  const { status, text } = await signedHandle(delReq);
  if (status < 200 || status >= 300) throw new Error(`Delete failed: ${status} ${text?.slice(0,500)}`);
  console.log('Index deleted', { indexName, status });
}

async function verify() {
  const host = endpoint.replace(/^https?:\/\//, '');
  const get = new HttpRequest({ method: 'GET', protocol: 'https:', hostname: host, path: `/${indexName}`, headers: { host } });
  const { status, text } = await signedHandle(get);
  if (status < 200 || status >= 300) throw new Error(`Verify failed: ${status} ${text?.slice(0,500)}`);
  console.log('Index exists', { indexName, status });
}

if (cmd === 'create') create();
else if (cmd === 'delete') del();
else if (cmd === 'verify') verify();
else {
  console.log('Usage: node scripts/index-tools.mjs [create|delete|verify]');
  process.exit(1);
}


