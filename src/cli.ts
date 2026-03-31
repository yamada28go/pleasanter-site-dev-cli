#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PleasanterClient } from "./api.js";
import {
  loadCliSettingsConfig,
  loadUpdateConfig,
  summarizeConfig,
  type ResolvedCliSettingsConfig,
} from "./config.js";
import { createLogger, resolveLogLevel, type Logger } from "./logger.js";
import type { BackupDocument, PleasanterSiteData } from "./types.js";

type CommandName = "backup" | "push" | "help";

interface CliMetadata {
  version: string;
  description?: string;
  repositoryUrl?: string;
}

const cliMetadata = loadCliMetadata();
const DEFAULT_AUTO_BACKUP_RETENTION = 10;

export interface ParsedArgs {
  _: string[];
  flags: Map<string, string | boolean>;
}

export async function main(): Promise<void> {
  const parsed = await resolveParsedArgs(parseArgs(process.argv.slice(2)));
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
  const options = await readCommonOptions(parsed);
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
    outPath: getOptionalStringSetting(parsed, "output-file"),
    backupDir: getOptionalStringSetting(parsed, "backup-dir"),
  });

  logger.info("Backup created", {
    backupPath,
  });
}

async function runPush(parsed: ParsedArgs, logger: Logger): Promise<void> {
  const options = await readCommonOptions(parsed);
  const configPath = requireSetting(parsed, "config");
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
    const backupRetention = resolveAutoBackupRetention(parsed);
    logger.info("Creating backup before update", {
      siteId: options.siteId,
      backupRetention,
    });
    backupPath = await writeBackup({
      baseUrl: options.baseUrl,
      siteId: options.siteId,
      site,
      outPath: undefined,
      backupDir: getOptionalStringSetting(parsed, "backup-dir"),
    });
    await pruneAutomaticBackups({
      backupPath,
      siteId: options.siteId,
      maxBackups: backupRetention,
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

export async function readCommonOptions(parsed: ParsedArgs) {
  const baseUrl = getOptionalStringSetting(parsed, "base-url");
  const apiKey = await resolveApiKey(parsed);
  const siteIdRaw = getOptionalStringSetting(parsed, "site-id");
  const apiVersionRaw = getOptionalStringSetting(parsed, "api-version");

  if (!baseUrl) {
    throw new Error(
      "--base-url, settings.baseUrl, or PLEASANTER_BASE_URL is required.",
    );
  }
  if (!apiKey) {
    throw new Error(
      "--api-key, --api-key-file, settings.apiKey, settings.apiKeyFile, PLEASANTER_API_KEY, or PLEASANTER_API_KEY_FILE is required.",
    );
  }
  if (!siteIdRaw) {
    throw new Error(
      "--site-id, settings.siteId, or PLEASANTER_SITE_ID is required.",
    );
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

async function resolveApiKey(parsed: ParsedArgs): Promise<string | undefined> {
  const inlineApiKey = getStringFlag(parsed, "api-key");
  if (inlineApiKey) {
    return inlineApiKey;
  }

  const apiKeyFile = getOptionalStringSetting(parsed, "api-key-file");
  if (apiKeyFile) {
    const contents = await readFile(path.resolve(apiKeyFile), "utf8");
    return contents.trim();
  }

  return process.env.PLEASANTER_API_KEY;
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

  // Avoid ':' in filenames so the backup path is portable across environments.
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

export async function pruneAutomaticBackups(args: {
  backupPath: string;
  siteId: number;
  maxBackups: number;
}): Promise<void> {
  const backupDir = path.dirname(args.backupPath);
  const prefix = `site-${args.siteId}-`;
  const entries = await readdir(backupDir, { withFileTypes: true });
  const matchingFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(prefix) &&
        entry.name.endsWith(".json"),
    )
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  const filesToDelete = matchingFiles.slice(args.maxBackups);
  await Promise.all(
    filesToDelete.map((fileName) => unlink(path.join(backupDir, fileName))),
  );
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();

  // Support both --flag value and --flag=value with bare flags treated as boolean.
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

export function renderHelp(metadata: CliMetadata = cliMetadata): string {
  return `pleasanter-site-dev

Description:
  ${metadata.description ?? "N/A"}

Version:
  ${metadata.version}

Repository:
  ${metadata.repositoryUrl ?? "N/A"}

Usage:
  pleasanter-site-dev backup [--settings <file>] --base-url <url> --site-id <id> [--api-key <key> | --api-key-file <file>] [--output-file <file>] [--backup-dir <dir>]
  pleasanter-site-dev push [--settings <file>] --base-url <url> --site-id <id> [--api-key <key> | --api-key-file <file>] --config <file> [--backup-dir <dir>] [--backup-retention <count>] [--skip-backup] [--dry-run]
  pleasanter-site-dev ... [--log-level <debug|info|warn|error|silent>] [--verbose]

Environment variables:
  PLEASANTER_BASE_URL
  PLEASANTER_SITE_ID
  PLEASANTER_API_KEY
  PLEASANTER_API_KEY_FILE
  PLEASANTER_API_VERSION
  PLEASANTER_BACKUP_RETENTION
  PLEASANTER_LOG_LEVEL
  PLEASANTER_SETTINGS_FILE

Config example:
  See examples/site-settings.config.json and examples/cli-settings.json
`;
}

export function printHelp(): void {
  process.stdout.write(renderHelp());
}

export function createCliLogger(parsed: ParsedArgs): Logger {
  const verbose = getBooleanFlag(parsed, "verbose");
  const configuredLevel = getOptionalStringSetting(parsed, "log-level");
  const level = verbose
    ? "debug"
    : (resolveLogLevel(configuredLevel) ?? "info");
  return createLogger({
    level,
    context: "cli",
  });
}

export async function resolveParsedArgs(
  parsed: ParsedArgs,
): Promise<ParsedArgs> {
  const settingsPath =
    getStringFlag(parsed, "settings") ?? process.env.PLEASANTER_SETTINGS_FILE;
  if (!settingsPath) {
    return parsed;
  }

  const settings = await loadCliSettingsConfig(settingsPath);
  const mergedFlags = new Map(parsed.flags);
  applySettingsDefaults(mergedFlags, settings);
  mergedFlags.set("settings", path.resolve(settingsPath));

  return {
    _: parsed._,
    flags: mergedFlags,
  };
}

export function isCliEntrypoint(
  argv1: string | undefined,
  moduleUrl: string,
): boolean {
  if (!argv1) {
    return false;
  }

  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return pathToFileURL(argv1).href === moduleUrl;
  }
}

const isEntrypoint = isCliEntrypoint(process.argv[1], import.meta.url);

function loadCliMetadata(): CliMetadata {
  const parsed = readPackageJson();

  const repositoryUrl =
    typeof parsed.homepage === "string"
      ? parsed.homepage.replace(/#readme$/, "")
      : normalizeRepositoryUrl(parsed.repository);

  return {
    description:
      typeof parsed.description === "string" ? parsed.description : undefined,
    version: typeof parsed.version === "string" ? parsed.version : "unknown",
    repositoryUrl,
  };
}

function readPackageJson(): {
  description?: unknown;
  version?: unknown;
  repository?: { url?: unknown } | unknown;
  homepage?: unknown;
} {
  const candidates = [
    new URL("../package.json", import.meta.url),
    new URL("../../package.json", import.meta.url),
  ];

  for (const packageJsonUrl of candidates) {
    try {
      const raw = readFileSync(packageJsonUrl, "utf8");
      return JSON.parse(raw) as {
        description?: unknown;
        version?: unknown;
        repository?: { url?: unknown } | unknown;
        homepage?: unknown;
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error("Unable to locate package.json for CLI metadata.");
}

function normalizeRepositoryUrl(
  repository: { url?: unknown } | unknown,
): string | undefined {
  if (!repository || typeof repository !== "object") {
    return undefined;
  }

  const url = (repository as Record<string, unknown>).url;
  if (typeof url !== "string") {
    return undefined;
  }

  return url.replace(/^git\+/, "").replace(/\.git$/, "");
}

function applySettingsDefaults(
  flags: Map<string, string | boolean>,
  settings: ResolvedCliSettingsConfig,
): void {
  setStringDefault(flags, "base-url", settings.baseUrl);
  setStringDefault(
    flags,
    "site-id",
    settings.siteId !== undefined ? String(settings.siteId) : undefined,
  );
  setStringDefault(flags, "api-key", settings.apiKey);
  setStringDefault(flags, "api-key-file", settings.apiKeyFile);
  setStringDefault(
    flags,
    "api-version",
    settings.apiVersion !== undefined ? String(settings.apiVersion) : undefined,
  );
  setStringDefault(flags, "log-level", settings.logLevel);
  setStringDefault(flags, "backup-dir", settings.backupDir);
  setStringDefault(
    flags,
    "backup-retention",
    settings.backupRetention !== undefined
      ? String(settings.backupRetention)
      : undefined,
  );
  setStringDefault(flags, "output-file", settings.outputFile);
  setStringDefault(flags, "config", settings.config);
  setBooleanDefault(flags, "skip-backup", settings.skipBackup);
  setBooleanDefault(flags, "dry-run", settings.dryRun);
}

function setStringDefault(
  flags: Map<string, string | boolean>,
  key: string,
  value: string | undefined,
): void {
  if (value !== undefined && !flags.has(key)) {
    flags.set(key, value);
  }
}

function setBooleanDefault(
  flags: Map<string, string | boolean>,
  key: string,
  value: boolean | undefined,
): void {
  if (value !== undefined && !flags.has(key)) {
    flags.set(key, value);
  }
}

function getOptionalStringSetting(
  parsed: ParsedArgs,
  name: string,
): string | undefined {
  return getStringFlag(parsed, name) ?? getSettingEnvFallback(name);
}

function getSettingEnvFallback(name: string): string | undefined {
  switch (name) {
    case "base-url":
      return process.env.PLEASANTER_BASE_URL;
    case "site-id":
      return process.env.PLEASANTER_SITE_ID;
    case "api-key":
      return process.env.PLEASANTER_API_KEY;
    case "api-key-file":
      return process.env.PLEASANTER_API_KEY_FILE;
    case "api-version":
      return process.env.PLEASANTER_API_VERSION;
    case "backup-retention":
      return process.env.PLEASANTER_BACKUP_RETENTION;
    case "log-level":
      return process.env.PLEASANTER_LOG_LEVEL;
    default:
      return undefined;
  }
}

function requireSetting(parsed: ParsedArgs, name: string): string {
  const value = getOptionalStringSetting(parsed, name);
  if (!value) {
    throw new Error(`--${name} or settings.${toCamelCase(name)} is required.`);
  }
  return value;
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, next: string) => next.toUpperCase());
}

function resolveAutoBackupRetention(parsed: ParsedArgs): number {
  const rawValue = getOptionalStringSetting(parsed, "backup-retention");
  if (!rawValue) {
    return DEFAULT_AUTO_BACKUP_RETENTION;
  }

  const retention = Number(rawValue);
  if (!Number.isInteger(retention) || retention <= 0) {
    throw new Error(`Invalid backup retention: ${rawValue}`);
  }

  return retention;
}

if (isEntrypoint) {
  // Keep the module importable in tests while still behaving as a CLI entrypoint.
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
