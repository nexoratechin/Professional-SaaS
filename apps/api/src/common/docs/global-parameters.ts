import type { OpenAPIObject } from '@nestjs/swagger';

export interface GlobalParameter {
  name: string;
  in: 'header';
  required?: boolean;
  description?: string;
  example?: string | number;
  schema?: { type: string; description?: string; default?: string | number; enum?: Array<string | number> };
}

/** Request headers that apply to (almost) every operation. Injected into the generated OpenAPI
 *  document post-creation because @nestjs/swagger has no first-class "global header parameter"
 *  builder — this keeps Swagger UI honest about the contract while avoiding a decorator on every
 *  handler. */
export const GLOBAL_HEADER_PARAMETERS: GlobalParameter[] = [
  {
    name: 'X-API-Version',
    in: 'header',
    required: false,
    description:
      'API version to target. Omit to use the default version (1). Future versions opt in via the header.',
    example: '1',
    schema: {
      type: 'string',
      default: '1',
      enum: ['1'],
      description: 'Requested API version (defaults to 1).',
    },
  },
  {
    name: 'X-Tenant-Slug',
    in: 'header',
    required: false,
    description:
      'Tenant slug, used ONLY in development/CI where subdomain resolution is unavailable (TENANT_HEADER_FALLBACK). In production the tenant is resolved from the request subdomain and this header is ignored.',
    example: 'demo-college',
    schema: { type: 'string', description: 'Tenant slug (dev fallback).' },
  },
  {
    name: 'Idempotency-Key',
    in: 'header',
    required: false,
    description:
      'Client-supplied key that makes a mutating request idempotent. Retries with the same method+path+key within IDEMPOTENCY_TTL_SECONDS (default 24h) replay the original response instead of re-executing. Safe for any POST/PATCH/PUT/DELETE; required for payment-style endpoints that must not double-apply.',
    example: 'cc30c53c-4f3e-4a5d-9e07-6f72ce04a1d7',
    schema: { type: 'string', description: 'Unique per operation, reused only on retries.' },
  },
  {
    name: 'X-Request-Id',
    in: 'header',
    required: false,
    description:
      'Correlation id. Omit to have one generated; the value is always echoed back on the response so a failing call can be quoted exactly in a support ticket.',
    example: '0f4a2d3c-7f8b-4a6e-9c10-2e3d4f5a6b7c',
    schema: { type: 'string', description: 'Client id (optional) or server-generated UUID.' },
  },
];

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

/** Injects GLOBAL_HEADER_PARAMETERS into every operation of the document. Skips operations that
 *  already declare a header of the same name; keeps parameters stable across calls. */
export function applyGlobalHeaderParameters(document: OpenAPIObject, parameters: GlobalParameter[] = GLOBAL_HEADER_PARAMETERS): void {
  const paths = document.paths;
  if (!paths) return;

  for (const path of Object.keys(paths)) {
    const pathItem = paths[path];
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const existing = new Set(
        (operation.parameters ?? []).flatMap((p) => ('$ref' in p ? [] : [`${p.in}:${p.name}`])),
      );
      const merged = [...(operation.parameters ?? [])];

      let changed = false;
      for (const param of parameters) {
        if (!existing.has(`${param.in}:${param.name}`)) {
          merged.push({
            name: param.name,
            in: param.in,
            description: param.description,
            required: param.required ?? false,
            example: param.example,
            schema: param.schema,
          });
          changed = true;
        }
      }

      if (changed) {
        operation.parameters = merged;
      }
    }
  }
}