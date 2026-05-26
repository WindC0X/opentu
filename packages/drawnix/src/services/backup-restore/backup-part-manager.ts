/**
 * Backup Part Manager
 * 主应用基于共享分片核心做轻量适配。
 */

import { BACKUP_SIGNATURE, BACKUP_VERSION, type BackupManifest, type ExportResult } from './types';

export const PART_SIZE_THRESHOLD = 500 * 1024 * 1024;

interface QueuedZipFile {
  path: string;
  content: unknown;
  options?: unknown;
}

interface ZipFolderLike {
  file(path: string, content: unknown, options?: unknown): ZipFolderLike;
}

interface ZipLike {
  file(path: string, content: unknown, options?: unknown): ZipLike;
  folder(path: string): ZipFolderLike;
  generateAsync(options: unknown): Promise<Blob>;
}

interface BackupPartManagerOptions {
  source: string;
  revokeDelayMs: number;
  interPartPauseMs: number;
  finalPartPauseMs: number;
  preserveAssetEntryDate: boolean;
  downloadBlob: (blob: Blob, filename: string, revokeDelayMs: number) => Promise<void>;
  ZipCtor: new () => ZipLike;
}

class LazyJSZipFolder {
  constructor(
    private readonly zip: LazyJSZip,
    private readonly folderPath: string
  ) {}

  file(path: string, content: unknown, options?: unknown): this {
    this.zip.addFile(`${this.folderPath}/${path}`, content, options);
    return this;
  }
}

class LazyJSZip implements ZipLike {
  private zip: unknown;
  private queuedFiles: Array<QueuedZipFile | undefined> = [];

  addFile(path: string, content: unknown, options?: unknown): void {
    if (this.zip) {
      (this.zip as any).file(path, content, options);
      return;
    }
    this.queuedFiles.push({ path, content, options });
  }

  file(path: string, content: unknown, options?: unknown): this {
    this.addFile(path, content, options);
    return this;
  }

  folder(path: string): LazyJSZipFolder {
    return new LazyJSZipFolder(this, path);
  }

  async generateAsync(options: unknown): Promise<Blob> {
    const zip = await this.materialize();
    return (zip as any).generateAsync(options);
  }

  private async materialize(): Promise<unknown> {
    if (this.zip) {
      return this.zip;
    }

    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (let i = 0; i < this.queuedFiles.length; i++) {
      const queuedFile = this.queuedFiles[i];
      if (!queuedFile) {
        continue;
      }
      zip.file(queuedFile.path, queuedFile.content as any, queuedFile.options as any);
      this.queuedFiles[i] = undefined;
    }
    this.queuedFiles = [];
    this.zip = zip;
    return zip;
  }
}

async function defaultDownloadBlob(
  blob: Blob,
  filename: string,
  revokeDelayMs = 0
): Promise<void> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (revokeDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, revokeDelayMs));
  }
  URL.revokeObjectURL(url);
}

