import { describe, expect, it } from "vitest";
import { WebChannelDriver } from "../src/infrastructure/channels/web/web-channel-driver.js";
import type { InboundEvent } from "../src/ports/channels.js";
import { InMemoryUserRepository } from "../src/infrastructure/persistence/in-memory-repositories.js";

const baseUrl = (driver: WebChannelDriver) => `http://127.0.0.1:${driver.port}`;

describe("web channel driver", () => {
  it("maps POST /api/send text into a message event", async () => {
    const driver = new WebChannelDriver({ port: 0 });
    const received: InboundEvent[] = [];
    await driver.start(async (event) => { received.push(event); });
    try {
      const res = await fetch(`${baseUrl(driver)}/api/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: "alice", text: "hello" })
      });
      expect(res.status).toBe(204);
      expect(received).toHaveLength(1);
      expect(received[0].kind).toBe("message");
      if (received[0].kind === "message") {
        expect(received[0].identity.externalId).toBe("alice");
        expect(received[0].content.text).toBe("hello");
      }
    } finally {
      await driver.stop();
    }
  });

  it("maps /commands into command events", async () => {
    const driver = new WebChannelDriver({ port: 0 });
    const received: InboundEvent[] = [];
    await driver.start(async (event) => { received.push(event); });
    try {
      await fetch(`${baseUrl(driver)}/api/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: "alice", text: "/find" })
      });
      expect(received[0].kind).toBe("command");
      if (received[0].kind === "command") expect(received[0].command).toBe("find");
    } finally {
      await driver.stop();
    }
  });

  it("maps actionId into an action event", async () => {
    const driver = new WebChannelDriver({ port: 0 });
    const received: InboundEvent[] = [];
    await driver.start(async (event) => { received.push(event); });
    try {
      await fetch(`${baseUrl(driver)}/api/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: "alice", actionId: "confirm-adult" })
      });
      expect(received[0].kind).toBe("action");
      if (received[0].kind === "action") expect(received[0].actionId).toBe("confirm-adult");
    } finally {
      await driver.stop();
    }
  });

  it("maps an uploaded web attachment into a media message event", async () => {
    const driver = new WebChannelDriver({ port: 0 });
    const received: InboundEvent[] = [];
    await driver.start(async (event) => { received.push(event); });
    try {
      const res = await fetch(`${baseUrl(driver)}/api/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user: "alice",
          media: { kind: "image", mimeType: "image/png", filename: "photo.png", base64: "AQID" }
        })
      });
      expect(res.status).toBe(204);
      expect(received[0].kind).toBe("message");
      if (received[0].kind === "message" && received[0].content.kind === "media") {
        expect(received[0].content.media).toMatchObject({ kind: "image", mimeType: "image/png", filename: "photo.png" });
        expect([...received[0].content.media.bytes!]).toEqual([1, 2, 3]);
      } else {
        throw new Error("Expected a media message event.");
      }
    } finally {
      await driver.stop();
    }
  });

  it("streams outbound media and message deletion events", async () => {
    const driver = new WebChannelDriver({ port: 0 });
    await driver.start(async () => {});
    const response = await fetch(`${baseUrl(driver)}/api/stream?user=alice`);
    const reader = response.body!.getReader();
    try {
      await reader.read();
      const messageId = await driver.sendMessage(
        { channel: "web", externalId: "alice" },
        { kind: "media", media: { kind: "image", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" } }
      );
      expect(messageId).toBeTruthy();
      const mediaFrame = new TextDecoder().decode((await reader.read()).value);
      expect(mediaFrame).toContain(`"messageId":"${messageId}"`);
      expect(mediaFrame).toContain("data:image/png;base64,AQID");

      await driver.deleteMessage({ channel: "web", externalId: "alice" }, messageId!);
      const deleteFrame = new TextDecoder().decode((await reader.read()).value);
      expect(deleteFrame).toContain('"kind":"delete"');
      expect(deleteFrame).toContain(`"messageId":"${messageId}"`);
    } finally {
      await reader.cancel();
      await driver.stop();
    }
  });

  it("rejects requests without user or payload", async () => {
    const driver = new WebChannelDriver({ port: 0 });
    await driver.start(async () => {});
    try {
      const res = await fetch(`${baseUrl(driver)}/api/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: "alice" })
      });
      expect(res.status).toBe(400);
    } finally {
      await driver.stop();
    }
  });

  it("routes non-web endpoints to the shared server handler", async () => {
    const driver = new WebChannelDriver({ port: 0 });
    await driver.start(async () => {}, (_req, res) => {
      res.statusCode = 200;
      res.end("admin route");
    });
    try {
      const res = await fetch(`${baseUrl(driver)}/api/state`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("admin route");
    } finally {
      await driver.stop();
    }
  });

  it("does not throw when sending outbound to a user with no connected clients", async () => {
    const driver = new WebChannelDriver({ port: 0 });
    await driver.start(async () => {});
    try {
      await driver.sendMessage({ channel: "web", externalId: "nobody" }, { kind: "text", text: "hi" });
    } finally {
      await driver.stop();
    }
  });

  it("registers and authenticates web accounts for sends and streams", async () => {
    const users = new InMemoryUserRepository();
    const driver = new WebChannelDriver({ port: 0 }, users);
    const received: InboundEvent[] = [];
    await driver.start(async (event) => { received.push(event); });
    try {
      const register = await fetch(`${baseUrl(driver)}/api/web/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "Chat_User", password: "some-long-password" })
      });
      expect(register.status).toBe(201);
      const account = await register.json() as { username: string; token: string };
      expect(account.username).toBe("chat_user");

      const denied = await fetch(`${baseUrl(driver)}/api/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: account.username, text: "not authenticated" })
      });
      expect(denied.status).toBe(401);

      const sent = await fetch(`${baseUrl(driver)}/api/send`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${account.token}`,
        },
        body: JSON.stringify({ user: account.username, text: "authenticated" })
      });
      expect(sent.status).toBe(204);
      expect(received[0].identity.externalId).toBe(account.username);

      const stream = await fetch(`${baseUrl(driver)}/api/stream?user=${account.username}&token=${encodeURIComponent(account.token)}`);
      expect(stream.status).toBe(200);
      await stream.body?.cancel();

      const login = await fetch(`${baseUrl(driver)}/api/web/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: account.username, password: "some-long-password" })
      });
      expect(login.status).toBe(200);

      const badLogin = await fetch(`${baseUrl(driver)}/api/web/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: account.username, password: "wrong-password" })
      });
      expect(badLogin.status).toBe(401);
    } finally {
      await driver.stop();
    }
  });
});