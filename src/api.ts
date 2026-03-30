import type {
  GetSiteResponse,
  JsonObject,
  PleasanterSiteData,
  UpdateSiteSettingsResponse,
} from "./types.js";
import { createLogger, type Logger } from "./logger.js";

export interface PleasanterClientOptions {
  baseUrl: string;
  siteId: number;
  apiKey: string;
  apiVersion?: number;
  logger?: Logger;
}

export class PleasanterClient {
  private readonly baseUrl: string;
  private readonly siteId: number;
  private readonly apiKey: string;
  private readonly apiVersion: number;
  private readonly logger: Logger;

  public constructor(options: PleasanterClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.siteId = options.siteId;
    this.apiKey = options.apiKey;
    this.apiVersion = options.apiVersion ?? 1.1;
    this.logger = options.logger ?? createLogger({ context: "api" });
  }

  public async getSite(): Promise<PleasanterSiteData> {
    this.logger.info("Fetching site settings", {
      siteId: this.siteId,
    });
    const response = await this.post<GetSiteResponse>("getsite", {
      ApiVersion: this.apiVersion,
      ApiKey: this.apiKey,
    });

    if (response.StatusCode && response.StatusCode >= 400) {
      throw new Error(
        `getsite failed with status ${response.StatusCode}: ${response.Message ?? "Unknown error"}`,
      );
    }

    const data = response.Response?.Data;
    if (!data) {
      throw new Error("getsite returned no Response.Data payload.");
    }

    this.logger.info("Fetched site settings", {
      siteId: this.siteId,
      title: data.Title,
    });
    return data;
  }

  public async updateSiteSettings(payload: {
    Scripts?: JsonObject[];
    ServerScripts?: JsonObject[];
  }): Promise<UpdateSiteSettingsResponse> {
    this.logger.info("Updating site settings", {
      siteId: this.siteId,
      scriptCount: payload.Scripts?.length ?? 0,
      serverScriptCount: payload.ServerScripts?.length ?? 0,
    });
    const response = await this.post<UpdateSiteSettingsResponse>(
      "updatesitesettings",
      {
        ApiVersion: this.apiVersion,
        ApiKey: this.apiKey,
        ...payload,
      },
    );

    if (response.StatusCode && response.StatusCode >= 400) {
      throw new Error(
        `updatesitesettings failed with status ${response.StatusCode}: ${response.Message ?? "Unknown error"}`,
      );
    }

    this.logger.info("Updated site settings", {
      siteId: this.siteId,
      statusCode: response.StatusCode ?? 200,
    });
    return response;
  }

  private async post<T>(
    action: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}/api/items/${this.siteId}/${action}`;
    const startedAt = Date.now();
    this.logger.debug("Sending API request", {
      action,
      siteId: this.siteId,
      url,
    });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    this.logger.debug("Received API response", {
      action,
      siteId: this.siteId,
      status: response.status,
      ok: response.ok,
      bodyLength: text.length,
      durationMs: Date.now() - startedAt,
    });

    if (!response.ok) {
      throw new Error(
        `${action} returned HTTP ${response.status}: ${truncate(text, 300)}`,
      );
    }

    // Pleasanter returns JSON even for success responses with nested payloads.
    const parsed = text ? (JSON.parse(text) as T) : ({} as T);
    return parsed;
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
