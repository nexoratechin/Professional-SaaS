import { Logger } from '@nestjs/common';
import { WorkerStorageService } from '../../../common/storage/worker-storage.service';
import type { ScanResult, ScanTarget, VirusScanner } from './scanner.interface';

/** The de-facto antivirus test signature (EICAR) plus our own explicit marker for simulating a
 *  hit in dev. Case-insensitive match on the first 4 KiB of the payload. */
const EICAR_SIGNATURE = 'eicar-standard-antivirus-test-file';
const SIMULATED_INFECTION_MARKER = 'x-simulated-infection';

/**
 * Dev-only scanner: streams the first chunk of the object and reports CLEAN unless the payload
 * contains the EICAR test signature (or the explicit x-simulated-infection marker). This lets the
 * whole scan pipeline (enqueue → processor → status flip → audit) run without a real AV engine;
 * production should set VIRUS_SCAN_PROVIDER=clamav|http. The object must exist when the
 * processor runs (upload was already confirmed by then), but a vanished object is reported clean
 * rather than erroring — non-object bytes simply scan as "nothing to worry about".
 */
export class MockScanner implements VirusScanner {
  private readonly logger = new Logger(MockScanner.name);

  constructor(private readonly storage: WorkerStorageService) {}

  async scan(tenantId: string, target: ScanTarget): Promise<ScanResult> {
    let payload = '';
    try {
      const stream = await this.storage.streamObject(tenantId, target.storageKey);
      for await (const chunk of stream) {
        payload += Buffer.from(chunk).toString('latin1');
        if (payload.length >= 4096) break;
      }
    } catch (err) {
      this.logger.warn(`Mock scan could not read ${target.storageKey}: ${String(err)} — treating as clean.`);
      return { clean: true, engine: 'mock' };
    }

    const haystack = payload.toLowerCase();
    if (haystack.includes(SIMULATED_INFECTION_MARKER)) {
      return { clean: false, threatName: 'Simulated-Infection-Marker', engine: 'mock' };
    }
    if (haystack.includes(EICAR_SIGNATURE)) {
      return { clean: false, threatName: 'Eicar-Test-Signature', engine: 'mock' };
    }
    return { clean: true, engine: 'mock' };
  }
}