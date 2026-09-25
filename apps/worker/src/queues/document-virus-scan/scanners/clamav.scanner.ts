import { Logger } from '@nestjs/common';
import { createConnection, type Socket } from 'net';
import { WorkerStorageService } from '../../../common/storage/worker-storage.service';
import type { ScanResult, ScanTarget, VirusScanner } from './scanner.interface';

const INSTREAM_TIMEOUT_MS = 30_000;

/** ClamAV `clamd` integration over the INSTREAM protocol (plain TCP, no unix socket / daemonize
 *  dependency). Sends `zINSTREAM\0`, then the file in one sized chunk, then a zero-length
 *  terminator, and reads clamd's single-line verdict:
 *    stream: OK                       → clean
 *    stream: Eicar-Test-Signature FOUND → infected
 *  Anything else (timeout, socket error, unexpected reply) throws so the processor marks the
 *  version ERROR and BullMQ retries with backoff. */
export class ClamavScanner implements VirusScanner {
  private readonly logger = new Logger(ClamavScanner.name);

  constructor(
    private readonly storage: WorkerStorageService,
    private readonly host: string,
    private readonly port: number,
  ) {}

  async scan(tenantId: string, target: ScanTarget): Promise<ScanResult> {
    const chunks: Buffer[] = [];
    const stream = await this.storage.streamObject(tenantId, target.storageKey);
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const payload = Buffer.concat(chunks);

    const reply = await this.instreamScan(payload);
    const line = reply.trim();

    if (/stream:\s*ok$/i.test(line)) {
      return { clean: true, engine: 'clamav' };
    }
    const found = line.match(/stream:\s*(.+?)\s+found$/i);
    if (found) {
      return { clean: false, threatName: found[1], engine: 'clamav' };
    }
    throw new Error(`ClamAV returned an unexpected reply for ${target.storageKey}: ${line || '(empty)'}`);
  }

  /** Runs a single clamd INSTREAM exchange to completion and resolves on connection end. */
  private instreamScan(payload: Buffer): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const socket: Socket = createConnection({ host: this.host, port: this.port });
      const received: Buffer[] = [];
      let settled = false;

      const finish = (err: Error | null, result?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (err) reject(err);
        else resolve(result as string);
      };

      const timer = setTimeout(() => {
        finish(new Error(`ClamAV ${this.host}:${this.port} timed out after ${INSTREAM_TIMEOUT_MS}ms.`));
      }, INSTREAM_TIMEOUT_MS);

      socket.setTimeout(INSTREAM_TIMEOUT_MS);

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        if (payload.length > 0) {
          const header = Buffer.alloc(4);
          header.writeUInt32BE(payload.length);
          socket.write(header);
          socket.write(payload);
        }
        // Zero-length chunk terminates the INSTREAM transfer.
        socket.write(Buffer.alloc(0));
      });
      socket.on('data', (chunk) => received.push(chunk));
      socket.on('error', (err) => finish(err));
      socket.on('timeout', () => finish(new Error(`ClamAV ${this.host}:${this.port} connection timed out.`)));
      socket.on('close', () => finish(null, Buffer.concat(received).toString('latin1')));
      socket.on('end', () => finish(null, Buffer.concat(received).toString('latin1')));
    });
  }
}