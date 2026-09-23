// Tiny namespaced logger. Debug output is dev-only; warnings/errors always print.

type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const DEV = import.meta.env.DEV;

export function createLogger(scope: string): Logger {
  const tag = `[gs:${scope}]`;
  const emit = (level: Level, args: unknown[]): void => {
    if (!DEV && (level === 'debug' || level === 'info')) return;
    console[level](tag, ...args);
  };
  return {
    debug: (...a) => emit('debug', a),
    info: (...a) => emit('info', a),
    warn: (...a) => emit('warn', a),
    error: (...a) => emit('error', a),
  };
}
