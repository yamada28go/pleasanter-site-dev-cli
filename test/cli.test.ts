import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  isCliEntrypoint,
  parseArgs,
  pruneAutomaticBackups,
  readCommonOptions,
  renderHelp,
  resolveParsedArgs,
  writeBackup,
} from "../src/cli.js";

test("parseArgs handles positional arguments, equals syntax, and boolean flags", () => {
  const parsed = parseArgs([
    "push",
    "--config=examples/site-settings.config.json",
    "--dry-run",
    "--site-id",
    "123",
  ]);

  assert.deepEqual(parsed._, ["push"]);
  assert.equal(
    parsed.flags.get("config"),
    "examples/site-settings.config.json",
  );
  assert.equal(parsed.flags.get("dry-run"), true);
  assert.equal(parsed.flags.get("site-id"), "123");
});

test("readCommonOptions reads required values from flags and environment variables", async () => {
  const previousEnv = {
    PLEASANTER_BASE_URL: process.env.PLEASANTER_BASE_URL,
    PLEASANTER_SITE_ID: process.env.PLEASANTER_SITE_ID,
    PLEASANTER_API_KEY: process.env.PLEASANTER_API_KEY,
    PLEASANTER_API_KEY_FILE: process.env.PLEASANTER_API_KEY_FILE,
    PLEASANTER_API_VERSION: process.env.PLEASANTER_API_VERSION,
  };

  process.env.PLEASANTER_BASE_URL = "https://example.com";
  process.env.PLEASANTER_SITE_ID = "456";
  process.env.PLEASANTER_API_KEY = "env-key";
  process.env.PLEASANTER_API_VERSION = "1.2";

  try {
    const options = await readCommonOptions(
      parseArgs(["backup", "--api-key", "flag-key"]),
    );

    assert.deepEqual(options, {
      baseUrl: "https://example.com",
      apiKey: "flag-key",
      siteId: 456,
      apiVersion: 1.2,
    });
  } finally {
    restoreEnv(previousEnv);
  }
});

