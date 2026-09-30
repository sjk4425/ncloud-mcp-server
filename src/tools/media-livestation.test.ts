import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerLiveStationTools } from "./media-livestation.js";

/**
 * Live Station — 경로는 공식 가이드 원문(media-livestation-*) 기준:
 *   GET  /api/v2/channels, /api/v2/qualitySets, PUT /channels/{id}/on|off, /startRecord|/stopRecord.
 * 금융존은 같은 호스트(livestation.apigw.ntruss.com)에 접두 /api/fin-v2 (api-fin, 2026-09-30).
 */
function setup(zone?: "pub" | "fin") {
  const server = new McpServer({ name: "t", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl: "https://livestation.apigw.ntruss.com", regionCode: zone === "fin" ? "FKR" : "KR" });
  registerLiveStationTools(server, client, zone ? { zone } : {});
  const tools = (server as any)._registeredTools;
  const entry = (name: string) => (tools instanceof Map ? tools.get(name) : tools[name]);
  return { client, call: (n: string, a: any) => entry(n).handler(entry(n).inputSchema.parse(a), {} as any) };
}

describe("Live Station: 가이드 경로", () => {
  it("pub: on/off, startRecord/stopRecord, qualitySets", async () => {
    const s = setup();
    const get = vi.spyOn(s.client, "request").mockResolvedValue({});
    const put = vi.spyOn(s.client, "putRequest").mockResolvedValue({});
    await s.call("ncloud_livestation_list_channels", {});
    expect(get.mock.calls[0][0]).toBe("/api/v2/channels");
    await s.call("ncloud_livestation_list_quality_settings", {});
    expect(get.mock.calls[1][0]).toBe("/api/v2/qualitySets");
    await s.call("ncloud_livestation_resume_channel", { channelId: "ls-1" });
    expect(put.mock.calls[0][0]).toBe("/api/v2/channels/ls-1/on");
    await s.call("ncloud_livestation_stop_channel", { channelId: "ls-1", confirm: true });
    expect(put.mock.calls[1][0]).toBe("/api/v2/channels/ls-1/off");
    await s.call("ncloud_livestation_start_record", { channelId: "ls-1" });
    expect(put.mock.calls[2][0]).toBe("/api/v2/channels/ls-1/startRecord");
    await s.call("ncloud_livestation_stop_record", { channelId: "ls-1" });
    expect(put.mock.calls[3][0]).toBe("/api/v2/channels/ls-1/stopRecord");
  });
  it("fin: 모든 경로가 /api/fin-v2 접두를 쓴다", async () => {
    const s = setup("fin");
    const get = vi.spyOn(s.client, "request").mockResolvedValue({});
    const put = vi.spyOn(s.client, "putRequest").mockResolvedValue({});
    const del = vi.spyOn(s.client, "deleteRequest").mockResolvedValue({});
    await s.call("ncloud_livestation_list_channels", { pageNo: 1 });
    expect(get.mock.calls[0][0]).toBe("/api/fin-v2/channels");
    await s.call("ncloud_livestation_get_service_url", { channelId: "ls-1" });
    expect(get.mock.calls[1][0]).toBe("/api/fin-v2/channels/ls-1/serviceUrls");
    await s.call("ncloud_livestation_start_record", { channelId: "ls-1" });
    expect(put.mock.calls[0][0]).toBe("/api/fin-v2/channels/ls-1/startRecord");
    await s.call("ncloud_livestation_delete_channel", { channelId: "ls-1", confirm: true });
    expect(del.mock.calls[0][0]).toBe("/api/fin-v2/channels/ls-1");
  });
});
