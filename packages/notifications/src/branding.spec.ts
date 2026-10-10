import { isHexColor, renderBrandedEmailHtml, resolveEmailBranding } from './branding';

describe('resolveEmailBranding', () => {
  it('falls back to the tenant name and platform defaults', () => {
    const resolved = resolveEmailBranding(null, 'St Marys College');
    expect(resolved.portalName).toBe('St Marys College');
    expect(resolved.senderName).toBe('St Marys College');
    expect(resolved.primaryColor).toBe('#1d4ed8');
    expect(resolved.headerColor).toBe('#1d4ed8');
    expect(resolved.senderEmail).toBeNull();
    expect(resolved.replyTo).toBeNull();
  });

  it('honours the configured identity, sender and colors', () => {
    const resolved = resolveEmailBranding(
      {
        portalName: 'SM Portal',
        collegeName: 'St Marys College',
        primaryColor: '#0f766e',
        emailHeaderColor: '#334155',
        senderName: 'St Marys Registrar',
        senderEmail: 'noreply@stmarys.edu',
        replyToEmail: 'support@stmarys.edu',
        emailFooterText: 'St Marys College',
        emailSignature: 'Registrar',
      },
      'Ignored',
    );
    expect(resolved.portalName).toBe('SM Portal');
    expect(resolved.primaryColor).toBe('#0f766e');
    expect(resolved.headerColor).toBe('#334155');
    expect(resolved.senderName).toBe('St Marys Registrar');
    expect(resolved.senderEmail).toBe('noreply@stmarys.edu');
    expect(resolved.replyTo).toBe('support@stmarys.edu');
  });

  it('ignores an invalid hex color', () => {
    const resolved = resolveEmailBranding({ primaryColor: 'not-a-color' }, 'X');
    expect(resolved.primaryColor).toBe('#1d4ed8');
    expect(isHexColor('#abc')).toBe(true);
    expect(isHexColor('#abcdef')).toBe(true);
    expect(isHexColor('red')).toBe(false);
  });
});

describe('renderBrandedEmailHtml', () => {
  it('renders the tenant identity and escapes untrusted text', () => {
    const branding = resolveEmailBranding({ portalName: 'SM Portal', primaryColor: '#0f766e' }, 'St Marys');
    const html = renderBrandedEmailHtml({
      subject: 'Welcome',
      body: 'Hello <script>alert(1)</script>',
      branding,
    });
    expect(html).toContain('SM Portal');
    expect(html).toContain('#0f766e');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes the footer and signature when configured', () => {
    const branding = resolveEmailBranding(
      { emailFooterText: 'Confidential', emailSignature: 'The Registrar', emailSupportAddress: 'help@x.edu' },
      'X College',
    );
    const html = renderBrandedEmailHtml({ subject: 'S', body: 'B', branding });
    expect(html).toContain('Confidential');
    expect(html).toContain('The Registrar');
    expect(html).toContain('help@x.edu');
  });
});
