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

describe("Live Station: 스트림 전환·VOD-to-Live 채널 (channel-stream-switch, vodchannel*, vod-to-live-management)", () => {
  it("pub: switch-stream, /vod/channels 목록·상세·on/off·삭제·serviceUrls", async () => {
    const s = setup();
    const get = vi.spyOn(s.client, "request").mockResolvedValue({});
    const put = vi.spyOn(s.client, "putRequest").mockResolvedValue({});
    const del = vi.spyOn(s.client, "deleteRequest").mockResolvedValue({});
    await s.call("ncloud_livestation_switch_stream", { channelId: "ls-1" });
    expect(put.mock.calls[0]).toEqual(["/api/v2/channels/ls-1/switch-stream", {}]);
    await s.call("ncloud_livestation_list_vod_channels", { pageNo: 1, pageSizeNo: 10 });
    expect(get.mock.calls[0]).toEqual(["/api/v2/vod/channels", { pageNo: 1, pageSizeNo: 10 }]);
    await s.call("ncloud_livestation_get_vod_channel", { channelId: "ls-2" });
    expect(get.mock.calls[1][0]).toBe("/api/v2/vod/channels/ls-2");
    await s.call("ncloud_livestation_get_vod_service_url", { channelId: "ls-2", serviceUrlType: "THUMBNAIL" });
    expect(get.mock.calls[2]).toEqual(["/api/v2/vod/channels/ls-2/serviceUrls", { serviceUrlType: "THUMBNAIL" }]);
    await s.call("ncloud_livestation_start_vod_channel", { channelId: "ls-2" });
    expect(put.mock.calls[1]).toEqual(["/api/v2/vod/channels/ls-2/on", {}]);
    await s.call("ncloud_livestation_stop_vod_channel", { channelId: "ls-2", confirm: true });
    expect(put.mock.calls[2]).toEqual(["/api/v2/vod/channels/ls-2/off", {}]);
    await s.call("ncloud_livestation_update_vod_channel", { channelId: "ls-2", channelName: "vl2_mychannel", outputProtocol: "LL_HLS" });
    expect(put.mock.calls[3]).toEqual(["/api/v2/vod/channels/ls-2", { channelName: "vl2_mychannel", outputProtocol: "LL_HLS" }]);
    await s.call("ncloud_livestation_delete_vod_channel", { channelId: "ls-2", confirm: true });
    expect(del.mock.calls[0][0]).toBe("/api/v2/vod/channels/ls-2");
    const gated = await s.call("ncloud_livestation_stop_vod_channel", { channelId: "ls-2" });
    expect(gated.content[0].text).toContain("confirm=true");
    expect(put.mock.calls.length).toBe(4);
  });

  it("pub create: Global Edge cdn 객체(profileId·cdnDomain·cdnInstanceNo | regionType)와 drmEnabledYn/drm 을 가이드 형태로 보낸다", async () => {
    const s = setup();
    const post = vi.spyOn(s.client, "postRequest").mockResolvedValue({ content: { channelId: "ls-9", channelStatus: "CREATING" } });
    await s.call("ncloud_livestation_create_vod_channel", {
      channelName: "V2lTestChannel", createCdn: false, profileId: 4207, cdnDomain: "x.edge.naverncp.com", cdnInstanceNo: 11577,
      qualitySetId: 3, envType: "REAL", outputProtocol: "HLS", drmEnabledYn: true, drmSiteId: "drm-1", drmContentId: "my-Test-Multidrm",
    });
    expect(post.mock.calls[0]).toEqual(["/api/v2/vod/channels", {
      channelName: "V2lTestChannel",
      cdn: { createCdn: false, cdnType: "GLOBAL_EDGE", profileId: 4207, cdnDomain: "x.edge.naverncp.com", cdnInstanceNo: 11577 },
      qualitySetId: 3, envType: "REAL", outputProtocol: "HLS",
      drmEnabledYn: true, drm: { siteId: "drm-1", contentId: "my-Test-Multidrm" },
    }]);
    await s.call("ncloud_livestation_create_vod_channel", { channelName: "c2", createCdn: true, profileId: 1, regionType: "KOREA", qualitySetId: 3 });
    expect(post.mock.calls[1][1]).toEqual({ channelName: "c2", cdn: { createCdn: true, cdnType: "GLOBAL_EDGE", profileId: 1, regionType: "KOREA" }, qualitySetId: 3, drmEnabledYn: false });
    // 조건부 필수 검증: createCdn=false 인데 cdnDomain/cdnInstanceNo 없음 → API 호출 없이 isError
    const bad = await s.call("ncloud_livestation_create_vod_channel", { channelName: "c3", createCdn: false, profileId: 1, qualitySetId: 3 });
    expect(bad.isError).toBe(true);
    expect(post.mock.calls.length).toBe(2);
    const noProfile = await s.call("ncloud_livestation_create_vod_channel", { channelName: "c4", createCdn: true, regionType: "KOREA", qualitySetId: 3 });
    expect(noProfile.isError).toBe(true);
  });

  it("fin: /api/fin-v2/vod/channels, 생성은 CDN_PLUS + cdnInstanceNo(profileId·drm 없음)", async () => {
    const s = setup("fin");
    const get = vi.spyOn(s.client, "request").mockResolvedValue({});
    const put = vi.spyOn(s.client, "putRequest").mockResolvedValue({});
    const post = vi.spyOn(s.client, "postRequest").mockResolvedValue({});
    await s.call("ncloud_livestation_switch_stream", { channelId: "ls-1" });
    expect(put.mock.calls[0][0]).toBe("/api/fin-v2/channels/ls-1/switch-stream");
    await s.call("ncloud_livestation_list_vod_channels", {});
    expect(get.mock.calls[0][0]).toBe("/api/fin-v2/vod/channels");
    await s.call("ncloud_livestation_get_vod_service_url", { channelId: "ls-2", serviceUrlType: "GENERAL" });
    expect(get.mock.calls[1][0]).toBe("/api/fin-v2/vod/channels/ls-2/serviceUrls");
    await s.call("ncloud_livestation_create_vod_channel", { channelName: "V2lTestChannel", createCdn: false, cdnInstanceNo: 11577, qualitySetId: 3, envType: "REAL", outputProtocol: "HLS" });
    expect(post.mock.calls[0]).toEqual(["/api/fin-v2/vod/channels", {
      channelName: "V2lTestChannel", cdn: { createCdn: false, cdnType: "CDN_PLUS", cdnInstanceNo: 11577 }, qualitySetId: 3, envType: "REAL", outputProtocol: "HLS",
    }]);
    const bad = await s.call("ncloud_livestation_create_vod_channel", { channelName: "c", createCdn: false, qualitySetId: 3 });
    expect(bad.isError).toBe(true);
    expect(post.mock.calls.length).toBe(1);
  });
});
