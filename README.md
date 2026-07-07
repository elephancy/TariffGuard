# TariffGuard

TariffGuard is a compact serverless EV charging session validation and tariff audit system. It receives completed charging sessions, enforces idempotency, applies the correct historical tariff, calculates money with `Decimal`, flags suspicious sessions, stores auditable DynamoDB records, and exposes a dark operations dashboard.

## Architecture

```text
React/Vite dashboard
        |
        v
Amazon Cognito managed login
        |
        | access token
        v
API Gateway HTTP API with JWT authorization, CORS, and throttling
        |
        v
Lambda API handler ----> DynamoDB TariffGuardIdempotency
        |                         |
        |                         +-- conditional put prevents changed duplicates
        v
DynamoDB TariffGuardMain <---- Lambda validation worker <---- SQS validation queue
        ^                                  |
        |                                  v
Lambda daily audit worker <--------- SQS dead-letter queue
        ^
        |
EventBridge daily schedule
```

## Repository Walkthrough

```text
backend/                  Lambda application and automated tests
  src/tariffguard/
    handlers/             AWS entry points for API, SQS, and EventBridge
    models/               Pydantic request and stored-result contracts
    repositories/         DynamoDB and SQS access patterns
    services/             Idempotency, pricing, validation, and overview logic
    utils/                HTTP responses, structured logs, and ISO time helpers
  tests/                  Focused unit and handler tests
frontend/                 React operations application
  src/api/                Typed HTTP client and API response contracts
  src/components/         Shared status and state components
  src/data/               Realistic mock fallback dataset
  src/pages/              Overview, sessions, detail, tariffs, alerts, and audit
infra/                    Terraform infrastructure grouped by AWS service
scripts/                  Seeding, simulation, and Lambda packaging tools
examples/                 Reusable API request payloads
```

### Request Flow Example

A `POST /sessions` request for `sess_001` follows this path:

```text
API Gateway route
  -> tariffguard.handlers.api.handler
  -> SessionIngest Pydantic validation
  -> conditional idempotency write for BER-CP-014#sess_001
  -> PENDING_VALIDATION records in DynamoDB
  -> SQS validation message
  -> validation_worker Lambda
  -> historical tariff lookup at the session startedAt timestamp
  -> validation flags and Decimal price calculation
  -> final DynamoDB session and charger records
  -> alert records when medium/high flags exist
  -> GET /overview response consumed by React
```

Submitting exactly the same normalized payload reaches the existing idempotency
record and returns the existing session with `200`. Changing a field while
keeping the same charger/session key returns `409`.

### Backend Parts

- `handlers/api.py` maps API Gateway HTTP API events to the documented routes.
  For example, `POST /sessions` validates input, claims the idempotency key,
  stores the pending record, and sends the SQS message.
- `handlers/validation_worker.py` processes SQS records independently. A failed
  message ID is returned in `batchItemFailures`, allowing successful records in
  the same batch to remain complete.
- `handlers/audit_worker.py` is invoked daily by EventBridge. It counts final
  statuses, sums stored `Decimal` totals, and writes `AUDIT_DAY#<date>/SUMMARY`.
- `models/session.py` defines ingest, validation flag, price breakdown, and
  stored session contracts. DynamoDB numbers are loaded into `Decimal`, never
  Python float, for pricing.
- `services/validation.py` produces codes such as `METER_REVERSED`,
  `EXCESSIVE_ENERGY`, and `SUSPICIOUS_AVERAGE_POWER`.
- `services/pricing.py` applies energy, session, idle, and tax components and
  only rounds display values at the final boundary.
- `services/idempotency.py` creates the stable normalized SHA-256 payload hash.
- `repositories/dynamodb_repo.py` owns every DynamoDB key pattern and SQS send.
  Business services do not construct table keys directly.

### Terraform Files

- `provider.tf` pins Terraform and provider compatibility. The AWS provider uses
  `aws_region`; `archive` creates the final Lambda ZIP; `null` runs packaging
  when source or dependency hashes change.
- `variables.tf` exposes region, environment, CORS origin, PITR, project name,
  and the local Python executable. Use `python` on Windows and `python3` on
  Linux.
- `locals.tf` produces consistent names such as `tariffguard-dev-api`, defines
  cross-platform build paths, and centralizes Lambda environment variables.
- `dynamodb.tf` creates the composite-key main table, its tariff-listing GSI,
  and the separate conditional-write idempotency table.
- `sqs.tf` creates the validation queue and DLQ. `maxReceiveCount = 3` moves a
  repeatedly failing session message to the DLQ.
- `iam.tf` defines the Lambda trust policy and runtime permissions. Lambda can
  write its log streams, use only the two TariffGuard tables/index, and access
  only the validation queues. This role is for running functions, not for the
  human or CI identity that executes Terraform.
