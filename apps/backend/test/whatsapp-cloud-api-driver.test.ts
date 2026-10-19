import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryUserRepository } from "../src/infrastructure/persistence/in-memory-repositories.js";
import { WhatsAppCloudApiDriver } from "../src/infrastructure/channels/whatsapp/whatsapp-cloud-api-driver.js";
import type { InboundEvent } from "../src/ports/channels.js";

const APP_SECRET = "test-app-secret";
const options = {
  accessToken: "test-access-token",
  appSecret: APP_SECRET,
  verifyToken: "test-verify-token",
  phoneNumberId: "123456789",
  apiVersion: "v23.0"
};

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))
  ));
});

const listen = async (driver: WhatsAppCloudApiDriver): Promise<string> => {
  const server = createServer((req, res) => {
    void driver.handleHttpRequest(req, res).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP test server address.");
  return `http://127.0.0.1:${address.port}`;
};

const signedHeaders = (body: string) => ({
  "content-type": "application/json",
  "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`
});

const webhookBody = (id = "wamid.1", text = "hello") => JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{
    changes: [{
      value: {
        messages: [{
          id,
          from: "1 (555) 010-1234",
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: text }
        }]
      }
    }]
  }]
});

describe("WhatsApp Cloud API driver", () => {
  it("verifies webhook setup only with the configured verify token", async () => {
    const driver = new WhatsAppCloudApiDriver(options);
    const origin = await listen(driver);
    const accepted = await fetch(`${origin}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge`);
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toBe("challenge");

    const rejected = await fetch(`${origin}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge`);
    expect(rejected.status).toBe(403);
  });

  it("verifies webhook signatures, maps inbound messages, and deduplicates retries", async () => {
    const driver = new WhatsAppCloudApiDriver(options);
    const received: InboundEvent[] = [];
    await driver.start(async (event) => { received.push(event); });
    const origin = await listen(driver);
    const body = webhookBody();

    const invalid = await fetch(`${origin}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });
    expect(invalid.status).toBe(401);

    const first = await fetch(`${origin}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: signedHeaders(body),
      body
    });
    const retry = await fetch(`${origin}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: signedHeaders(body),
      body
    });
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      kind: "message",
      channel: "whatsapp",
      identity: { externalId: "15550101234" },
      externalMessageId: "wamid.1",
      content: { kind: "text", text: "hello" }
    });
  });

  it("sends authenticated Cloud API text only within the user messaging window", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), { status: 200 });
    };
    const driver = new WhatsAppCloudApiDriver(options, fetcher);
    await driver.start(async () => {});
    const origin = await listen(driver);
    const body = webhookBody();
    const inbound = await fetch(`${origin}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: signedHeaders(body),
      body
    });
    expect(inbound.status).toBe(200);

    const id = await driver.sendMessage(
      { channel: "whatsapp", externalId: "15550101234" },
      { kind: "text", text: "<b>hello</b>", format: "html" }
    );
    expect(id).toBe("wamid.out");
    expect(requestUrl).toBe("https://graph.facebook.com/v23.0/123456789/messages");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer test-access-token");
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      messaging_product: "whatsapp",
      to: "15550101234",
      type: "text",
      text: { body: "hello" }
    });
    await expect(driver.sendMessage(
      { channel: "whatsapp", externalId: "15550101234" },
      { kind: "media", media: { kind: "sticker", mimeType: "image/webp", bytes: new Uint8Array([1, 2, 3]) } }
    )).rejects.toThrow(/valid WebP image data/);

    await expect(driver.sendMessage(
      { channel: "whatsapp", externalId: "15550000000" },
      { kind: "text", text: "not opted in" }
    )).rejects.toThrow(/within the past 24 hours/);
  });

  it("downloads inbound Cloud API media through the authenticated Meta media endpoint", async () => {
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input) === "https://graph.facebook.com/v23.0/media-id") {
        return new Response(JSON.stringify({
          url: "https://lookaside.fbsbx.com/whatsapp/attachment",
          mime_type: "image/jpeg",
          file_size: 3
        }), { status: 200 });
      }
      expect(String(input)).toBe("https://lookaside.fbsbx.com/whatsapp/attachment");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-access-token");
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3" }
      });
    };
    const driver = new WhatsAppCloudApiDriver(options, fetcher);
    const resolved = await driver.resolveMedia({
      kind: "image",
      channelRef: "media-id",
      mimeType: "image/jpeg"
    });
    expect(resolved.channelRef).toBeUndefined();
    expect(resolved.mimeType).toBe("image/jpeg");
    expect([...resolved.bytes!]).toEqual([1, 2, 3]);
  });

  it("persists the customer-service window across adapter restarts", async () => {
    const users = new InMemoryUserRepository();
    const identity = await users.findOrCreate({ channel: "whatsapp", externalId: "15550101234" });
    await users.saveProfile({
      userId: identity.userId,
      gender: "nonbinary",
      country: "Nigeria",
      preferredGender: "any"
    });
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), { status: 200 });

    const firstDriver = new WhatsAppCloudApiDriver(options, fetcher, users);
    await firstDriver.start(async () => {});
    const firstOrigin = await listen(firstDriver);
    const body = webhookBody("wamid.persist");
    const response = await fetch(`${firstOrigin}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: signedHeaders(body),
      body
    });
    expect(response.status).toBe(200);
    await firstDriver.stop();

    const restartedDriver = new WhatsAppCloudApiDriver(options, fetcher, users);
    await expect(restartedDriver.sendMessage(
      { channel: "whatsapp", externalId: "15550101234" },
      { kind: "text", text: "response after restart" }
    )).resolves.toBe("wamid.out");
  });

  it("requires complete Cloud API credentials and an explicit Graph version", () => {
    expect(() => new WhatsAppCloudApiDriver({ ...options, apiVersion: "" })).toThrow(/WHATSAPP_CLOUD_API_VERSION/);
    expect(() => new WhatsAppCloudApiDriver({ ...options, accessToken: "" })).toThrow(/access token/);
  });
});
