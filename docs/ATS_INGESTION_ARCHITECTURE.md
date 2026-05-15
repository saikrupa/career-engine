# ATS Ingestion Architecture

## Goals

- Support startup and enterprise ATS sources in one modular pipeline.
- Keep connector logic isolated so new ATS integrations can be added without changing orchestration code.
- Normalize all sources into one schema usable by tracker, search, and analytics features.

## Proposed Folder Structure

```text
ats_ingestion/
  connectors/
    base.py
    workday.py
    taleo.py
    successfactors.py
    icims.py
    ukg.py
    adp.py
    greenhouse.py
    lever.py
    ashby.py
  detection.py
  registry.py
  normalize.py
  schema.py
  http_client.py
  pipeline.py
scripts/
  ingest_jobs.py
```

## End-to-End Flow

1. Career URL is submitted.
2. `detect_ats()` predicts ATS system and confidence.
3. `build_connector()` resolves the connector implementation.
4. Connector fetches source data with retries and rate-limit resilience.
5. Connector normalizes to `UnifiedJob`.
6. Cross-source dedup is applied through deterministic content hashes.
7. Data is passed to storage/indexing.

Batch mode is available via `ingest_company_batch()` to process multiple companies with per-company error isolation.

## Unified Schema

All connectors emit:

```json
{
  "job_id": "",
  "title": "",
  "company": "",
  "location": "",
  "remote": false,
  "description": "",
  "posted_date": "",
  "apply_url": "",
  "source_system": "",
  "employment_type": "",
  "experience_level": ""
}
```

## Workday Notes

- Endpoint discovery format:
  - `https://<company>.wd5.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs`
- Pagination uses JSON body with `offset` and `limit`.
- Supports parsing nested fields (`bulletFields`, `locationsText`, `locations`).
- Rebuilds public apply URL from `externalPath`.

## Taleo Notes

- First try RSS (`/rss`, `?rss=true`) for stable extraction.
- Fallback to HTML anchor parsing when RSS is unavailable.

## SuccessFactors Notes

- Parse embedded JSON from script tags when available.
- Fallback to dynamic endpoint or HTML card parsing.
- Filtering supports keyword and location post-fetch.

## Resilience Strategy

- Exponential backoff with jitter.
- 429 and 5xx retries.
- Rotating User-Agent and request headers.
- Connector-level failure isolation so one source does not stop batch ingestion.

## Storage Layer (Design)

### Relational Core (PostgreSQL)

Table: `jobs`

- `id` (UUID, PK)
- `external_job_id` (text)
- `dedup_key` (text, unique)
- `source_system` (text)
- `company` (text)
- `title` (text)
- `location` (text)
- `remote` (boolean)
- `description` (text)
- `posted_date` (date, nullable)
- `apply_url` (text)
- `employment_type` (text)
- `experience_level` (text)
- `created_at`, `updated_at` (timestamp)

Indexes:

- `(source_system, company)` for ingestion health checks.
- `GIN(to_tsvector('english', title || ' ' || coalesce(description, '')))` for full text.
- `(location, remote)` for geo and remote filters.
- `(posted_date desc)` for freshness queries.
- Unique index on `dedup_key` for idempotent ingestion.

### Search Layer (Optional Elasticsearch/OpenSearch)

- Mirror normalized jobs into search index for fast faceted search.
- Fields: `title`, `company`, `location`, `remote`, `employment_type`, `experience_level`, `posted_date`.
- Use analyzers for keyword matching, synonyms, and typo tolerance.

## Scalability Improvements

- Queue-based ingestion fan-out (SQS/Kafka/RabbitMQ).
- Per-connector workers with independent retry queues.
- Connector health scoring and circuit breakers.
- Incremental sync windows with etag/hash snapshots.
- Structured data parser for `application/ld+json` (Google Jobs compatible pages).

Current implementation includes a structured-data extraction helper in `ats_ingestion/structured_data.py` for `JobPosting` blocks.
