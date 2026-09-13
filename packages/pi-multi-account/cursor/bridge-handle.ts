/**
 * The handle around one bridge child process.
 *
 * Cursor talks over a long-lived HTTP/2 stream, and the conversation is genuinely
 * bidirectional: while the model streams its answer, Cursor keeps asking us for blobs and we
 * keep answering on the same pipe. So the pipe can be closed from our side — a cancelled turn,
 * a session teardown, a compaction that starts a new conversation — while replies to Cursor's
 * requests are still in flight.
 *
 * A write into a closed pipe does not fail where it is written. Node reports
 * ERR_STREAM_WRITE_AFTER_END on a later tick, as an `error` event on the stream, which walks
 * straight past the try/catch at the call site and, with no listener, becomes an
 * uncaughtException that takes Pi down with it. That is exactly what happened after a
 * compaction closed the bridge and Cursor asked for one more blob.
 *
 * Hence two rules, both enforced here rather than at each of the dozen call sites:
 *   - once ended, the handle is not alive and silently drops writes;
 *   - every stream we own carries an error listener, so nothing the bridge does can ever
 *     surface as an uncaught exception in the host process.
 */

export interface BridgeStreams {
  stdin: {
    write(chunk: Uint8Array): unknown;
    end(): unknown;
    on(event: "error", listener: (error: Error) => void): unknown;
    readonly writableEnded?: boolean;
    readonly destroyed?: boolean;
  } | null;
  stdout: {
    on(event: "data" | "error", listener: (payload: never) => void): unknown;
  } | null;
  on(event: "exit" | "error", listener: (payload: never) => void): unknown;
  kill(signal?: NodeJS.Signals | number): unknown;
}

export interface BridgeHandle {
  proc: { kill(signal?: NodeJS.Signals | number): unknown };
  readonly alive: boolean;
  write(data: Uint8Array): void;
  end(): void;
  onData(cb: (chunk: Buffer) => void): void;
  onClose(cb: (code: number) => void): void;
}

/** Length-prefix a frame the way the bridge process expects it. */
export function lpEncode(data: Uint8Array): Buffer {
  const buf = Buffer.alloc(4 + data.length);
  buf.writeUInt32BE(data.length, 0);
  buf.set(data, 4);
  return buf;
}

export function createBridgeHandle(
  proc: BridgeStreams,
  hooks: { debug?: (event: string, data: Record<string, unknown>) => void } = {},
): BridgeHandle {
  const debug = hooks.debug ?? (() => {});
  const cbs = {
    data: null as ((chunk: Buffer) => void) | null,
    close: null as ((code: number) => void) | null,
  };

  let exited = false;
  let ended = false;
  let exitCode = 1;

  // The safety net. A late write, a broken pipe, a bridge that could not be spawned at all —
  // none of them may reach the host's uncaughtException handler.
  proc.stdin?.on("error", (error: Error) => {
    debug("bridge.stdin_error", { error: String(error) });
  });
  proc.stdout?.on("error", ((error: Error) => {
    debug("bridge.stdout_error", { error: String(error) });
  }) as never);
  proc.on("error", ((error: Error) => {
    debug("bridge.process_error", { error: String(error) });
  }) as never);

  let pending = Buffer.alloc(0);
  proc.stdout?.on("data", ((chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const len = pending.readUInt32BE(0);
      if (pending.length < 4 + len) break;
      const payload = pending.subarray(4, 4 + len);
      pending = pending.subarray(4 + len);
      cbs.data?.(Buffer.from(payload));
    }
  }) as never);

  proc.on("exit", ((code: number | null) => {
    exited = true;
    exitCode = code ?? 1;
    debug("bridge.exit", { exitCode });
    cbs.close?.(exitCode);
  }) as never);

  const writable = (): boolean => {
    if (exited || ended) return false;
    const stdin = proc.stdin;
    if (!stdin) return false;
    return !stdin.writableEnded && !stdin.destroyed;
  };

  return {
    proc,
    // Ended counts as dead: a caller that asks `alive` is deciding whether to keep talking on
    // this pipe, and the answer for a pipe we closed ourselves is no.
    get alive() { return !exited && !ended; },
    write(data: Uint8Array) {
      if (!writable()) {
        debug("bridge.write_after_end", { bytes: data.length, exited, ended });
        return;
      }
      try {
        proc.stdin!.write(lpEncode(data));
      } catch (error) {
        debug("bridge.write_failed", { error: String(error) });
      }
    },
    end() {
      if (ended) return;
      if (writable()) {
        try {
          proc.stdin!.write(lpEncode(new Uint8Array(0)));
          proc.stdin!.end();
        } catch (error) {
          debug("bridge.end_failed", { error: String(error) });
        }
      }
      ended = true;
    },
    onData(cb: (chunk: Buffer) => void) { cbs.data = cb; },
    onClose(cb: (code: number) => void) {
      if (exited) {
        queueMicrotask(() => cb(exitCode));
      } else {
        cbs.close = cb;
      }
    },
  };
}
