/**
 * Tenant email branding + sender identity resolution.
 *
 * This is the single implementation both the API (previews / validation) and the worker (actual
 * delivery) use, so what a tenant configures is exactly what a recipient sees. It deliberately
 * operates on the raw `branding` section of the tenant configuration JSON document (unknown shape)
 * and applies defaults, so it never throws on a partially-configured tenant.
 *
 * No Prisma/NestJS imports here: the caller passes the branding object it already loaded, keeping
 * this package dependency-free and unit-testable.
 */

export interface TenantBrandingLike {
  collegeName?: string | null;
  tagline?: string | null;
  portalName?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  emailHeaderColor?: string | null;
  emailFooterText?: string | null;
  emailSignature?: string | null;
  emailSupportAddress?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  replyToEmail?: string | null;
}

export interface ResolvedEmailBranding {
  /** White-label product/portal name used in the header and as the default sender name. */
  portalName: string;
  collegeName: string;
  tagline: string | null;
  primaryColor: string;
  headerColor: string;
  /** Display name for the From header (never the envelope address). */
  senderName: string;
  /** Optional From address override; the provider's configured envelope sender is used when unset. */
  senderEmail: string | null;
  /** Optional Reply-To address. */
  replyTo: string | null;
  footerText: string | null;
  signature: string | null;
  supportAddress: string | null;
}

const DEFAULT_PRIMARY = '#1d4ed8';

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

/** A conservative hex-color check so a malformed value can never break the email markup. */
export function isHexColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

export function resolveEmailBranding(
  branding: TenantBrandingLike | null | undefined,
  tenantName: string,
): ResolvedEmailBranding {
  const portalName = firstNonEmpty(branding?.portalName, branding?.collegeName, tenantName, 'College ERP') ?? 'College ERP';
  const primaryColor = isHexColor(branding?.primaryColor) ? (branding!.primaryColor as string) : DEFAULT_PRIMARY;
  const headerColor = isHexColor(branding?.emailHeaderColor) ? (branding!.emailHeaderColor as string) : primaryColor;
  const senderName = firstNonEmpty(branding?.senderName, branding?.portalName, branding?.collegeName, tenantName) ?? portalName;

  return {
    portalName,
    collegeName: firstNonEmpty(branding?.collegeName, tenantName, portalName) ?? portalName,
    tagline: firstNonEmpty(branding?.tagline),
    primaryColor,
    headerColor,
    senderName,
    senderEmail: firstNonEmpty(branding?.senderEmail),
    replyTo: firstNonEmpty(branding?.replyToEmail, branding?.emailSupportAddress),
    footerText: firstNonEmpty(branding?.emailFooterText),
    signature: firstNonEmpty(branding?.emailSignature),
    supportAddress: firstNonEmpty(branding?.emailSupportAddress),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain text → minimal safe HTML (escape, preserve line breaks, linkify nothing). */
function toHtmlParagraphs(body: string): string {
  return escapeHtml(body)
    .split(/\r?\n/)
    .map((line) => (line.trim().length ? `<p style="margin:0 0 12px;">${line}</p>` : ''))
    .join('');
}

export interface BrandedEmailInput {
  subject: string;
  body: string;
  branding: ResolvedEmailBranding;
  /** Absolute URL of the tenant logo, when one is configured. */
  logoUrl?: string | null;
}

/**
 * Wrap a plain-text notification body in a tenant-branded, table-based HTML email (inline styles
 * only, no external CSS — required by most mail clients). The plain-text body is still delivered
 * as the multipart alternative, so clients that refuse HTML lose nothing.
 */
export function renderBrandedEmailHtml(input: BrandedEmailInput): string {
  const { branding } = input;
  const logo = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" alt="${escapeHtml(branding.portalName)}" height="32" style="height:32px;max-width:200px;display:block;margin:0 0 8px;" />`
    : '';
  const signature = branding.signature
    ? `<p style="margin:16px 0 0;color:#334155;font-size:14px;">${escapeHtml(branding.signature).replace(/\r?\n/g, '<br/>')}</p>`
    : '';
  const footer = branding.footerText ? `<p style="margin:0 0 4px;">${escapeHtml(branding.footerText)}</p>` : '';
  const support = branding.supportAddress
    ? `<p style="margin:0 0 4px;">Need help? <a href="mailto:${escapeHtml(branding.supportAddress)}" style="color:${escapeHtml(branding.primaryColor)};">${escapeHtml(branding.supportAddress)}</a></p>`
    : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(input.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background:${escapeHtml(branding.headerColor)};padding:20px 28px;color:#ffffff;">
                ${logo}
                <div style="font-size:18px;font-weight:700;">${escapeHtml(branding.portalName)}</div>
                ${branding.tagline ? `<div style="font-size:13px;opacity:.85;margin-top:2px;">${escapeHtml(branding.tagline)}</div>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:28px;color:#0f172a;font-size:15px;line-height:1.55;">
                ${toHtmlParagraphs(input.body)}
                ${signature}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.5;border-top:1px solid #e2e8f0;">
                ${footer}
                ${support}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
