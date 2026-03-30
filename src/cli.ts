#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PleasanterClient } from "./api.js";
import { loadUpdateConfig, summarizeConfig } from "./config.js";
import { createLogger, resolveLogLevel, type Logger } from "./logger.js";
import type { BackupDocument, PleasanterSiteData } from "./types.js";

type CommandName = "backup" | "push" | "help";

export interface ParsedArgs {
  _: string[];
  flags: Map<string, string | boolean>;
}

export async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const command = (parsed._[0] ?? "help") as CommandName;
  const logger = createCliLogger(parsed);

  logger.debug("Parsed command line arguments", {
    command,
    flags: Object.fromEntries(parsed.flags),
  });

  switch (command) {
    case "backup":
      await runBackup(parsed, logger.child("backup"));
      return;
    case "push":
      await runPush(parsed, logger.child("push"));
      return;
    case "help":
    default:
      printHelp();
  }
}

async function runBackup(parsed: ParsedArgs, logger: Logger): Promise<void> {
  const options = readCommonOptions(parsed);
  logger.info("Starting backup command", {
    siteId: options.siteId,
    baseUrl: options.baseUrl,
  });
  const client = new PleasanterClient({
    ...options,
    logger: logger.child("api"),
  });
  const site = await client.getSite();
  const backupPath = await writeBackup({
    baseUrl: options.baseUrl,
    siteId: options.siteId,
    site,
    outPath: getStringFlag(parsed, "out"),
    backupDir: getStringFlag(parsed, "backup-dir"),
  });

  logger.info("Backup created", {
    backupPath,
  });
}

async function runPush(parsed: ParsedArgs, logger: Logger): Promise<void> {
  const options = readCommonOptions(parsed);
  const configPath = requireStringFlag(parsed, "config");
  logger.info("Starting push command", {
    siteId: options.siteId,
    baseUrl: options.baseUrl,
    configPath: path.resolve(configPath),
  });
  const updateConfig = await loadUpdateConfig(
    configPath,
    logger.child("config"),
  );
  logger.info("Loaded update config", {
    configPath: path.resolve(configPath),
    summary: summarizeConfig(updateConfig),
  });

  if (getBooleanFlag(parsed, "dry-run")) {
    logger.info("Skipping API update for dry run");
    process.stdout.write(`${JSON.stringify(updateConfig, null, 2)}\n`);
    return;
  }

  const client = new PleasanterClient({
    ...options,
    logger: logger.child("api"),
  });
  const site = await client.getSite();
  const skipBackup = getBooleanFlag(parsed, "skip-backup");
  let backupPath: string | undefined;
  if (!skipBackup) {
    logger.info("Creating backup before update", {
      siteId: options.siteId,
    });
    backupPath = await writeBackup({
      baseUrl: options.baseUrl,
      siteId: options.siteId,
      site,
      outPath: undefined,
      backupDir: getStringFlag(parsed, "backup-dir"),
    });
  } else {
    logger.warn("Skipping backup before update", {
      siteId: options.siteId,
    });
  }

  const response = await client.updateSiteSettings(updateConfig);
  if (backupPath) {
    logger.info("Backup created", {
      backupPath,
    });
  }
  logger.info("Update completed", {
    statusCode: response.StatusCode ?? 200,
    message: response.Message ?? "",
  });
}

