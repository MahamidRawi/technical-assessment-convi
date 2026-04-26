type LogMethod = (...args: unknown[]) => void;

function write(method: LogMethod, args: unknown[]): void {
  method(...args);
}

function prefixArgs(prefix: string | undefined, args: unknown[]): unknown[] {
  if (!prefix) return args;
  return [`[${prefix}]`, ...args];
}

export interface Logger {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export function createLogger(prefix?: string): Logger {
  return {
    log: (...args: unknown[]): void => write(console.log, prefixArgs(prefix, args)),
    info: (...args: unknown[]): void => write(console.info, prefixArgs(prefix, args)),
    warn: (...args: unknown[]): void => write(console.warn, prefixArgs(prefix, args)),
    error: (...args: unknown[]): void => write(console.error, prefixArgs(prefix, args)),
    debug: (...args: unknown[]): void => write(console.debug, prefixArgs(prefix, args)),
  };
}

export const logger = createLogger();
