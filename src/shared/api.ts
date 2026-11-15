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
  UpdateStatus,
  EditOpened,
  EditStatus,
  TransferProgress,
  TreeTransferResult,
} from './types';

export interface TermApi {
  /** Automatic updates: the current state, a check started by the user, and restarting into a downloaded update. */
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
  /** Copies text to the system clipboard. */
  writeClipboard(text: string): Promise<void>;
  /** The text on the system clipboard ("" if there is none). */
  readClipboard(): Promise<string>;
  /** The version of this NexTerm, for example "0.6.0". */
  getVersion(): Promise<string>;
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
  /** Changes to remote files that are open in a local program. */
  onEditStatus(cb: (status: EditStatus) => void): () => void;
  /** Answers a "changed on the server" warning: overwrite the server copy with the local one, or leave it. */
  editResolve(editId: number, overwrite: boolean): Promise<void>;
  /** Lets the user choose the program used by "Edit"; resolves with its path, or null if cancelled. */
  chooseEditor(): Promise<string | null>;
  /** Goes back to the system's plain text editor. */
  clearEditor(): Promise<void>;
  /** Progress of uploads and downloads, pushed while they run. */
  onTransfer(cb: (progress: TransferProgress) => void): () => void;

  sftp: {
    /**
     * Downloads a file to a private temporary folder and opens it in a local program. Saved changes are uploaded
     * back automatically. 'edit' = the configured editor, 'default' = the system's program for the file type
     * (refused for types that would run), 'choose' = ask which program to use. Resolves with null if cancelled.
     */
    edit(connId: string, remotePath: string, mode: 'edit' | 'default' | 'choose'): Promise<EditOpened | null>;
    /**
     * Uploads the files and folders that were copied in the system's file manager (for example Windows Explorer).
     * Resolves with null if the system clipboard holds no files.
     */
    pasteFiles(connId: string, remoteDir: string): Promise<TreeTransferResult | null>;
    /** Copies or moves files and folders, within one server or from one connection to another. Never overwrites. */
    copy(fromConnId: string, remotePaths: string[], toConnId: string, remoteDir: string, move: boolean): Promise<TreeTransferResult>;
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
