/**
 * Minimal dependency-free ESMTP client used by the notifications email provider. Implemented on
 * Node's net/tls stdlib so the email channel works without a third-party SDK: HELO/EHLO, optional
 * STARTTLS upgrade, AUTH PLAIN, MAIL FROM / RCPT TO / DATA, QUIT.
 *
 * Error classification is what makes provider failure handling possible: 4xx = temporary
 * (retryable later), 5xx = permanent (fix config/address; retrying is pointless), network
 * timeouts/refusals = retryable.
 */
import { connect as tcpConnect, type Socket } from 'net';
import { connect as tlsConnect, type TLSSocket } from 'tls';
import { hostname } from 'os';

export interface SmtpConnectionConfig {
  host: string;
  port: number;
  /** Implicit TLS on connect (SMTPS, typically port 465). */
  secure: boolean;
  /** Upgrade a plain connection via STARTTLS (typically port 587). */
  starttls: boolean;
  /** Optional AUTH credentials. */
  username?: string;
  password?: string;
  /** Envelope sender. */
  from: string;
  /** Milliseconds before a step times out. */
  timeoutMs?: number;
}

export class SmtpError extends Error {
  constructor(
    message: string,
    /** true = transient failure (server/network), false = permanent (config or address). */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SmtpError';
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

function readLines(socket: Socket, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (buffer.includes('\n')) {
        cleanup();
        resolve(buffer.split('\n').map((line) => line.trim()).filter(Boolean));
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(new SmtpError(`SMTP socket error: ${err.message}`, true));
    };
    const onTimeout = () => {
      cleanup();
      reject(new SmtpError('SMTP socket timed out awaiting a response.', true));
    };
    const onClose = () => {
      cleanup();
      reject(new SmtpError('SMTP connection closed unexpectedly.', true));
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
      socket.off('close', onClose);
    };
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('timeout', onTimeout);
    socket.on('close', onClose);
    socket.setTimeout(timeoutMs);
  });
}

/** The first response line (e.g. "250 OK"). Multiline responses share the same code; the last
 * line is the conclusive one, so keep scanning until a line that does not start with `code-`.
 * Text is accumulated across every line so multiline EHLO capability lists survive parsing. */
function parseResponse(lines: string[]): { code: number; message: string } {
  let code = 0;
  const parts: string[] = [];
  let expectingContinuation = false;
  for (const line of lines) {
    const match = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!match) continue;
    const lineCode = Number(match[1]);
    const separator = match[2];
    if (lineCode !== code) {
      code = lineCode;
      parts.length = 0;
    }
    parts.push(match[3] ?? '');
    expectingContinuation = separator === '-';
    if (!expectingContinuation) break;
  }
  return { code, message: parts.join(' ') };
}

const isTransientCode = (code: number): boolean => code >= 400 && code < 500;

async function command(socket: Socket, step: string, payload: string, timeoutMs: number): Promise<{ code: number; message: string }> {
  if (!socket.destroyed) {
    socket.write(payload);
  }
  const lines = await readLines(socket, timeoutMs);
  const response = parseResponse(lines);
  if (response.code < 200 || response.code >= 400) {
    throw new SmtpError(`SMTP ${step} failed (${response.code}): ${response.message}`, isTransientCode(response.code));
  }
  return response;
}

/** Sends a plain-text email and resolves to the server-reported Message-ID (when provided). */
export async function sendSmtpEmail(
  config: SmtpConnectionConfig,
  to: string,
  subject: string,
  body: string,
): Promise<string | null> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const helo = hostname() || 'localhost';

  const rawSocket: Socket = config.secure
    ? tlsConnect({ host: config.host, port: config.port, servername: config.host })
    : tcpConnect({ host: config.host, port: config.port });

  let socket: Socket = rawSocket;
  await new Promise<void>((resolve, reject) => {
    const readyEvent = config.secure ? 'secureConnect' : 'connect';
    const onReady = () => {
      rawSocket.off('error', onError);
      resolve();
    };
    const onError = (err: Error) => {
      rawSocket.off(readyEvent, onReady);
      reject(new SmtpError(`SMTP connect failed: ${err.message}`, true));
    };
    rawSocket.once(readyEvent, onReady);
    rawSocket.once('error', onError);
  });

  // Make sure the socket dies even if a step below throws (the caller rethrows the SmtpError).
  let upgraded = false;
  try {
    // Greeting
    const greeting = parseResponse(await readLines(rawSocket, timeoutMs));
    if (greeting.code !== 220) {
      throw new SmtpError(`SMTP greeting failed (${greeting.code}): ${greeting.message}`, isTransientCode(greeting.code));
    }

    // EHLO — the response tells us which extensions (STARTTLS, AUTH) the server supports.
    let ehlo = await command(rawSocket, 'EHLO', `EHLO ${helo}\r\n`, timeoutMs);
    const capabilities = ehlo.message.split(/\s+/);

    if (!config.secure && config.starttls && capabilities.includes('STARTTLS')) {
      await command(rawSocket, 'STARTTLS', 'STARTTLS\r\n', timeoutMs);
      socket = tlsConnect({ socket: rawSocket, servername: config.host });
      upgraded = true;
      await new Promise<void>((resolve, reject) => {
        socket.once('secureConnect', () => resolve());
        socket.once('error', (err) => reject(new SmtpError(`STARTTLS upgrade failed: ${err.message}`, true)));
      });
      ehlo = await command(socket, 'EHLO', `EHLO ${helo}\r\n`, timeoutMs);
    }

    if (config.username && config.password) {
      if (!ehlo.message.split(/\s+/).includes('AUTH')) {
        throw new SmtpError('SMTP server does not advertise AUTH but credentials were configured.', false);
      }
      const plain = Buffer.from(`\u0000${config.username}\u0000${config.password}`, 'utf8').toString('base64');
      await command(socket, 'AUTH PLAIN', `AUTH PLAIN ${plain}\r\n`, timeoutMs);
    }

    await command(socket, 'MAIL FROM', `MAIL FROM:<${config.from}>\r\n`, timeoutMs);
    await command(socket, 'RCPT TO', `RCPT TO:<${to}>\r\n`, timeoutMs);

    const data = await command(socket, 'DATA', 'DATA\r\n', timeoutMs);
    if (data.code !== 354) {
      throw new SmtpError(`SMTP DATA refused (${data.code}): ${data.message}`, isTransientCode(data.code));
    }

    const messageBody =
      `From: ${config.from}\r\n` +
      `To: ${to}\r\n` +
      `Subject: ${sanitizeHeader(subject)}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: 8bit\r\n` +
      `\r\n` +
      `${body}`;

    const dataResponse = await command(socket, 'DATA body', `${messageBody}\r\n.\r\n`, timeoutMs);
    const messageIdMatch = /<[^>]+@[^>]+>/.exec(dataResponse.message);
    const messageId = messageIdMatch ? messageIdMatch[0] : null;

    try {
      await command(socket, 'QUIT', 'QUIT\r\n', timeoutMs);
    } catch {
      // QUIT failure is irrelevant once the message was accepted.
    }
    rawSocket.end();

    return messageId;
  } finally {
    if (!upgraded && !rawSocket.destroyed) {
      rawSocket.end();
    }
  }
}

/** Strip CR/LF so a subject can never smuggle headers into the DATA block. */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}