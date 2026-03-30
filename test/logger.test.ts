import assert from "node:assert/strict";
import test from "node:test";

import { createLogger, resolveLogLevel } from "../src/logger.js";

test("createLogger writes structured log lines at or above the configured level", () => {
  const output: string[] = [];
  const logger = createLogger({
    level: "info",
    context: "cli",
    now: () => new Date("2026-03-30T14:00:00.000Z"),
    stderr: {
      write(chunk: string): boolean {
        output.push(chunk);
        return true;
      },
    } as NodeJS.WritableStream,
  });

  logger.debug("hidden");
  logger.info("visible", { siteId: 123, mode: "backup" });

  assert.deepEqual(output, [
    '2026-03-30T14:00:00.000Z INFO [cli] visible siteId=123 mode="backup"\n',
  ]);
});

test("resolveLogLevel validates supported values", () => {
  assert.equal(resolveLogLevel("DEBUG"), "debug");
  assert.equal(resolveLogLevel(undefined), undefined);
  assert.throws(() => resolveLogLevel("trace"), /Invalid log level: trace/);
});

test("createLogger serializes Error fields with name, message, and stack", () => {
  const output: string[] = [];
  const logger = createLogger({
    level: "error",
    context: "cli",
    now: () => new Date("2026-03-30T14:00:00.000Z"),
    stderr: {
      write(chunk: string): boolean {
        output.push(chunk);
        return true;
      },
    } as NodeJS.WritableStream,
  });
  const error = new Error("boom");
  error.name = "TestError";
  error.stack = "TestError: boom\n    at test";

  logger.error("Command failed", { error });

  assert.deepEqual(output, [
    '2026-03-30T14:00:00.000Z ERROR [cli] Command failed error={"name":"TestError","message":"boom","stack":"TestError: boom\\n    at test"}\n',
  ]);
});
