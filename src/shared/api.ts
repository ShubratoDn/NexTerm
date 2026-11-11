import type {
  OpenRequest,
  OpenResult,
  SerialPortInfo,
  SessionInput,
  SessionSummary,
  SftpEntry,
  Settings,
} from './types';

export interface TermApi {
  listSessions(): Promise<SessionSummary[]>;
  saveSession(input: SessionInput): Promise<SessionSummary>;
  deleteSession(id: string): Promise<void>;
  duplicateSession(id: string): Promise<SessionSummary>;
  /** 'win32' | 'darwin' | 'linux' */
  platform: string;
  /** Registers a dropped file for one later upload and returns its local path. */
  pathForFile(file: File): string;
  setTitleBar(background: string, foreground: string): void;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  listSerialPorts(): Promise<SerialPortInfo[]>;
  pickKeyFile(): Promise<string | null>;

  open(req: OpenRequest): Promise<OpenResult>;
  write(connId: string, data: string): void;
  resize(connId: string, cols: number, rows: number): void;
  close(connId: string): void;
  onData(cb: (connId: string, data: Uint8Array) => void): () => void;
  onClosed(cb: (connId: string, reason?: string) => void): () => void;

  sftp: {
    realpath(connId: string, path: string): Promise<string>;
    list(connId: string, path: string): Promise<SftpEntry[]>;
    download(connId: string, remotePath: string): Promise<string | null>;
    downloadMany(connId: string, remotePaths: string[]): Promise<{ saved: number; skipped: number; dir: string | null }>;
    upload(connId: string, remoteDir: string): Promise<number>;
    uploadPaths(connId: string, remoteDir: string, localPaths: string[]): Promise<{ uploaded: number; skipped: number }>;
    mkdir(connId: string, path: string): Promise<void>;
    rename(connId: string, from: string, to: string): Promise<void>;
    remove(connId: string, path: string, isDir: boolean): Promise<void>;
  };
}