export function readCommonOptions(parsed: ParsedArgs) {
  const baseUrl =
    getStringFlag(parsed, "base-url") ?? process.env.PLEASANTER_BASE_URL;
  const apiKey =
    getStringFlag(parsed, "api-key") ?? process.env.PLEASANTER_API_KEY;
  const siteIdRaw =
    getStringFlag(parsed, "site-id") ?? process.env.PLEASANTER_SITE_ID;
  const apiVersionRaw =
    getStringFlag(parsed, "api-version") ?? process.env.PLEASANTER_API_VERSION;

  if (!baseUrl) {
    throw new Error("--base-url or PLEASANTER_BASE_URL is required.");
  }
  if (!apiKey) {
    throw new Error("--api-key or PLEASANTER_API_KEY is required.");
  }
  if (!siteIdRaw) {
    throw new Error("--site-id or PLEASANTER_SITE_ID is required.");
  }

  const siteId = Number(siteIdRaw);
  if (!Number.isInteger(siteId) || siteId <= 0) {
    throw new Error(`Invalid site id: ${siteIdRaw}`);
  }

  const apiVersion = apiVersionRaw ? Number(apiVersionRaw) : 1.1;
  if (!Number.isFinite(apiVersion)) {
    throw new Error(`Invalid api version: ${apiVersionRaw}`);
  }

  return {
    baseUrl,
    apiKey,
    siteId,
    apiVersion,
  };
}

export async function writeBackup(args: {
  baseUrl: string;
  siteId: number;
  site: PleasanterSiteData;
  outPath?: string;
  backupDir?: string;
}): Promise<string> {
  const backupDir = path.resolve(args.backupDir ?? "backups");
  await mkdir(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath =
    args.outPath !== undefined
      ? path.resolve(args.outPath)
      : path.join(backupDir, `site-${args.siteId}-${timestamp}.json`);

  const backup: BackupDocument = {
    meta: {
      baseUrl: args.baseUrl,
      siteId: args.siteId,
      backedUpAt: new Date().toISOString(),
    },
    site: args.site,
    extracted: {
      scripts: args.site.SiteSettings?.Scripts ?? [],
      serverScripts: args.site.SiteSettings?.ServerScripts ?? [],
    },
  };

  await writeFile(outputPath, `${JSON.stringify(backup, null, 2)}\n`, "utf8");
  return outputPath;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    const equalIndex = withoutPrefix.indexOf("=");
    if (equalIndex >= 0) {
      const key = withoutPrefix.slice(0, equalIndex);
      const value = withoutPrefix.slice(equalIndex + 1);
      flags.set(key, value);
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(withoutPrefix, true);
      continue;
    }

    flags.set(withoutPrefix, next);
    index += 1;
  }

  return { _: positional, flags };
}

export function requireStringFlag(parsed: ParsedArgs, name: string): string {
  const value = getStringFlag(parsed, name);
  if (!value) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

export function getStringFlag(
  parsed: ParsedArgs,
  name: string,
): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

export function getBooleanFlag(parsed: ParsedArgs, name: string): boolean {
  const value = parsed.flags.get(name);
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value === "true";
  }
  return false;
}

export function printHelp(): void {
  process.stdout.write(`pleasanter-site-dev

Usage:
  pleasanter-site-dev backup --base-url <url> --site-id <id> --api-key <key> [--out <file>] [--backup-dir <dir>]
  pleasanter-site-dev push --base-url <url> --site-id <id> --api-key <key> --config <file> [--backup-dir <dir>] [--skip-backup] [--dry-run]
  pleasanter-site-dev ... [--log-level <debug|info|warn|error|silent>] [--verbose]

Environment variables:
  PLEASANTER_BASE_URL
  PLEASANTER_SITE_ID
  PLEASANTER_API_KEY
  PLEASANTER_API_VERSION
  PLEASANTER_LOG_LEVEL

Config example:
  See examples/site-settings.config.json
`);
}

export function createCliLogger(parsed: ParsedArgs): Logger {
  const verbose = getBooleanFlag(parsed, "verbose");
  const configuredLevel =
    getStringFlag(parsed, "log-level") ?? process.env.PLEASANTER_LOG_LEVEL;
  const level = verbose
    ? "debug"
    : (resolveLogLevel(configuredLevel) ?? "info");
  return createLogger({
    level,
    context: "cli",
  });
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    const errorObject =
      error instanceof Error ? error : new Error(String(error));
    const logger = createLogger({
      level: "error",
      context: "cli",
    });
    logger.error("Command failed", {
      error: errorObject,
    });
    process.exitCode = 1;
  });
}
