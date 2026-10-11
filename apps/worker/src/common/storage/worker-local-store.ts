import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

/**
 * Worker-side local-filesystem store (STORAGE_DRIVER=local). Shares the `<dir>/<bucket>` layout
 * with the API's LocalObjectStore, resolving relative paths against the workspace root so both
 * processes see the same bytes.
 */
export interface WorkerLocalMetadata {
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
}

export function resolveWorkspaceRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

export class WorkerLocalStore {
  private readonly root: string;

  constructor(storageDir: string, bucket: string) {
    const base = isAbsolute(storageDir) ? storageDir : resolve(resolveWorkspaceRoot(), storageDir);
    this.root = join(base, bucket);
  }

  private pathFor(key: string): string {
    const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
    const full = resolve(this.root, normalized);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error('Invalid storage key.');
    }
    return full;
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async putBuffer(key: string, body: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async putFile(key: string, filePath: string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(createReadStream(filePath), createWriteStream(path));
  }

  async copyToFile(key: string, filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await pipeline(createReadStream(this.pathFor(key)), createWriteStream(filePath));
  }

  readStream(key: string): Readable {
    return createReadStream(this.pathFor(key));
  }

  async getBuffer(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async metadata(key: string): Promise<WorkerLocalMetadata> {
    const info = await stat(this.pathFor(key));
    return { sizeBytes: info.size, contentType: null, etag: null, lastModified: info.mtime };
  }

  async sha256(key: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(this.pathFor(key))) {
      hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
  }

  async remove(key: string): Promise<void> {
    try {
      await rm(this.pathFor(key));
    } catch {
      // Missing objects are a successful delete.
    }
  }

  async list(prefix: string): Promise<Array<{ key: string; sizeBytes: number; lastModified: Date | null }>> {
    const out: Array<{ key: string; sizeBytes: number; lastModified: Date | null }> = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const key = full.slice(this.root.length + 1).replace(/\\/g, '/');
          if (!key.startsWith(prefix)) continue;
          const info = await stat(full);
          out.push({ key, sizeBytes: info.size, lastModified: info.mtime });
        }
      }
    };
    await walk(this.root);
    return out;
  }
}
