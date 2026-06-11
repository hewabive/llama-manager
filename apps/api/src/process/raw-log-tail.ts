import { watch, type FSWatcher } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

const READ_BUFFER_BYTES = 64 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

type RawLogTailOptions = {
  path: string;
  startOffset: number;
  onLines: (chunk: string) => void;
  pollIntervalMs?: number;
};

export class RawLogTail {
  private offset: number;
  private remainder = "";
  private readonly decoder = new StringDecoder("utf8");
  private watcher: FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private handle: FileHandle | null = null;
  private reading = false;
  private pendingRead = false;
  private current: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: RawLogTailOptions) {
    this.offset = options.startOffset;
  }

  start() {
    try {
      this.watcher = watch(this.options.path, () => this.schedule());
    } catch {
      this.watcher = null;
    }
    this.pollTimer = setInterval(
      () => this.schedule(),
      this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );
    this.pollTimer.unref();
    this.schedule();
  }

  async stop() {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.watcher?.close();
    this.watcher = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await this.current;
    await this.readPending();
    this.remainder += this.decoder.end();
    if (this.remainder) {
      this.options.onLines(this.remainder);
      this.remainder = "";
    }
    await this.handle?.close().catch(() => undefined);
    this.handle = null;
  }

  private schedule() {
    if (this.stopped) {
      return;
    }
    if (this.reading) {
      this.pendingRead = true;
      return;
    }
    this.current = this.run();
  }

  private async run() {
    this.reading = true;
    try {
      do {
        this.pendingRead = false;
        await this.readPending();
      } while (this.pendingRead && !this.stopped);
    } finally {
      this.reading = false;
    }
  }

  private async readPending() {
    if (!this.handle) {
      try {
        this.handle = await open(this.options.path, "r");
      } catch {
        return;
      }
    }
    const buffer = Buffer.alloc(READ_BUFFER_BYTES);
    for (;;) {
      let bytesRead = 0;
      try {
        const result = await this.handle.read(
          buffer,
          0,
          buffer.length,
          this.offset,
        );
        bytesRead = result.bytesRead;
      } catch {
        return;
      }
      if (bytesRead <= 0) {
        return;
      }
      this.offset += bytesRead;
      this.emitCompleteLines(this.decoder.write(buffer.subarray(0, bytesRead)));
    }
  }

  private emitCompleteLines(text: string) {
    if (!text) {
      return;
    }
    this.remainder += text;
    const lastNewline = this.remainder.lastIndexOf("\n");
    if (lastNewline === -1) {
      return;
    }
    const chunk = this.remainder.slice(0, lastNewline + 1);
    this.remainder = this.remainder.slice(lastNewline + 1);
    this.options.onLines(chunk);
  }
}
