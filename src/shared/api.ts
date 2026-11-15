import type {
  ImportPreview,
  ImportResult,
  ImportSourceId,
  ImportSourceInfo,
  ImportedSession,
  OpenRequest,
  ServerStats,
  OpenResult,
  SerialPortInfo,
  SessionInput,
  SessionSummary,
  SftpEntry,
  SftpStat,
  SftpTreeSize,
  Settings,
  TransferProgress,
  TreeTransferResult,
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

  /** Looks for MobaXterm, PuTTY and OpenSSH connections on this computer (no secrets are read). */
  importDetect(): Promise<ImportSourceInfo[]>;
  /** Lets the user choose a file for a source; resolves with its path or null. */
  importPick(source: ImportSourceId): Promise<string | null>;
  importPreview(source: ImportSourceId, path: string): Promise<ImportPreview>;
  importCommit(items: ImportedSession[], skipDuplicates: boolean): Promise<ImportResult>;
  pickKeyFile(): Promise<string | null>;

  open(req: OpenRequest): Promise<OpenResult>;
  write(connId: string, data: string): void;
  resize(connId: string, cols: number, rows: number): void;
  close(connId: string): void;
  onData(cb: (connId: string, data: Uint8Array) => void): () => void;
  onClosed(cb: (connId: string, reason?: string) => void): () => void;

  /** Live server statistics for an SSH connection. */
  monitorStart(connId: string): Promise<void>;
  monitorStop(connId: string): Promise<void>;
  /** While on, samples also include the busiest processes (used by the details panel). */
  monitorDetail(connId: string, on: boolean): Promise<void>;
  /** Takes a sample immediately instead of waiting for the next tick. */
  monitorRefresh(connId: string): Promise<void>;
  onMonitor(cb: (connId: string, stats: ServerStats | null) => void): () => void;
  /** Progress of uploads and downloads, pushed while they run. */
  onTransfer(cb: (progress: TransferProgress) => void): () => void;

  sftp: {
    realpath(connId: string, path: string): Promise<string>;
    list(connId: string, path: string): Promise<SftpEntry[]>;
    download(connId: string, remotePath: string): Promise<string | null>;
    downloadMany(connId: string, remotePaths: string[]): Promise<{ saved: number; skipped: number; dir: string | null }>;
    upload(connId: string, remoteDir: string): Promise<number>;
    uploadPaths(connId: string, remoteDir: string, localPaths: string[]): Promise<TreeTransferResult>;
    mkdir(connId: string, path: string): Promise<void>;
    /** Creates an empty file; fails if it already exists. */
    mkfile(connId: string, path: string): Promise<void>;
    stat(connId: string, path: string): Promise<SftpStat>;
    chmod(connId: string, path: string, mode: number): Promise<void>;
    /** Total size of a folder, counted on the server by walking it (bounded). */
    treeSize(connId: string, path: string): Promise<SftpTreeSize>;
    /** Downloads a folder with everything in it; asks for the destination. */
    downloadTree(connId: string, remotePath: string): Promise<TreeTransferResult>;
    /** Asks for a local folder and uploads it, with everything in it, into emoteDir. */
    uploadFolder(connId: string, remoteDir: string): Promise<TreeTransferResult>;
    /** Deletes a folder and everything in it. */
    removeTree(connId: string, path: string): Promise<TreeTransferResult>;
    rename(connId: string, from: string, to: string): Promise<void>;
    remove(connId: string, path: string, isDir: boolean): Promise<void>;
  };
}
