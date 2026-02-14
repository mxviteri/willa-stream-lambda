# willa-stream-lambda — DDB Streams to Search + OpenAI (AGENTS.md)

Technical reference for GenAI coding agents working in this repo. This Lambda is triggered by DynamoDB streams and writes to OpenSearch Serverless (AOSS), with optional OpenAI enrichment for Save entities.

---

## Purpose and stack

- **Purpose**: Process DynamoDB stream records (from the global saves/user-data table); index Save and DiscoverTag entities into OpenSearch Serverless; for Save entities, enrich with semantic categories via OpenAI. Supports REMOVE events (delete from index).
- **Stack**: Node, ES modules (`.mjs`). No framework; single Lambda handler.

---

## Entry and handler

- **Entry**: `index.handler` in root `index.mjs`; receives DynamoDB stream `event` (e.g. `event.Records`).
- **Handler flow**:
  1. For each record: extract keys, unmarshall DDB NewImage (or treat REMOVE as delete).
  2. **Entity routing**: By `entityType` — `Save` → saves index (`AOSS_INDEX`), `DiscoverTag` → tag index (`AOSS_TAG_INDEX`); other types skipped.
  3. **Save enrichment**: Call `OpenAIUtil.generateEnrichments({ title, description, url })` in `src/utils/openai.mjs`; result attached to document.
  4. **Normalize**: Ensure `comments` and `thirdPartyImage` are correct types for indexing (strings; strip booleans/invalid values).
  5. **Bulk index**: Build OpenSearch bulk payload (index/delete lines); sign with SigV4; POST to `/_bulk` on AOSS endpoint; retry on 429/5xx with backoff.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `AOSS_ENDPOINT` | OpenSearch Serverless collection endpoint (HTTPS). |
| `AOSS_INDEX` | Index name for Save documents (default `saves`). |
| `AOSS_TAG_INDEX` | Index name for DiscoverTag documents (default `discovertags`). |
| `AWS_REGION` | Region for SigV4 and credentials. |
| `LOG_LEVEL` | Optional; `debug` for verbose logging. |
| `OPENAI_API_KEY` | Used by `src/utils/openai.mjs` for enrichment (set in Lambda env). |

---

## Structure

- **`index.mjs`**: Handler, unmarshall (DDB format → plain object), `normalizeForIndex`, retry loop for bulk request. No separate controller/service — single file for stream logic.
- **`src/utils/openai.mjs`**: OpenAI client; `OpenAIUtil.generateEnrichments({ title, description, url })` — calls gpt-4o-mini with JSON schema output (`enrichments`: array of strings); returns array or empty on error.

---

## Scripts

- **`scripts/index-tools.mjs`**: Index lifecycle — create, delete, verify (e.g. `npm run index:create`, `npm run index:delete`, `npm run index:verify`). Use for out-of-band index mapping/setup; index creation is not done inside the stream Lambda.

---

## Deploy

- Package: `src/`, `index.mjs`, `package.json`, `node_modules/` into a zip (see `package.json` scripts: `package`, `deploy-s3`, `deploy-lambda`).
- Upload zip to the shared Lambda code bucket (e.g. S3); update the Lambda function code (MetadataSearchStack in willa-infrastructure wires the Lambda to the DDB stream and passes env).

---

## Conventions

- Index creation and mapping changes are out-of-band (scripts or separate tooling); the handler assumes indexes exist.
- New entity type: add `entityType` branch in handler, optional enrichment, and target index env if new index.

---

## When editing

- **New entity type**: In `index.mjs`, add branch on `doc.entityType` for target index; add env for new index name if needed; optional enrichment in handler or `openai.mjs`.
- **Index mapping/schema**: Use `scripts/index-tools.mjs` or equivalent; do not create indexes inside the stream handler.
- **New enrichment logic**: Extend `OpenAIUtil` in `src/utils/openai.mjs` or add new helper; call from handler for the appropriate entity type.
- **Normalization**: Adjust `normalizeForIndex` in `index.mjs` if new fields need type coercion for AOSS.
