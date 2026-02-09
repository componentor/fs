/**
 * Global type declarations for experimental browser APIs.
 */

// FileSystemObserver (experimental Chrome API)
interface FileSystemChangeRecord {
  changedHandle: FileSystemHandle | null;
  relativePathComponents: string[];
  relativePathMovedFrom: string[] | null;
  root: FileSystemHandle;
  type: 'appeared' | 'disappeared' | 'modified' | 'moved' | 'errored' | 'unknown';
}

type FileSystemObserverCallback = (
  records: FileSystemChangeRecord[],
  observer: FileSystemObserver
) => void;

declare class FileSystemObserver {
  constructor(callback: FileSystemObserverCallback);
  observe(handle: FileSystemHandle, options?: { recursive?: boolean }): Promise<void>;
  disconnect(): void;
}

// FileSystemSyncAccessHandle (available in workers)
interface FileSystemSyncAccessHandle {
  read(buffer: BufferSource, options?: { at?: number }): number;
  write(buffer: BufferSource, options?: { at?: number }): number;
  truncate(newSize: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

interface FileSystemFileHandle {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
}
