import assert from "node:assert/strict";
import test from "node:test";

import { PleasanterClient } from "../src/api.js";

test("PleasanterClient.getSite posts to the expected endpoint and returns Response.Data", async () => {
  const originalFetch = globalThis.fetch;
  let call: { url?: string; init?: RequestInit } = {};

  globalThis.fetch = async (url, init) => {
    call = { url: String(url), init };
    return new Response(
      JSON.stringify({
        Response: {
          Data: {
            TenantId: 1,
            SiteId: 123,
            Title: "Site",
          },
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  };

  try {
    const client = new PleasanterClient({
      baseUrl: "https://example.com/",
      siteId: 123,
      apiKey: "secret",
    });

    const site = await client.getSite();

    assert.equal(call.url, "https://example.com/api/items/123/getsite");
    assert.equal(call.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(call.init?.body ?? "{}")), {
      ApiVersion: 1.1,
      ApiKey: "secret",
    });
    assert.equal(site.Title, "Site");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PleasanterClient.updateSiteSettings surfaces API status code failures", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        StatusCode: 400,
        Message: "validation failed",
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );

  try {
    const client = new PleasanterClient({
      baseUrl: "https://example.com",
      siteId: 123,
      apiKey: "secret",
    });

    await assert.rejects(
      client.updateSiteSettings({ Scripts: [{ Id: 1 }] }),
      /updatesitesettings failed with status 400: validation failed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PleasanterClient throws on HTTP failures", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response("bad request", {
      status: 500,
      headers: {
        "content-type": "text/plain",
      },
    });

  try {
    const client = new PleasanterClient({
      baseUrl: "https://example.com",
      siteId: 123,
      apiKey: "secret",
    });

    await assert.rejects(
      client.getSite(),
      /getsite returned HTTP 500: bad request/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