- `lambda.tf` runs `scripts/package_lambda.py`, packages Linux CPython 3.12
  wheels even when Terraform runs on Windows, creates all three functions, and
  connects SQS with `ReportBatchItemFailures`. The validation worker uses the
  account concurrency pool instead of reserving capacity, which keeps deployment
  compatible with new AWS accounts that have low Lambda concurrency quotas.
- `api_gateway.tf` creates the HTTP API, exact routes, Lambda proxy integration,
  Cognito JWT authorizer, default auto-deploy stage, CORS policy, rate limits,
  and invoke permission. Only `GET /health` is public.
- `cognito.tf` creates an admin-managed operator directory, public browser app
  client, Authorization Code + PKCE login, and the Cognito hosted domain.
- `eventbridge.tf` schedules the audit Lambda once per day and grants
  EventBridge permission to invoke it.
- `cloudwatch.tf` explicitly creates all Lambda log groups with seven-day
  retention.
- `outputs.tf` exposes the API URL, main table name, and validation queue URL
  needed during a demo.

### Frontend Parts

- `App.tsx` loads the dated overview and owns global loading, error, and retry
  behavior. The application shell remains usable when the session list is empty.
- `pages/OverviewPage.tsx` provides the shared responsive shell, navigation,
  KPI cards, charts, recent sessions, CSV export, and auxiliary operational
  views.
- `pages/SessionsPage.tsx` reads the paginated session registry in 100-row
  batches, then filters loaded rows by free text and status.
- `pages/SessionDetailPage.tsx` calls `GET /sessions/{sessionId}` and displays
  the immutable input, validation flags, tariff snapshot, and price breakdown.
- `pages/TariffsPage.tsx` calls the tariff list and version endpoints, then
  creates append-only versions and renders the active version, comparison, and
  immutable timeline.
- `pages/UsersPage.tsx` lets Cognito administrators create operator or admin
  accounts and enable or disable existing accounts.
- `pages/AlertsPage.tsx` calls the dated alerts endpoint and groups records into
  high, medium, and low severity work columns.
- `pages/AuditPage.tsx` calls the daily audit endpoint and renders persisted
  totals, revenue, pass rate, and outcome distribution.
- `api/client.ts` switches between real HTTP requests and `mockData.ts` using
  `VITE_API_BASE_URL` and `VITE_USE_MOCKS`.

## AWS Services

Terraform creates API Gateway HTTP API, Cognito operator authentication, three Python 3.12 Lambda functions, SQS with a dead-letter queue, DynamoDB main and idempotency tables, EventBridge daily audit scheduling, IAM policies, and CloudWatch log groups with 7-day retention.

## Backend Decisions

The backend uses direct Lambda handlers instead of FastAPI to keep the serverless path clear for interviews. Pydantic validates request bodies, `boto3` is the only AWS client dependency, and all money/energy calculations use `Decimal`. The validation worker returns `{"batchItemFailures": [...]}` so one bad SQS record does not fail the whole batch.

Session ingestion uses `chargerId#sessionId` as the idempotency key and a stable SHA-256 hash of the normalized payload. A first submission writes to the idempotency table with `attribute_not_exists(idempotencyKey)`, stores a `PENDING_VALIDATION` session, enqueues SQS, and returns `202`. A duplicate with the same payload returns `200` and the existing session state. A duplicate with changed payload returns `409`.

## DynamoDB Access Patterns

Main table:

```text
Tariff version:         PK=TARIFF#{tariffId}       SK=VERSION#{validFrom}
Session direct lookup:  PK=SESSION#{sessionId}     SK=METADATA
Charger session list:   PK=CHARGER#{chargerId}     SK=SESSION#{startedAt}#{sessionId}
Alert listing:          PK=ALERT_DAY#{yyyy-mm-dd}  SK=ALERT#{severity}#{sessionId}
Audit summary:          PK=AUDIT_DAY#{yyyy-mm-dd}  SK=SUMMARY
```

The `GSI1` index lists tariff versions across tariff IDs. Tariff versions are append-only; sessions use the newest `validFrom` at or before `startedAt`.

`GSI2` lists session metadata globally by start time:

```text
Session listing:        GSI2PK=SESSIONS             GSI2SK=STARTED#{startedAt}#{sessionId}
```

The dashboard and `/sessions` endpoint use `GSI2` with cursor pagination. This keeps large demo datasets from forcing the API Lambda to scan and sort the full DynamoDB table on every page load.

## Local Setup

Prerequisites: Python 3.12, Node.js 20.19+, npm, Terraform 1.6+, AWS credentials for deployment.

```bash
cp .env.example .env
make install
make test
make lint
make frontend-build
```

