# Security — USA & India aligned controls

Agent Studio implements **engineering security and privacy controls** mapped to common US and India expectations. This document describes product safeguards; it is **not** a legal opinion, SOC 2 report, or DPDP certification.

## Jurisdiction coverage

| Region | Frameworks (aligned practices) |
|--------|--------------------------------|
| **United States** | NIST CSF 2.0, SOC 2 Trust Services (aligned), CCPA/CPRA readiness |
| **India** | DPDP Act 2023, CERT-In logging expectations, IT Act 2000 reasonable security practices |

Live machine-readable matrix: `GET /security/policy`

## Controls implemented

### Protect (access & encryption)
- **API key authentication** (`X-API-Key` / Bearer) with roles: `admin` · `operator` · `viewer`
- **RBAC**: viewers read; operators write/run; admins manage secrets + audit + retention
- **Secrets at rest**: AES-256-GCM (`SECRETS_KEY`); YAML stores `secretRef` only
- **Secrets never returned** in API list responses (metadata only)
- **HTTP security headers** via Helmet
- **Rate limiting** (default 120 req/min)
- **CORS** locked to configured origin

### Detect & respond
- **Immutable-style audit log** in MongoDB (`audit_logs`) for create/apply/run/secret/auth events
- Audit fields: actor, role, action, resource, IP, user-agent, success, residency tags
- Sensitive fields **redacted** in audit detail
- Contacts: `PRIVACY_CONTACT`, `SECURITY_CONTACT`

### Privacy & data minimization (US + IN)
- Workspace **purpose**, **residency** (`US`/`IN`/`EU`/`GLOBAL`), **classification**
- Default residency configurable (`DATA_RESIDENCY`, default `IN`)
- **Retention**: audit + run purge (`AUDIT_RETENTION_DAYS`, `RUN_RETENTION_DAYS`)
- **PII scrubbing** on log API (email, US SSN, IN Aadhaar/PAN/phone patterns) — `?scrub=0` to disable for admins in controlled envs

### Integrity
- Versioned apply: **override** vs **new_version** with confirmation
- Run materialization isolates each execution under `data/runs/...`

## Production checklist

```bash
# server/.env
NODE_ENV=production
AUTH_REQUIRED=true
API_KEYS=as_your_admin_key:admin,as_ops_key:operator,as_view_key:viewer
SECRETS_KEY=<random-64-char-string>
DATA_RESIDENCY=IN   # or US
AUDIT_RETENTION_DAYS=365
RUN_RETENTION_DAYS=90
PRIVACY_CONTACT=privacy@yourcompany.com
SECURITY_CONTACT=security@yourcompany.com
CORS_ORIGIN=https://studio.yourcompany.com
```

Place TLS termination (HTTPS) at reverse proxy / Tauri secure context. Prefer MongoDB auth + network isolation.

## API

| Endpoint | Role | Purpose |
|----------|------|---------|
| `GET /security/policy` | public | Control matrix + warnings |
| `GET /security/audit` | admin | Audit export |
| `POST /security/retention/purge` | admin | Enforce retention |

## What this does *not* claim
- Formal SOC 2 Type II / ISO 27001 certification  
- Automatic legal compliance with every DPDP / CCPA obligation (legal review still required)  
- Full FedRAMP / HIPAA unless separately scoped  

For enterprise attestation, engage VynelixAI security + counsel to map these controls to your policies.