function normalizeEntryDate(timestamp?: number): Date {
  if (!timestamp || Number.isNaN(timestamp) || timestamp <= 0) {
    return new Date();
  }
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

class SharedBackupPartManager {
  private readonly options: BackupPartManagerOptions;
  private partIndex = 1;
  private currentZip: ZipLike;
  private currentSize = 0;
  private downloadedParts: Array<{ filename: string; size: number }> = [];
  private readonly part1Zip: ZipLike;

  constructor(
    private readonly baseFilename: string,
    private readonly backupId: string,
    options: Partial<BackupPartManagerOptions> = {}
  ) {
    if (!options.ZipCtor) {
      throw new Error('SharedBackupPartManager requires ZipCtor');
    }
    this.options = {
      source: 'app',
      revokeDelayMs: 0,
      interPartPauseMs: 500,
      finalPartPauseMs: 500,
      preserveAssetEntryDate: false,
      downloadBlob: defaultDownloadBlob,
      ...options,
      ZipCtor: options.ZipCtor,
    };
    this.currentZip = new this.options.ZipCtor();
    this.part1Zip = this.currentZip;
  }

  addFile(path: string, content: unknown): void {
    const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    this.currentZip.file(path, data);
    this.currentSize += new Blob([data]).size;
  }

  async addAssetBlob(
    path: string,
    blob: Blob,
    metaPath: string,
    metaContent: unknown,
    createdAt?: number
  ): Promise<void> {
    const metaStr =
      typeof metaContent === 'string' ? metaContent : JSON.stringify(metaContent, null, 2);
    const newSize = blob.size + new Blob([metaStr]).size;
    const fileOptions =
      this.options.preserveAssetEntryDate && createdAt
        ? { date: normalizeEntryDate(createdAt) }
        : undefined;

    if (this.currentSize + newSize > PART_SIZE_THRESHOLD && this.currentSize > 0) {
      await this.finalizePart();
      this.startNewPart();
    }

    const assetsFolder = this.currentZip.folder('assets');
    assetsFolder.file(metaPath, metaStr, fileOptions);
    assetsFolder.file(path, blob, fileOptions);
    this.currentSize += newSize;
  }

  async finalizePart(): Promise<void> {
    const partManifest = {
      signature: BACKUP_SIGNATURE,
      version: BACKUP_VERSION,
      createdAt: Date.now(),
      source: this.options.source,
      backupId: this.backupId,
      partIndex: this.partIndex,
      totalParts: null,
      isFinalPart: false,
      schemaVersion: BACKUP_VERSION,
      backupMode: 'incremental',
      includes: {
        prompts: false,
        projects: false,
        assets: true,
        tasks: false,
        knowledgeBase: false,
        environment: false,
      },
    };

    const zipToUse = this.partIndex === 1 ? this.part1Zip : this.currentZip;
    zipToUse.file('manifest.json', JSON.stringify(partManifest, null, 2));

    if (this.partIndex === 1) return;

    const blob = await this.currentZip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const filename = `${this.baseFilename}_part${this.partIndex}.zip`;
    if (this.downloadedParts.length > 0 && this.options.interPartPauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.interPartPauseMs));
    }
    await this.options.downloadBlob(blob, filename, this.options.revokeDelayMs);
    this.downloadedParts.push({ filename, size: blob.size });
  }

  startNewPart(): void {
    this.partIndex += 1;
    this.currentZip = new this.options.ZipCtor();
    this.currentSize = 0;
  }

  async finalizeAll(manifest: BackupManifest): Promise<ExportResult> {
    const isMultiPart = this.partIndex > 1;

    if (!isMultiPart) {
      const finalManifest = {
        ...manifest,
        backupId: this.backupId,
        partIndex: 1,
        totalParts: 1,
        isFinalPart: true,
      };
      this.part1Zip.file('manifest.json', JSON.stringify(finalManifest, null, 2));

      const blob = await this.part1Zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      const filename = `${this.baseFilename}.zip`;
      await this.options.downloadBlob(blob, filename, this.options.revokeDelayMs);
      return { files: [{ filename, size: blob.size }], totalParts: 1, stats: manifest.stats };
    }

    const part1Manifest = {
      ...manifest,
      backupId: this.backupId,
      partIndex: 1,
      totalParts: null,
      isFinalPart: false,
    };
    this.part1Zip.file('manifest.json', JSON.stringify(part1Manifest, null, 2));
    const part1Blob = await this.part1Zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const part1Filename = `${this.baseFilename}_part1.zip`;
    await this.options.downloadBlob(part1Blob, part1Filename, this.options.revokeDelayMs);
    this.downloadedParts.unshift({ filename: part1Filename, size: part1Blob.size });

    if (this.currentSize > 0) {
      const finalManifest = {
        ...manifest,
        backupId: this.backupId,
        partIndex: this.partIndex,
        totalParts: this.partIndex,
        isFinalPart: true,
      };
      this.currentZip.file('manifest.json', JSON.stringify(finalManifest, null, 2));
      const blob = await this.currentZip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      const filename = `${this.baseFilename}_part${this.partIndex}.zip`;
      if (this.options.finalPartPauseMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.options.finalPartPauseMs));
      }
      await this.options.downloadBlob(blob, filename, this.options.revokeDelayMs);
      this.downloadedParts.push({ filename, size: blob.size });
    }

    return { files: this.downloadedParts, totalParts: this.partIndex, stats: manifest.stats };
  }
}

export class BackupPartManager extends SharedBackupPartManager {
  constructor(baseFilename: string, backupId: string) {
    super(baseFilename, backupId, {
      source: 'app',
      revokeDelayMs: 1200,
      interPartPauseMs: 500,
      finalPartPauseMs: 700,
      preserveAssetEntryDate: true,
      ZipCtor: LazyJSZip,
    });
  }

  override finalizeAll(manifest: BackupManifest): Promise<ExportResult> {
    return super.finalizeAll(manifest) as Promise<ExportResult>;
  }
}