`make install` creates `/tmp/tariffguard-venv` by default. Override it with `make install VENV=.venv` if you prefer an in-repo virtual environment.

Run the dashboard with mock data:

```bash
VITE_USE_MOCKS=true make frontend-dev
```

## Deployment

From a clean checkout:

```bash
make install
cd infra
terraform init
terraform plan -out=tfplan \
  -var='environment=demo' \
  -var='cors_origin=http://localhost:5173' \
  -var='frontend_urls=["http://localhost:5173"]'
terraform apply tfplan
terraform output api_base_url
```

Terraform calls the Python packager without Unix shell commands, so deployment
works from PowerShell, Windows Command Prompt, Linux, and WSL. The packager
copies TariffGuard source and downloads Linux x86-64 CPython 3.12 wheels for
`boto3`, Pydantic, and their transitive dependencies before creating the ZIP.

PowerShell:

```powershell
terraform plan -out=tfplan `
  -var="environment=dev" `
  -var="cors_origin=http://localhost:5173" `
  -var='frontend_urls=["http://localhost:5173","https://tariffguard.elfeel.me"]' `
  -var="python_executable=python"
terraform apply tfplan
```

When adding `GSI2` to an existing demo table, backfill old session rows once
after Terraform finishes:

```powershell
python scripts/backfill_session_index.py `
  --table-name $(terraform output -raw main_table_name) `
  --region eu-central-1
```

Linux or WSL:

```bash
terraform plan -out=tfplan \
  -var='environment=dev' \
  -var='cors_origin=http://localhost:5173' \
  -var='frontend_urls=["http://localhost:5173","https://tariffguard.elfeel.me"]' \
  -var='python_executable=python3'
terraform apply tfplan
```

If an older apply failed at `null_resource.lambda_package` after creating some
AWS resources, do not delete the Terraform state. Pull this fix, run
`terraform plan` again with the same environment and CORS variables, and apply
the new plan. Terraform will retain the resources already recorded in state and
create the missing package, Lambdas, integrations, and remaining dependencies.

For local smoke checks, `make build-backend` packages the same runtime dependency set from the virtualenv created by `make install` and writes `build/tariffguard-lambda.zip`.

Useful variables:

```bash
terraform apply -var='environment=demo' -var='cors_origin=http://localhost:5173'
```

## Authentication and Rate Limiting

Every route except `GET /health` requires a Cognito access token. API Gateway
verifies the JWT signature, issuer, expiry, and app-client audience before it
invokes Lambda. The default stage allows 10 sustained requests per second with
a burst of 20; both values are configurable Terraform variables.

Create the first operator after `terraform apply`:

```powershell
$POOL_ID = terraform output -raw cognito_user_pool_id
$CLIENT_ID = terraform output -raw cognito_client_id
$EMAIL = "admin@example.com"
$PASSWORD = Read-Host "Choose a password with upper, lower, number, and symbol"

aws cognito-idp admin-create-user `
  --user-pool-id $POOL_ID `
  --username $EMAIL `
  --user-attributes "Name=email,Value=$EMAIL" "Name=email_verified,Value=true" `
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password `
  --user-pool-id $POOL_ID `
  --username $EMAIL `
  --password $PASSWORD `
  --permanent

aws cognito-idp admin-add-user-to-group `
  --user-pool-id $POOL_ID `
  --username $EMAIL `
  --group-name admins
```

The Cognito user pool disables public sign-up. After this bootstrap, use the
Users page to create operators or administrators and to disable accounts.

For Cloudflare Pages, configure:

```text
VITE_USE_MOCKS=false
VITE_API_BASE_URL=<terraform output -raw api_base_url>
VITE_COGNITO_AUTHORITY=<terraform output -raw cognito_authority>
VITE_COGNITO_CLIENT_ID=<terraform output -raw cognito_client_id>
VITE_COGNITO_DOMAIN=<terraform output -raw cognito_domain>
```

The app redirects unauthenticated visitors to Cognito managed login using
Authorization Code + PKCE. Access tokens stay in browser storage and are added
to API requests as `Authorization: Bearer <token>`.

Destroy demo resources:

```bash
make destroy
```

## Seeding Demo Data

```bash
$POOL_ID = terraform -chdir=infra output -raw cognito_user_pool_id
$CLIENT_ID = terraform -chdir=infra output -raw cognito_client_id
$API_URL = terraform -chdir=infra output -raw api_base_url
$TOKEN = aws cognito-idp initiate-auth `
  --auth-flow USER_PASSWORD_AUTH `
  --client-id $CLIENT_ID `
  --auth-parameters "USERNAME=$EMAIL,PASSWORD=$PASSWORD" `
  --query "AuthenticationResult.AccessToken" `
  --output text

python scripts/seed.py --api-url $API_URL --access-token $TOKEN
```

