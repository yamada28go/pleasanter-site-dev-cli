import { readFile } from "node:fs/promises";
import path from "node:path";

import { createLogger, type Logger } from "./logger.js";
import type { JsonObject, SiteUpdateConfig } from "./types.js";

export interface ResolvedSiteUpdateConfig {
  Scripts?: JsonObject[];
  ServerScripts?: JsonObject[];
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