test("readCommonOptions reads api key from --api-key-file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pleasanter-api-key-"));
  const apiKeyPath = path.join(tempDir, "api-key.txt");
  const previousEnv = {
    PLEASANTER_BASE_URL: process.env.PLEASANTER_BASE_URL,
    PLEASANTER_SITE_ID: process.env.PLEASANTER_SITE_ID,
    PLEASANTER_API_KEY: process.env.PLEASANTER_API_KEY,
    PLEASANTER_API_KEY_FILE: process.env.PLEASANTER_API_KEY_FILE,
    PLEASANTER_API_VERSION: process.env.PLEASANTER_API_VERSION,
  };

  process.env.PLEASANTER_BASE_URL = "https://example.com";
  process.env.PLEASANTER_SITE_ID = "456";
  process.env.PLEASANTER_API_KEY = "env-key";

  try {
    await writeFile(apiKeyPath, "file-key\n", "utf8");

    const options = await readCommonOptions(
      parseArgs(["backup", "--api-key-file", apiKeyPath]),
    );

    assert.equal(options.apiKey, "file-key");
  } finally {
    restoreEnv(previousEnv);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("readCommonOptions reads api key from PLEASANTER_API_KEY_FILE", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pleasanter-api-key-"));
  const apiKeyPath = path.join(tempDir, "api-key.txt");
  const previousEnv = {
    PLEASANTER_BASE_URL: process.env.PLEASANTER_BASE_URL,
    PLEASANTER_SITE_ID: process.env.PLEASANTER_SITE_ID,
    PLEASANTER_API_KEY: process.env.PLEASANTER_API_KEY,
    PLEASANTER_API_KEY_FILE: process.env.PLEASANTER_API_KEY_FILE,
    PLEASANTER_API_VERSION: process.env.PLEASANTER_API_VERSION,
  };

  process.env.PLEASANTER_BASE_URL = "https://example.com";
  process.env.PLEASANTER_SITE_ID = "456";
  process.env.PLEASANTER_API_KEY_FILE = apiKeyPath;

  try {
    await writeFile(apiKeyPath, "file-env-key\n", "utf8");

    const options = await readCommonOptions(parseArgs(["backup"]));

    assert.equal(options.apiKey, "file-env-key");
  } finally {
    restoreEnv(previousEnv);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolveParsedArgs merges settings file defaults and preserves explicit flags", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pleasanter-cli-"));

  try {
    await writeFile(
      path.join(tempDir, "cli-settings.json"),
      JSON.stringify({
        baseUrl: "https://example.com",
        siteId: 456,
        apiKeyFile: "./api-key.txt",
        config: "./site-settings.config.json",
        backupRetention: 7,
        dryRun: true,
      }),
      "utf8",
    );

    const parsed = await resolveParsedArgs(
      parseArgs([
        "push",
        "--settings",
        path.join(tempDir, "cli-settings.json"),
        "--site-id",
        "789",
      ]),
    );

    assert.equal(parsed.flags.get("base-url"), "https://example.com");
    assert.equal(parsed.flags.get("site-id"), "789");
    assert.equal(parsed.flags.get("dry-run"), true);
    assert.equal(
      parsed.flags.get("api-key-file"),
      path.join(tempDir, "api-key.txt"),
    );
    assert.equal(
      parsed.flags.get("config"),
      path.join(tempDir, "site-settings.config.json"),
    );
    assert.equal(parsed.flags.get("backup-retention"), "7");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("readCommonOptions rejects invalid site ids", async () => {
  await assert.rejects(
    readCommonOptions(
      parseArgs([
        "backup",
        "--base-url",
        "https://example.com",
        "--api-key",
        "secret",
        "--site-id",
        "0",
      ]),
    ),
    /Invalid site id: 0/,
  );
});

test("isCliEntrypoint returns true for symlinked bin paths", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pleasanter-bin-"));
  const linkPath = path.join(tempDir, "pleasanter-site-dev");

  try {
    const modulePath = path.resolve("src/cli.ts");
    await symlink(modulePath, linkPath);

    assert.equal(
      isCliEntrypoint(linkPath, pathToFileURL(modulePath).href),
      true,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("isCliEntrypoint returns false for a different module", () => {
  assert.equal(
    isCliEntrypoint(
      path.resolve("src/config.ts"),
      pathToFileURL(path.resolve("src/cli.ts")).href,
    ),
    false,
  );
});

test("renderHelp includes version and repository metadata", () => {
  const help = renderHelp({
    description: "Example CLI",
    version: "9.9.9",
    repositoryUrl: "https://github.com/example/repo",
  });

  assert.match(help, /Description:\n {2}Example CLI/);
  assert.match(help, /Version:\n {2}9\.9\.9/);
  assert.match(help, /Repository:\n {2}https:\/\/github\.com\/example\/repo/);
});

test("writeBackup writes site data and extracted scripts to the requested path", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pleasanter-backup-"));
  const outputPath = path.join(tempDir, "backup.json");

  try {
    const writtenPath = await writeBackup({
      baseUrl: "https://example.com",
      siteId: 123,
      outPath: outputPath,
      site: {
        TenantId: 1,
        SiteId: 123,
        Title: "Example",
        SiteSettings: {
          Scripts: [{ Id: 1, Title: "client" }],
          ServerScripts: [{ Id: 9, Title: "server" }],
        },
      },
    });

    assert.equal(writtenPath, outputPath);

    const content = JSON.parse(await readFile(outputPath, "utf8")) as {
      meta: { baseUrl: string; siteId: number };
      extracted: {
        scripts: Array<{ Id: number; Title: string }>;
        serverScripts: Array<{ Id: number; Title: string }>;
      };
    };
    assert.equal(content.meta.baseUrl, "https://example.com");
    assert.equal(content.meta.siteId, 123);
    assert.deepEqual(content.extracted.scripts, [{ Id: 1, Title: "client" }]);
    assert.deepEqual(content.extracted.serverScripts, [
      { Id: 9, Title: "server" },
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("pruneAutomaticBackups keeps the newest 10 backups by default pattern", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pleasanter-prune-"));
  const siteId = 123;

  try {
    for (let index = 1; index <= 12; index += 1) {
      const suffix = String(index).padStart(2, "0");
      await writeFile(
        path.join(
          tempDir,
          `site-${siteId}-2026-04-${suffix}T00-00-00-000Z.json`,
        ),
        "{}\n",
        "utf8",
      );
    }
    await writeFile(
      path.join(tempDir, "site-999-2026-04-01T00-00-00-000Z.json"),
      "{}\n",
      "utf8",
    );

    await pruneAutomaticBackups({
      backupPath: path.join(
        tempDir,
        `site-${siteId}-2026-04-12T00-00-00-000Z.json`,
      ),
      siteId,
      maxBackups: 10,
    });

    const remainingFiles = (await readFileNames(tempDir)).sort();
    assert.equal(
      remainingFiles.filter((name) => name.startsWith(`site-${siteId}-`))
        .length,
      10,
    );
    assert.equal(
      remainingFiles.includes(`site-${siteId}-2026-04-01T00-00-00-000Z.json`),
      false,
    );
    assert.equal(
      remainingFiles.includes(`site-${siteId}-2026-04-02T00-00-00-000Z.json`),
      false,
    );
    assert.equal(
      remainingFiles.includes("site-999-2026-04-01T00-00-00-000Z.json"),
      true,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function restoreEnv(previousEnv: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function readFileNames(dirPath: string): Promise<string[]> {
  return readdir(dirPath);
}
