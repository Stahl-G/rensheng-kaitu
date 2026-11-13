import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { Context } from "@deepseek-ai/cordis";
import { buildPhoneToday, observePhoneConsumer, phoneConsumerStatus, readOverviewPage } from "@kaitu/core";
import { expect, it } from "vitest";
import { productRequest } from "../../cli/src/ui/product.js";
import { clonedWorkspace } from "../../core/test/helpers.js";
import { KaituOverviewService } from "../src/overview-service.js";

it("desktop transports select only a known local consumer and preserve the setting across service instances", async () => {
  const ws = await clonedWorkspace();
  const ctx = new Context();
  try {
    const local = phoneConsumerStatus(ws);
    const other = randomUUID();
    const snapshot = buildPhoneToday(await readOverviewPage(ws), new Date().toISOString(), ws);
    observePhoneConsumer(
      ws,
      JSON.stringify({ ...snapshot, generator: { kind: "computer", device_id: other } }),
    );
    const service = new KaituOverviewService(ctx, { workspace: ws.root });
    expect((await service.organizerSeen()).consumer.paused).toBe(true);
    expect(await productRequest(ws, "selectPhoneConsumer", [local.deviceId])).toMatchObject({
      consumer: { selectedDeviceId: local.deviceId, paused: false },
    });
    expect((await service.selectPhoneConsumer(other)).consumer).toMatchObject({
      selectedDeviceId: other,
      paused: true,
    });
    await expect(service.selectPhoneConsumer(randomUUID())).rejects.toThrow("Unknown computer");
    await expect(productRequest(ws, "selectPhoneConsumer", [randomUUID()])).rejects.toThrow(
      "Unknown computer",
    );
    expect(phoneConsumerStatus(ws)).toMatchObject({ selectedDeviceId: other, paused: true });
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
