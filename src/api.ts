import type {
  GetSiteResponse,
  JsonObject,
  PleasanterSiteData,
  UpdateSiteSettingsResponse,
} from "./types.js";

export interface PleasanterClientOptions {
  baseUrl: string;
  siteId: number;
  apiKey: string;
  apiVersion?: number;
}

export class PleasanterClient {
  private readonly baseUrl: string;
  private readonly siteId: number;
  private readonly apiKey: string;
  private readonly apiVersion: number;

  public constructor(options: PleasanterClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.siteId = options.siteId;
    this.apiKey = options.apiKey;
    this.apiVersion = options.apiVersion ?? 1.1;
  }

  public async getSite(): Promise<PleasanterSiteData> {
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

    return data;
  }

  public async updateSiteSettings(payload: {
    Scripts?: JsonObject[];
    ServerScripts?: JsonObject[];
  }): Promise<UpdateSiteSettingsResponse> {
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

    return response;
  }

  private async post<T>(
    action: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}/api/items/${this.siteId}/${action}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `${action} returned HTTP ${response.status}: ${truncate(text, 300)}`,
      );
    }

    const parsed = text ? (JSON.parse(text) as T) : ({} as T);
    return parsed;
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
