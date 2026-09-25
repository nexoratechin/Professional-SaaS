/** Object to scan — everything the scanners need is resolved by the processor, so a scanner
 *  never touches the database directly and stays pure/testable. */
export interface ScanTarget {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ScanResult {
  /** True when the scanner found no infection. */
  clean: boolean;
  /** Detected threat signature when not clean (e.g. "Eicar-Test-Signature"). */
  threatName?: string;
  /** Engine identifier recorded on the DocumentVersion (e.g. "clamav", "mock", "http"). */
  engine: string;
}

/** Pluggable virus-scanner adapter — implementations: mock, clamav (clamd TCP), http (generic
 *  scanning API). Selected in code by env VIRUS_SCAN_PROVIDER, never by untrusted input. */
export interface VirusScanner {
  scan(tenantId: string, target: ScanTarget): Promise<ScanResult>;
}