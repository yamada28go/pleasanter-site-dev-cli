export type LogLevelName = "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVEL_PRIORITY: Record<LogLevelName, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

export interface Logger {
  debug: (message: string, fields?: Record<string, unknown>) => void;
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
  child: (context: string) => Logger;
}

export interface LoggerOptions {
  level?: LogLevelName;
  context?: string;
  now?: () => Date;
  stderr?: NodeJS.WritableStream;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const context = options.context;
  const now = options.now ?? (() => new Date());
  const stderr = options.stderr ?? process.stderr;

  const log = (
    entryLevel: Exclude<LogLevelName, "silent">,
    message: string,
    fields?: Record<string, unknown>,
  ): void => {
    if (LOG_LEVEL_PRIORITY[entryLevel] < LOG_LEVEL_PRIORITY[level]) {
      return;
    }

    const timestamp = now().toISOString();
    const prefix = `${timestamp} ${entryLevel.toUpperCase()}${context ? ` [${context}]` : ""}`;
    const suffix = formatFields(fields);
    stderr.write(`${prefix} ${message}${suffix}\n`);
  };

  return {
    debug(message, fields) {
      log("debug", message, fields);
    },
    info(message, fields) {
      log("info", message, fields);
    },
    warn(message, fields) {
      log("warn", message, fields);
    },
    error(message, fields) {
      log("error", message, fields);
    },
    child(childContext) {
      // Preserve log settings while narrowing the context for nested operations.
      const nextContext = context ? `${context}:${childContext}` : childContext;
      return createLogger({
        level,
        context: nextContext,
        now,
        stderr,
      });
    },
  };
}

export function resolveLogLevel(
  rawValue: string | undefined,
): LogLevelName | undefined {
  if (!rawValue) {
    return undefined;
  }

  const normalized = rawValue.toLowerCase();
  if (isLogLevelName(normalized)) {
    return normalized;
  }

  throw new Error(
    `Invalid log level: ${rawValue}. Expected debug, info, warn, error, or silent.`,
  );
}

function isLogLevelName(value: string): value is LogLevelName {
  return (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error" ||
    value === "silent"
  );
}

function formatFields(fields: Record<string, unknown> | undefined): string {
  if (!fields) {
    return "";
  }

  const entries = Object.entries(fields).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) {
    return "";
  }

  return ` ${entries
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ")}`;
}

function formatValue(value: unknown): string {
  // Errors are expanded explicitly so the message and stack are visible in one line.
  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: value.message,
      stack: value.stack,
    });
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return JSON.stringify(value);
}
