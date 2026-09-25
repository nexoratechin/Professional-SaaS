import { AppConfigService } from '../../../config/app-config.service';
import { WorkerStorageService } from '../../../common/storage/worker-storage.service';
import { ClamavScanner } from './clamav.scanner';
import { HttpScanner } from './http.scanner';
import { MockScanner } from './mock.scanner';
import type { VirusScanner } from './scanner.interface';

/** Builds the scanner selected by VIRUS_SCAN_PROVIDER. The processor constructs this once at
 *  boot (env is never re-read per job, so a misconfiguration fails fast at startup). */
export function createVirusScanner(config: AppConfigService, storage: WorkerStorageService): VirusScanner {
  switch (config.get('VIRUS_SCAN_PROVIDER')) {
    case 'clamav':
      return new ClamavScanner(storage, config.get('CLAMAV_HOST'), config.get('CLAMAV_PORT'));
    case 'http': {
      const apiUrl = config.get('VIRUS_SCAN_API_URL');
      if (!apiUrl) {
        throw new Error('VIRUS_SCAN_PROVIDER=http requires VIRUS_SCAN_API_URL.');
      }
      return new HttpScanner(storage, apiUrl, config.get('VIRUS_SCAN_API_KEY'));
    }
    case 'mock':
    default:
      return new MockScanner(storage);
  }
}