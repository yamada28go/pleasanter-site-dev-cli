import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadCliSettingsConfig,
  loadUpdateConfig,
  summarizeConfig,
} from "../src/config.js";

test("loadUpdateConfig resolves BodyFile relative to the config file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pleasanter-config-"));

  try {
    await writeFile(
      path.join(tempDir, "script.js"),
      "console.log('hello');\n",
      "utf8",
    );
    await writeFile(
      path.join(tempDir, "server.csx"),
      "context.Log('server');\n",
      "utf8",
    );
    await writeFile(
      path.join(tempDir, "config.json"),
      JSON.stringify({
        scripts: [
          {
            Id: 1,
            Title: "client",
            BodyFile: "./script.js",
          },
        ],
        serverScripts: [
          {
            Id: 9,
            Title: "server",
            BodyFile: "./server.csx",
          },
        ],
      }),
      "utf8",
    );

    const result = await loadUpdateConfig(path.join(tempDir, "config.json"));

    assert.deepEqual(result, {
      Scripts: [
        {
          Id: 1,
          Title: "client",
          Body: "console.log('hello');\n",
        },
      ],
      ServerScripts: [
        {
          Id: 9,
          Title: "server",
          Body: "context.Log('server');\n",
        },
      ],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loadUpdateConfig rejects an entry that specifies both Body and BodyFile", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pleasanter-config-"));

  try {
    await writeFile(
      path.join(tempDir, "config.json"),
      JSON.stringify({
        scripts: [
          {
            Id: 1,
            Body: "inline",
            BodyFile: "./script.js",
          },
        ],
      }),
      "utf8",
    );

    await assert.rejects(
      loadUpdateConfig(path.join(tempDir, "config.json")),
      /scripts\[0\] cannot specify both Body and BodyFile\./,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loadCliSettingsConfig resolves relative paths from the settings file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pleasanter-settings-"));

  try {
    await writeFile(
      path.join(tempDir, "cli-settings.json"),
      JSON.stringify({
        baseUrl: "https://example.com",
        siteId: 123,
        siteIds: [123, 456],
        apiKeyFile: "./secrets/api-key.txt",
        config: "./site-settings.config.json",
        backupDir: "./backups",
        backupRetention: 7,
        outputFile: "./out/site.json",
        skipBackup: true,
        dryRun: true,
      }),
      "utf8",
    );

    const result = await loadCliSettingsConfig(
      path.join(tempDir, "cli-settings.json"),
    );

    assert.deepEqual(result, {
      baseUrl: "https://example.com",
      siteId: 123,
      siteIds: [123, 456],
      apiKeyFile: path.join(tempDir, "secrets/api-key.txt"),
      config: path.join(tempDir, "site-settings.config.json"),
      backupDir: path.join(tempDir, "backups"),
      backupRetention: 7,
      outputFile: path.join(tempDir, "out/site.json"),
      skipBackup: true,
      dryRun: true,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loadCliSettingsConfig rejects invalid field types", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pleasanter-settings-"));

  try {
    await writeFile(
      path.join(tempDir, "cli-settings.json"),
      JSON.stringify({
        siteIds: "123",
      }),
      "utf8",
    );

    await assert.rejects(
      loadCliSettingsConfig(path.join(tempDir, "cli-settings.json")),
      /siteIds must be an array of numbers\./,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("summarizeConfig returns the script counts", () => {
  assert.equal(
    summarizeConfig({
      Scripts: [{ Id: 1 }, { Id: 2 }],
      ServerScripts: [{ Id: 9 }],
    }),
    "Scripts=2, ServerScripts=1",
  );
});