The seed script creates a tariff and submits three sessions: one normal, one reversed meter rejection, and one suspicious average power flag.

Generate a larger dataset after the tariff exists:

```powershell
python scripts/simulate_sessions.py `
  --api-url $API_URL `
  --access-token $TOKEN `
  --count 5000 `
  --days 14
```

The simulator uses a weighted mix of approximately 75% valid sessions, 10%
low-severity long sessions, 5% medium-severity zero-energy or long-idle
sessions, and 10% high-severity energy, power, meter, duration, or tariff
failures. Each day varies around that overall distribution so multi-day charts
do not look uniform. Charger, driver, energy, timing, and idle values vary
deterministically; `--seed` changes the generated dataset. The script paces
requests below the default API rate limit and retries throttled or transient
server responses.

## API Examples

```bash
curl "$API_URL/health"

curl -X POST "$API_URL/tariffs" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"tariffId":"berlin_public_standard","currency":"EUR","validFrom":"2026-06-01T00:00:00Z","pricePerKwh":"0.49","sessionFee":"0.35","idleFeePerMinute":"0.10","idleGraceMinutes":15,"taxRate":"0.19"}'

curl -H "Authorization: Bearer $TOKEN" "$API_URL/tariffs"
curl -H "Authorization: Bearer $TOKEN" "$API_URL/tariffs/berlin_public_standard/versions"

curl -X POST "$API_URL/sessions" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d @examples/session.json

curl -H "Authorization: Bearer $TOKEN" "$API_URL/sessions/sess_001"
curl -H "Authorization: Bearer $TOKEN" "$API_URL/sessions?limit=100"
curl -X POST "$API_URL/sessions/sess_001/invalidate" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"reason":"Incorrect source meter reading"}'
curl -H "Authorization: Bearer $TOKEN" "$API_URL/chargers/BER-CP-014/sessions"
curl -H "Authorization: Bearer $TOKEN" "$API_URL/alerts?date=2026-06-30"
curl -H "Authorization: Bearer $TOKEN" "$API_URL/audit/daily?date=2026-06-30"
curl -H "Authorization: Bearer $TOKEN" "$API_URL/overview?date=2026-06-30"
```

Duplicate behavior:

```bash
# Same payload: 200 with existing state.
curl -i -X POST "$API_URL/sessions" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d @examples/session.json

# Same chargerId/sessionId with changed payload: 409.
curl -i -X POST "$API_URL/sessions" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d @examples/changed-session.json
```

`POST /dev/seed` exists only when `ENVIRONMENT` is not `production`.

## Frontend Setup

Use mock data:

```bash
VITE_USE_MOCKS=true make frontend-dev
```

Use the deployed API by placing its Terraform outputs in `frontend/.env.local`:

```text
VITE_USE_MOCKS=false
VITE_API_BASE_URL=https://example.execute-api.eu-central-1.amazonaws.com
VITE_COGNITO_AUTHORITY=https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_example
VITE_COGNITO_CLIENT_ID=example
VITE_COGNITO_DOMAIN=https://example.auth.eu-central-1.amazoncognito.com
```

```bash
make frontend-dev
```

The dashboard includes loading, empty, and error states. The main overview matches the requested dark sidebar layout with KPI cards, a validation line chart, an alert donut chart, and a recent sessions table.

Every sidebar item has a browser URL. Cloudflare Pages serves
`frontend/public/_redirects`, so direct visits and browser back/forward work for
paths such as `/sessions`, `/sessions/{sessionId}`, `/tariffs`, and `/users`.

The sidebar views are functional:

- Sessions: paginated loading, search, status filtering, and detail navigation.
- Session detail: pricing, tariff snapshot, flags, raw input, and invalidation.
- Tariffs: creation, catalog, current rates, comparison, immutable timeline.
- Alerts: severity-grouped operator board linked back to session detail.
- Audit: daily totals, pass rate, estimated revenue, outcome distribution.
- Users: Cognito account creation, admin roles, and enable/disable controls.

## Cost Notes

This demo uses pay-per-request DynamoDB, Lambda, API Gateway HTTP API, SQS, and short CloudWatch log retention. At interview/demo traffic levels it should stay inside low-cost or free-tier usage for most AWS accounts. Delete resources with `make destroy` when finished.

## Interview Demo Path

You can demo the project in under five minutes:

```bash
make test
make frontend-build
terraform -chdir=infra apply
python scripts/seed.py --api-url "$API_URL" --access-token "$TOKEN"
make frontend-dev
```

Talk through Cognito JWT validation, API throttling, the conditional idempotency
write, append-only tariff versions, Decimal pricing, worker partial batch
failure response, DLQ redrive policy, and DynamoDB keys. Then show
`sess_reversed` becoming `REJECTED` and `sess_power` becoming `FLAGGED`.
