# Certificates module

Configurable certificate / transcript issuance with branding, dynamic fields, numbering chains,
PDF generation and tamper-evident QR verification. Feature flag: `certificates`.

## Lifecycle

`REQUESTED → GENERATED → APPROVED → ISSUED`, with `REJECTED` (from REQUESTED/GENERATED) and
`REVOKED` (from ISSUED) terminal states. Reissue creates a new linked certificate
(`reissuedFromId`), allocates a fresh number + QR token and lands directly in `ISSUED`.
Every transition appends a `CertificateHistoryRow` and an audit entry (`CERTIFICATE_*` actions,
`AUDIT_MODULES.CERTIFICATES`).

## Pieces

- `certificate-numbering.ts` — `prefix-tail-seq` format (`CERT-BON-0001`), per-type tails,
  template `numberingJson {prefix,start,padding}` → tenant `numbering.certificatePrefix` → default.
- `certificate-fields.ts` — resolves the template's ordered `label → source` field map against a
  student/result context (`student.x`, `program.name`, `campus.name`, `batch.name`,
  `certificate.x`, block tokens `subjects` / `summary`) with per-type `DEFAULT_FIELD_CONFIG`.
- `certificate-pdf.ts` — dependency-free multi-page A4 PDF writer (header band, branding, wrapped
  fields, repeating marksheet table header, footer + vector QR from the `qrcode` module matrix).
- `certificate-scope.ts` — student-anchored RBAC scoping via the shared `examStudentWhereInput`.
- `certificates.service.ts` — template CRUD, lifecycle transitions, numbering retry loop (P2002),
  synchronous PDF render + storage upload, `contentJson` snapshot, CSV export, public verify.

## Endpoints

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/certificates/templates` | `certificates.view` |
| POST / PATCH / DELETE | `/certificates/templates[/:id]` | `certificates.manage` |
| POST | `/certificates/templates/:id/archive` | `certificates.manage` |
| GET | `/certificates` | `certificates.view` |
| GET | `/certificates/export` | `certificates.export` |
| GET | `/certificates/:id` / `:id/download-url` | `certificates.view` |
| POST | `/certificates` / `:id/generate` | `certificates.create` |
| POST | `:id/approve` / `:id/issue` / `:id/reject` / `:id/revoke` / `:id/reissue` | `certificates.approve` |
| GET | `/public/certificates/verify/:qrToken` (no auth, excluded from tenant middleware) | — |

The printed QR encodes `PUBLIC_BASE_URL + /verify/certificate?token=<qrToken>`; the random token is
the only credential, so the public route stays unscoped and audit-logged as `SYSTEM`.
