import { createServer, type Server, type Socket } from 'net';
import { sendSmtpEmail, SmtpError } from './smtp';

/**
 * Tiny in-process SMTP server sufficient to exercise the client: greeting, EHLO, AUTH PLAIN,
 * MAIL FROM / RCPT TO, DATA capture, QUIT. Records what it saw so the test can assert the client
 * sent the right envelope/content.
 */
class MockSmtpServer {
  readonly received: { from: string; to: string; data: string; authed: boolean }[] = [];
  private readonly server: Server;
  private listeningPort = 0;
  private failWith: { stage: string; code: number } | null = null;

  constructor() {
    this.server = createServer((socket) => this.handle(socket));
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    if (address === null || typeof address === 'string') throw new Error('mock server did not bind a port');
    this.listeningPort = address.port;
    return this.listeningPort;
  }

  failAt(stage: string, code: number): void {
    this.failWith = { stage, code };
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handle(socket: Socket) {
    let authed = false;
    let inData = false;
    let data = '';
    let from = '';
    let to = '';
    let buffer = '';

    const fail = (stage: string, code: number) => {
      socket.write(`${code} ${stage} rejected by mock\r\n`);
    };

    socket.write('220 mock.local ESMTP ready\r\n');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (inData) {
          if (line === '.') {
            inData = false;
            this.received.push({ from, to, data, authed });
            socket.write('250 2.0.0 Ok: queued as <mock-message-1@mock.local>\r\n');
          } else {
            data += `${line}\r\n`;
          }
          continue;
        }

        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO')) {
          socket.write('250-mock.local\r\n250-AUTH PLAIN\r\n250 OK\r\n');
        } else if (upper.startsWith('AUTH PLAIN')) {
          authed = true;
          socket.write('235 2.7.0 Authentication successful\r\n');
        } else if (upper.startsWith('MAIL FROM:')) {
          if (this.failWith?.stage === 'mail') return fail('MAIL', this.failWith.code);
          from = line.slice(10);
          socket.write('250 2.1.0 Ok\r\n');
        } else if (upper.startsWith('RCPT TO:')) {
          if (this.failWith?.stage === 'rcpt') return fail('RCPT', this.failWith.code);
          to = line.slice(8);
          socket.write('250 2.1.5 Ok\r\n');
        } else if (upper === 'DATA') {
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          inData = true;
          data = '';
        } else if (upper === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else if (this.failWith?.stage === 'unknown') {
          return fail('UNKNOWN', this.failWith.code);
        } else {
          socket.write('250 Ok\r\n');
        }
      }
    });

    socket.on('error', () => undefined);
  }
}

describe('sendSmtpEmail (against an in-process mock SMTP server)', () => {
  let server: MockSmtpServer;
  let port = 0;

  beforeEach(async () => {
    server = new MockSmtpServer();
    port = await server.start();
  });

  afterEach(async () => {
    await server.close();
  });

  it('sends a message with AUTH PLAIN and returns the server message id', async () => {
    const messageId = await sendSmtpEmail(
      { host: '127.0.0.1', port, secure: false, starttls: false, from: 'noreply@college.local', username: 'u', password: 'p', timeoutMs: 5000 },
      'student@example.com',
      'Fee reminder',
      'Hi!',
    );
    expect(messageId).toBe('<mock-message-1@mock.local>');
    expect(server.received).toHaveLength(1);
    const message = server.received[0]!;
    expect(message.authed).toBe(true);
    expect(message.from).toBe('<noreply@college.local>');
    expect(message.to).toBe('<student@example.com>');
    expect(message.data).toContain('Subject: Fee reminder');
    expect(message.data).toContain('Hi!');
  });

  it('works without credentials when the server does not require auth', async () => {
    await sendSmtpEmail(
      { host: '127.0.0.1', port, secure: false, starttls: false, from: 'a@b.local', timeoutMs: 5000 },
      'x@example.com',
      'No auth',
      'body',
    );
    expect(server.received).toHaveLength(1);
    expect(server.received[0]!.authed).toBe(false);
  });

  it('strips line breaks from the subject', async () => {
    await sendSmtpEmail(
      { host: '127.0.0.1', port, secure: false, starttls: false, from: 'a@b.local', timeoutMs: 5000 },
      'x@example.com',
      'subject\r\nBcc: evil@example.com',
      'body',
    );
    expect(server.received[0]!.data).toContain('Subject: subject Bcc: evil@example.com');
  });

  it('classifies a permanent server rejection as terminal (retryable = false)', async () => {
    server.failAt('rcpt', 550);
    await expect(
      sendSmtpEmail(
        { host: '127.0.0.1', port, secure: false, starttls: false, from: 'a@b.local', timeoutMs: 5000 },
        'missing@example.com',
        's',
        'b',
      ),
    ).rejects.toMatchObject({ name: 'SmtpError', retryable: false });
  });

  it('classifies a transient server rejection as retryable', async () => {
    server.failAt('mail', 451);
    await expect(
      sendSmtpEmail(
        { host: '127.0.0.1', port, secure: false, starttls: false, from: 'a@b.local', timeoutMs: 5000 },
        'x@example.com',
        's',
        'b',
      ),
    ).rejects.toMatchObject({ name: 'SmtpError', retryable: true });
  });

  it('classifies a connection refusal as retryable', async () => {
    await expect(
      sendSmtpEmail(
        { host: '127.0.0.1', port: 1, secure: false, starttls: false, from: 'a@b.local', timeoutMs: 3000 },
        'x@example.com',
        's',
        'b',
      ),
    ).rejects.toMatchObject({ name: 'SmtpError', retryable: true });
  });
});

describe('SmtpError', () => {
  it('carries the retryable classification', () => {
    const err = new SmtpError('boom', true);
    expect(err.retryable).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});