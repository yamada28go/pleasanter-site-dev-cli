export type JsonObject = Record<string, unknown>;

// JSON config file accepted by the CLI before it is normalized for the API.
export interface ScriptInput {
  Id: number;
  Title?: string;
  Disabled?: boolean;
  Body?: string;
  BodyFile?: string;
  ScriptAll?: boolean;
  ScriptNew?: boolean;
  ScriptEdit?: boolean;
  ScriptIndex?: boolean;
  ScriptCalendar?: boolean;
  ScriptCrosstab?: boolean;
  ScriptGantt?: boolean;
  ScriptBurnDown?: boolean;
  ScriptTimeSeries?: boolean;
  ScriptKamban?: boolean;
  ScriptImageLib?: boolean;
  Delete?: 0 | 1;
}

export interface ServerScriptInput {
  Id: number;
  Title?: string;
  Name?: string;
  Disabled?: boolean;
  Body?: string;
  BodyFile?: string;
  ServerScriptWhenloadingSiteSettings?: boolean;
  ServerScriptWhenViewProcessing?: boolean;
  ServerScriptWhenloadingRecord?: boolean;
  ServerScriptBeforeFormula?: boolean;
  ServerScriptAfterFormula?: boolean;
  ServerScriptBeforeCreate?: boolean;
  ServerScriptAfterCreate?: boolean;
  ServerScriptBeforeUpdate?: boolean;
  ServerScriptAfterUpdate?: boolean;
  ServerScriptBeforeDelete?: boolean;
  ServerScriptAfterDelete?: boolean;
  ServerScriptBeforeBulkDelete?: boolean;
  ServerScriptAfterBulkDelete?: boolean;
  ServerScriptBeforeOpeningPage?: boolean;
  ServerScriptBeforeOpeningRow?: boolean;
  ServerScriptShared?: boolean;
  Delete?: 0 | 1;
}

export interface SiteUpdateConfig {
  scripts?: ScriptInput[];
  serverScripts?: ServerScriptInput[];
}

export interface CliSettingsConfig {
  baseUrl?: string;
  siteId?: number;
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

// Subset of the getsite response used by this CLI plus passthrough fields.
export interface PleasanterSiteData {
  TenantId: number;
  SiteId: number;
  Title: string;
  ReferenceType?: string;
  UpdatedTime?: string;
  SiteSettings?: JsonObject & {
    Scripts?: JsonObject[];
    ServerScripts?: JsonObject[];
  };
  [key: string]: unknown;
}

export interface GetSiteResponse {
  StatusCode?: number;
  Response?: {
    Data?: PleasanterSiteData;
  };
  Message?: string;
}

export interface UpdateSiteSettingsResponse {
  Id?: number;
  StatusCode?: number;
  Message?: string;
}

export interface BackupDocument {
  meta: {
    baseUrl: string;
    siteId: number;
    backedUpAt: string;
  };
  site: PleasanterSiteData;
  extracted: {
    scripts: JsonObject[];
    serverScripts: JsonObject[];
  };
}
