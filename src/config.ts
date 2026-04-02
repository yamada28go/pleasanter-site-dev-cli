import { readFile } from "node:fs/promises";
import path from "node:path";

import { createLogger, type Logger } from "./logger.js";
import type {
  CliSettingsConfig,
  JsonObject,
  SiteUpdateConfig,
} from "./types.js";

export interface ResolvedSiteUpdateConfig {
  Scripts?: JsonObject[];
  ServerScripts?: JsonObject[];
}

export interface ResolvedCliSettingsConfig {
  baseUrl?: string;
  siteId?: number;
  siteIds?: number[];
  apiKey?: string;
  apiKeyFile?: string;
  apiVersion?: number;
  logLevel?: string;
  backupDir?: string;
  backupRetention?: number;
  outputFile?: string;
  config?: string;
  skipBackup?: boolean;
  dryRun?: boolean;
}

export async function loadUpdateConfig(
  configPath: string,
  logger: Logger = createLogger({ context: "config" }),
): Promise<ResolvedSiteUpdateConfig> {
  const absoluteConfigPath = path.resolve(configPath);
  // BodyFile paths are resolved relative to the config file location.
  const configDirectory = path.dirname(absoluteConfigPath);
  logger.info("Loading update config", {
    configPath: absoluteConfigPath,
  });
  const raw = await readFile(absoluteConfigPath, "utf8");
  const parsed = JSON.parse(raw) as SiteUpdateConfig;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Config file must be a JSON object.");
  }

  const scripts = parsed.scripts
    ? await Promise.all(
        parsed.scripts.map((script, index) =>
          resolveBodyFile(script, configDirectory, `scripts[${index}]`),
        ),
      )
    : undefined;

  const serverScripts = parsed.serverScripts
    ? await Promise.all(
        parsed.serverScripts.map((script, index) =>
          resolveBodyFile(script, configDirectory, `serverScripts[${index}]`),
        ),
      )
    : undefined;

  if (!scripts?.length && !serverScripts?.length) {
    throw new Error(
      "Config must include at least one entry in scripts or serverScripts.",
    );
  }

  logger.info("Loaded update config", {
    configPath: absoluteConfigPath,
    scriptCount: scripts?.length ?? 0,
    serverScriptCount: serverScripts?.length ?? 0,
  });

  return {
    Scripts: scripts,
    ServerScripts: serverScripts,
  };
}

export async function loadCliSettingsConfig(
  configPath: string,
  logger: Logger = createLogger({ context: "settings" }),
): Promise<ResolvedCliSettingsConfig> {
  const absoluteConfigPath = path.resolve(configPath);
  const configDirectory = path.dirname(absoluteConfigPath);
  logger.info("Loading CLI settings config", {
    configPath: absoluteConfigPath,
  });
  const raw = await readFile(absoluteConfigPath, "utf8");
  const parsed = JSON.parse(raw) as CliSettingsConfig;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CLI settings config must be a JSON object.");
  }

  const resolved: ResolvedCliSettingsConfig = {};

  if (parsed.baseUrl !== undefined) {
    if (typeof parsed.baseUrl !== "string") {
      throw new Error("baseUrl must be a string.");
    }
    resolved.baseUrl = parsed.baseUrl;
  }

  if (parsed.siteId !== undefined) {
    if (typeof parsed.siteId !== "number") {
      throw new Error("siteId must be a number.");
    }
    resolved.siteId = parsed.siteId;
  }

  if (parsed.siteIds !== undefined) {
    if (
      !Array.isArray(parsed.siteIds) ||
      parsed.siteIds.some((siteId) => typeof siteId !== "number")
    ) {
      throw new Error("siteIds must be an array of numbers.");
    }
    resolved.siteIds = parsed.siteIds;
  }

  if (parsed.apiKey !== undefined) {
    if (typeof parsed.apiKey !== "string") {
      throw new Error("apiKey must be a string.");
    }
    resolved.apiKey = parsed.apiKey;
  }

  if (parsed.apiKeyFile !== undefined) {
    if (typeof parsed.apiKeyFile !== "string") {
      throw new Error("apiKeyFile must be a string.");
    }
    resolved.apiKeyFile = path.resolve(configDirectory, parsed.apiKeyFile);
  }

  if (parsed.apiVersion !== undefined) {
    if (typeof parsed.apiVersion !== "number") {
      throw new Error("apiVersion must be a number.");
    }
    resolved.apiVersion = parsed.apiVersion;
  }

  if (parsed.logLevel !== undefined) {
    if (typeof parsed.logLevel !== "string") {
      throw new Error("logLevel must be a string.");
    }
    resolved.logLevel = parsed.logLevel;
  }

  if (parsed.backupDir !== undefined) {
    if (typeof parsed.backupDir !== "string") {
      throw new Error("backupDir must be a string.");
    }
    resolved.backupDir = path.resolve(configDirectory, parsed.backupDir);
  }

  if (parsed.backupRetention !== undefined) {
    if (typeof parsed.backupRetention !== "number") {
      throw new Error("backupRetention must be a number.");
    }
    resolved.backupRetention = parsed.backupRetention;
  }

  if (parsed.outputFile !== undefined) {
    if (typeof parsed.outputFile !== "string") {
      throw new Error("outputFile must be a string.");
    }
    resolved.outputFile = path.resolve(configDirectory, parsed.outputFile);
  }

  if (parsed.config !== undefined) {
    if (typeof parsed.config !== "string") {
      throw new Error("config must be a string.");
    }
    resolved.config = path.resolve(configDirectory, parsed.config);
  }

  if (parsed.skipBackup !== undefined) {
    if (typeof parsed.skipBackup !== "boolean") {
      throw new Error("skipBackup must be a boolean.");
    }
    resolved.skipBackup = parsed.skipBackup;
  }

  if (parsed.dryRun !== undefined) {
    if (typeof parsed.dryRun !== "boolean") {
      throw new Error("dryRun must be a boolean.");
    }
    resolved.dryRun = parsed.dryRun;
  }

  logger.info("Loaded CLI settings config", {
    configPath: absoluteConfigPath,
  });

  return resolved;
}

async function resolveBodyFile<
  T extends { Body?: unknown; BodyFile?: unknown },
>(entry: T, configDirectory: string, label: string): Promise<JsonObject> {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error(`${label} must be an object.`);
  }

  const body = entry.Body;
  const bodyFile = entry.BodyFile;
  if (body !== undefined && bodyFile !== undefined) {
    throw new Error(`${label} cannot specify both Body and BodyFile.`);
  }

  const normalized: JsonObject = { ...(entry as Record<string, unknown>) };
  if (typeof bodyFile === "string") {
    const resolvedPath = path.resolve(configDirectory, bodyFile);
    normalized.Body = await readFile(resolvedPath, "utf8");
    delete normalized.BodyFile;
  } else if (bodyFile !== undefined) {
    throw new Error(`${label}.BodyFile must be a string.`);
  }

  return normalized;
}

export function summarizeConfig(config: ResolvedSiteUpdateConfig): string {
  const scriptCount = config.Scripts?.length ?? 0;
  const serverScriptCount = config.ServerScripts?.length ?? 0;
  return `Scripts=${scriptCount}, ServerScripts=${serverScriptCount}`;
}
