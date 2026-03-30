#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PleasanterClient } from "./api.js";
import { loadUpdateConfig, summarizeConfig } from "./config.js";
import type { BackupDocument, PleasanterSiteData } from "./types.js";

type CommandName = "backup" | "push" | "help";

interface ParsedArgs {
  _: string[];
  flags: Map<string, string | boolean>;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const command = (parsed._[0] ?? "help") as CommandName;

  switch (command) {
    case "backup":
      await runBackup(parsed);
      return;
    case "push":
      await runPush(parsed);
      return;
    case "help":
    default:
      printHelp();
  }
}

async function runBackup(parsed: ParsedArgs): Promise<void> {
  const options = readCommonOptions(parsed);
  const client = new PleasanterClient(options);
  const site = await client.getSite();
  const backupPath = await writeBackup({
    baseUrl: options.baseUrl,
    siteId: options.siteId,
    site,
    outPath: getStringFlag(parsed, "out"),
    backupDir: getStringFlag(parsed, "backup-dir"),
  });

  console.log(`Backup created: ${backupPath}`);
}

async function runPush(parsed: ParsedArgs): Promise<void> {
  const options = readCommonOptions(parsed);
  const configPath = requireStringFlag(parsed, "config");
  const updateConfig = await loadUpdateConfig(configPath);
  console.log(`Loaded config: ${summarizeConfig(updateConfig)}`);

  if (getBooleanFlag(parsed, "dry-run")) {
    console.log(JSON.stringify(updateConfig, null, 2));
    return;
  }

  const client = new PleasanterClient(options);
  const site = await client.getSite();
  const skipBackup = getBooleanFlag(parsed, "skip-backup");
  let backupPath: string | undefined;
  if (!skipBackup) {
    backupPath = await writeBackup({
      baseUrl: options.baseUrl,
      siteId: options.siteId,
      site,
      outPath: undefined,
      backupDir: getStringFlag(parsed, "backup-dir"),
    });
  }

  const response = await client.updateSiteSettings(updateConfig);
  if (backupPath) {
    console.log(`Backup created: ${backupPath}`);
  }
  console.log(
    `Update completed: ${response.StatusCode ?? 200} ${response.Message ?? ""}`.trim(),
  );
}

function readCommonOptions(parsed: ParsedArgs) {
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

async function writeBackup(args: {
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

function parseArgs(argv: string[]): ParsedArgs {
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

function requireStringFlag(parsed: ParsedArgs, name: string): string {
  const value = getStringFlag(parsed, name);
  if (!value) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

function getStringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function getBooleanFlag(parsed: ParsedArgs, name: string): boolean {
  const value = parsed.flags.get(name);
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value === "true";
  }
  return false;
}

function printHelp(): void {
  console.log(`pleasanter-site-dev

Usage:
  pleasanter-site-dev backup --base-url <url> --site-id <id> --api-key <key> [--out <file>] [--backup-dir <dir>]
  pleasanter-site-dev push --base-url <url> --site-id <id> --api-key <key> --config <file> [--backup-dir <dir>] [--skip-backup] [--dry-run]

Environment variables:
  PLEASANTER_BASE_URL
  PLEASANTER_SITE_ID
  PLEASANTER_API_KEY
  PLEASANTER_API_VERSION

Config example:
  See examples/site-settings.config.json
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
