import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";
import { liveStationPathPrefix, type Zone } from "../client/endpoints.js";

// Live Station API — 공식 docs media-livestation-* (민간존·금융존; 공공존 미제공).
// 호스트는 두 존 모두 livestation.apigw.ntruss.com, 경로 접두만 다르다(민간존 /api/v2, 금융존 /api/fin-v2).
// 경로는 가이드 원문 기준: channels/{id}/on|off, /startRecord|/stopRecord, /qualitySets (2026-09-30 대조).

export interface LiveStationToolOptions {
  /** 존 — 경로 접두 선택. 기본 `public`. */
  zone?: Zone;
}

export function registerLiveStationTools(server: McpServer, client: NcloudClient, opts: LiveStationToolOptions = {}): void {
  const zone: Zone = opts.zone ?? "pub";
  const P = liveStationPathPrefix(zone);
  // ─── Channel Query Tools ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_livestation_list_channels",
    "List all Live Station streaming channels with pagination",
    {
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSizeNo: z.number().optional().describe("Number of items per page (default: 20)"),
    },
    async (params) => {
      return client.request(`${P}/channels`, params);
    }
  );

  defineTool(
    server,
    "ncloud_livestation_get_channel",
    "Get detailed information about a specific Live Station channel including streaming URLs and CDN settings",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("Channel ID (e.g., ls-20250820xxxxxx)"),
    },
    async (params) => {
      return client.request(`${P}/channels/${params.channelId}`);
    }
  );

  // ─── Channel Create Tool ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_livestation_create_channel",
    "Create a new Live Station channel for live streaming. Use dryRun=true to preview without creating.",
    {
      channelName: z.string({ required_error: requiredError("channelName") }).describe("Channel name (3-20 chars, Korean/English/numbers/_)"),
      envType: z.enum(["REAL", "DEV", "STAGE"]).optional().default("REAL").describe("Channel environment type"),
      outputProtocol: z.enum(["HLS", "LL_HLS", "HLS,DASH"]).optional().default("HLS").describe("Output protocol: HLS, LL_HLS (low-latency), or HLS,DASH (both)"),
      createCdn: z.boolean({ required_error: requiredError("createCdn") }).describe("Whether to create a new CDN (true) or use existing (false)"),
      cdnProfileId: z.number({ required_error: requiredError("cdnProfileId") }).describe("Global Edge profile ID"),
      cdnRegionType: z.enum(["KOREA", "JAPAN", "GLOBAL"]).optional().describe("CDN service region (required when createCdn=true)"),
      cdnDomain: z.string().optional().describe("Existing Global Edge domain (required when createCdn=false)"),
      cdnInstanceNo: z.number().optional().describe("Existing Global Edge instance ID (required when createCdn=false)"),
      qualitySetId: z.number({ required_error: requiredError("qualitySetId") }).describe("Image quality setting ID (from quality settings list)"),
      useDvr: z.boolean({ required_error: requiredError("useDvr") }).describe("Time machine (DVR) setting: true to enable rewind"),
      timemachineMin: z.number().optional().describe("Time machine allowance in minutes (360, required if useDvr=true)"),
      immediateOnAir: z.boolean().optional().default(false).describe("Auto-recording on stream start"),
      recordType: z.enum(["NO_RECORD", "AUTO_UPLOAD", "MANUAL_UPLOAD"]).optional().default("NO_RECORD").describe("Recording storage type"),
      recordFormat: z.enum(["MP4", "HLS", "ALL"]).optional().describe("Recording file format (required if recordType=AUTO_UPLOAD)"),
      recordBucketName: z.string().optional().describe("Recording storage bucket (required if recordType=AUTO_UPLOAD)"),
      recordFilePath: z.string().optional().describe("Recording storage path (required if recordType=AUTO_UPLOAD)"),
      isStreamFailOver: z.boolean().optional().default(false).describe("Whether to enable streaming redundancy"),
      drmEnabledYn: z.boolean().optional().default(false).describe("Whether to enable Multi DRM"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the channel"),
    },
    async (params) => {
      const body: any = {
        channelName: params.channelName,
        envType: params.envType,
        outputProtocol: params.outputProtocol,
        cdn: {
          createCdn: params.createCdn,
          cdnType: "GLOBAL_EDGE",
          profileId: params.cdnProfileId,
          regionType: params.cdnRegionType,
          cdnDomain: params.cdnDomain,
          cdnInstanceNo: params.cdnInstanceNo,
        },
        qualitySetId: params.qualitySetId,
        useDvr: params.useDvr,
        immediateOnAir: params.immediateOnAir,
        record: {
          type: params.recordType,
          format: params.recordFormat,
          bucketName: params.recordBucketName,
          filePath: params.recordFilePath,
        },
        isStreamFailOver: params.isStreamFailOver,
        drmEnabledYn: params.drmEnabledYn,
      };
      if (params.useDvr && params.timemachineMin) {
        body.timemachineMin = params.timemachineMin;
      }

      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Live Station Channel Creation",
          endpoint: `${P}/channels`,
          method: "POST",
          requestParams: body,
          noun: { ko: "채널", en: "channel" },
        });
      }

      const result = await client.postRequest(`${P}/channels`, body);
      const channel = result?.content || result;
      const summary = {
        리소스타입: "Live Station Channel",
        채널ID: channel?.channelId || channel?.id || "creating",
        채널명: params.channelName,
        프로토콜: params.outputProtocol,
        DVR: params.useDvr,
        녹화: params.recordType,
        상태: channel?.channelStatus || "CREATING",
      };
      return summary;
    }
  );

  // ─── Channel Delete Tool ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_livestation_delete_channel",
    "⚠️ Destructive: Permanently terminate a Live Station channel. End broadcast streaming before terminating. Set confirm=true to execute.",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("Channel ID to terminate"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.deleteRequest(`${P}/channels/${params.channelId}`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently terminate Live Station Channel [${params.channelId}]. Created snapshots will also be deleted. The integrated CDN will be maintained.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Quality Settings Tools ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_livestation_list_quality_settings",
    "List available image quality settings for Live Station channels",
    {
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSizeNo: z.number().optional().describe("Number of items per page (default: 20)"),
    },
    async (params) => {
      // 가이드 경로는 /qualitySets (media-livestation-qualitysetting-qualitysettinglist) — 예전 /quality-sets 는 잘못된 경로였다.
      return client.request(`${P}/qualitySets`, params);
    }
  );

  // ─── Service URL Tool ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_livestation_get_service_url",
    "Get the streaming service URLs (publish/play) for a Live Station channel",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("Channel ID to get service URLs for"),
    },
    async (params) => {
      return client.request(`${P}/channels/${params.channelId}/serviceUrls`);
    }
  );

  // ─── Channel Operation Tools ─────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_livestation_stop_channel",
    "⚠️ Destructive: Stop a Live Station channel. The channel will be suspended and streaming will be interrupted. Set confirm=true to execute.",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("Channel ID to stop"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      // 가이드 경로는 /off (media-livestation-channel-channeloff) — 예전 /stop 은 잘못된 경로였다.
      const result = await client.putRequest(`${P}/channels/${params.channelId}/off`, {});
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will stop Live Station Channel [${params.channelId}]. Streaming will be interrupted.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_livestation_resume_channel",
    "Resume a stopped Live Station channel to make it active again for streaming",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("Channel ID to resume"),
    },
    async (params) => {
      // 가이드 경로는 /on (media-livestation-channel-channelon) — 예전 /resume 은 잘못된 경로였다.
      return client.putRequest(`${P}/channels/${params.channelId}/on`, {});
    }
  );

  defineTool(
    server,
    "ncloud_livestation_update_channel",
    "Update configuration of a Live Station channel (CDN, quality, recording, DVR settings)",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("Channel ID to update"),
      channelName: z.string().optional().describe("New channel name (3-20 chars)"),
      qualitySetId: z.number().optional().describe("New image quality setting ID"),
      useDvr: z.boolean().optional().describe("Time machine (DVR) setting"),
      timemachineMin: z.number().optional().describe("Time machine allowance in minutes (360)"),
      immediateOnAir: z.boolean().optional().describe("Auto-recording on stream start"),
      recordType: z.enum(["NO_RECORD", "AUTO_UPLOAD", "MANUAL_UPLOAD"]).optional().describe("Recording storage type"),
      recordFormat: z.enum(["MP4", "HLS", "ALL"]).optional().describe("Recording file format"),
      recordBucketName: z.string().optional().describe("Recording storage bucket"),
      recordFilePath: z.string().optional().describe("Recording storage path"),
      isStreamFailOver: z.boolean().optional().describe("Whether to enable streaming redundancy"),
      drmEnabledYn: z.boolean().optional().describe("Whether to enable Multi DRM"),
    },
    async (params) => {
      const { channelId, ...updateFields } = params;
      const body: any = {};
      if (updateFields.channelName !== undefined) body.channelName = updateFields.channelName;
      if (updateFields.qualitySetId !== undefined) body.qualitySetId = updateFields.qualitySetId;
      if (updateFields.useDvr !== undefined) body.useDvr = updateFields.useDvr;
      if (updateFields.timemachineMin !== undefined) body.timemachineMin = updateFields.timemachineMin;
      if (updateFields.immediateOnAir !== undefined) body.immediateOnAir = updateFields.immediateOnAir;
      if (updateFields.isStreamFailOver !== undefined) body.isStreamFailOver = updateFields.isStreamFailOver;
      if (updateFields.drmEnabledYn !== undefined) body.drmEnabledYn = updateFields.drmEnabledYn;
      if (updateFields.recordType !== undefined) {
        body.record = {
          type: updateFields.recordType,
          format: updateFields.recordFormat,
          bucketName: updateFields.recordBucketName,
          filePath: updateFields.recordFilePath,
        };
      }
      const result = await client.putRequest(`${P}/channels/${channelId}`, body);
      return result;
    }
  );

  // ─── Channel Record Control ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_livestation_start_record",
    "Start manual recording for a Live Station channel that is currently streaming",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("Channel ID to start recording"),
    },
    async (params) => {
      // 가이드 경로는 /startRecord (media-livestation-recording-recordingstart) — 예전 /record/start 는 잘못된 경로였다.
      return client.putRequest(`${P}/channels/${params.channelId}/startRecord`, {});
    }
  );

  defineTool(
    server,
    "ncloud_livestation_stop_record",
    "Stop manual recording for a Live Station channel",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("Channel ID to stop recording"),
    },
    async (params) => {
      // 가이드 경로는 /stopRecord (media-livestation-recording-recordingstop).
      return client.putRequest(`${P}/channels/${params.channelId}/stopRecord`, {});
    }
  );

  // ─── Stream switch ────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_livestation_switch_stream",
    "Switch the active input stream of a Live Station channel to its standby stream (channel-stream-switch).",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("Channel ID whose stream to switch"),
    },
    async (params) => {
      // 가이드 channel-stream-switch: PUT /api/v2/channels/{channelId}/switch-stream (민간·금융). 금융존 페이지는 /api/v2 로 적혀 있지만
      // 금융존 Live Station 의 다른 모든 op 가 /api/fin-v2 를 쓰므로(api-fin media-livestation 개요) 같은 접두 P 를 쓴다 — 가이드 표기 불일치 가능.
      return client.putRequest(`${P}/channels/${params.channelId}/switch-stream`, {});
    }
  );

  // ─── VOD-to-Live channels (${P}/vod/channels) ─────────────────────────────
  // 가이드: media-livestation-channel-vodchannel{list,info,create,update,delete,on,off} · media-livestation-channel-vodserviceurl (민간),
  //   금융존은 같은 op 가 /api/fin-v2/vod/channels 아래에 있고 생성만 슬러그가 `vod-to-live-management`.
  const VOD = `${P}/vod/channels`;
  const fin = zone === "fin";

  defineTool(
    server,
    "ncloud_livestation_list_vod_channels",
    "List Live Station VOD-to-Live channels (vodchannellist) with pagination.",
    {
      pageNo: z.number().optional().describe("Page number (1-N)"),
      pageSizeNo: z.number().optional().describe("Number of items per page (1-100)"),
    },
    async (params) => {
      return client.request(VOD, params);
    }
  );

  defineTool(
    server,
    "ncloud_livestation_get_vod_channel",
    "Get details of a Live Station VOD-to-Live channel (vodchannelinfo).",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("VOD-to-Live channel ID (see ncloud_livestation_list_vod_channels)"),
    },
    async (params) => {
      return client.request(`${VOD}/${params.channelId}`);
    }
  );

  defineTool(
    server,
    "ncloud_livestation_create_vod_channel",
    fin
      ? "Create a Live Station VOD-to-Live channel (Financial zone: vod-to-live-management). CDN is CDN+ — set createCdn=false with cdnInstanceNo to reuse an existing CDN+ instance. Use dryRun=true to preview."
      : "Create a Live Station VOD-to-Live channel (vodchannelcreate). CDN is Global Edge — give profileId, and either createCdn=true with regionType or createCdn=false with cdnDomain + cdnInstanceNo. Use dryRun=true to preview.",
    {
      channelName: z.string({ required_error: requiredError("channelName") }).describe("Channel name (3-20 chars: Korean, letters, digits, '_')"),
      createCdn: z.boolean({ required_error: requiredError("createCdn") }).describe("true to create a new CDN, false to use an existing one"),
      cdnType: fin
        ? z.enum(["CDN_PLUS"]).optional().default("CDN_PLUS").describe("CDN type (Financial zone: CDN_PLUS)")
        : z.enum(["GLOBAL_EDGE"]).optional().default("GLOBAL_EDGE").describe("CDN type (Public zone: GLOBAL_EDGE)"),
      profileId: fin
        ? z.number().optional().describe("Not used in the Financial zone (CDN+ has no profile)")
        : z.number().optional().describe("Global Edge profile ID (required; see ncloud_edge_list_profiles)"),
      cdnDomain: z.string().optional().describe("Existing CDN domain (required when createCdn=false in the Public zone; see ncloud_edge_list_edges)"),
      cdnInstanceNo: z.number().optional().describe("Existing CDN instance number (required when createCdn=false)"),
      regionType: z.enum(["KOREA", "JAPAN", "GLOBAL"]).optional().describe("Global Edge service region (required when createCdn=true in the Public zone)"),
      qualitySetId: z.number({ required_error: requiredError("qualitySetId") }).describe("Quality set ID (see ncloud_livestation_list_quality_settings; pick a Low Latency set for LL_HLS)"),
      envType: z.enum(["REAL", "DEV", "STAGE"]).optional().describe("Channel environment type (default REAL)"),
      outputProtocol: z.enum(["HLS", "LL_HLS", "HLS,DASH"]).optional().describe("Output protocol (default HLS)"),
      drmEnabledYn: z.boolean().optional().describe("Enable Multi DRM (Public zone; required there — defaults to false)"),
      drmSiteId: z.string().optional().describe("Multi DRM site ID (required when drmEnabledYn=true; see ncloud_drm_list_sites)"),
      drmContentId: z.string().optional().describe("Multi DRM content ID (3-100 chars: letters, digits, '-', '_'; required when drmEnabledYn=true)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without creating"),
    },
    async (params) => {
      const cdn: Record<string, unknown> = { createCdn: params.createCdn, cdnType: params.cdnType };
      if (!fin) {
        if (params.profileId === undefined) {
          return { content: [{ type: "text" as const, text: "profileId is required in the Public zone (Global Edge profile)." }], isError: true };
        }
        cdn.profileId = params.profileId;
        if (params.createCdn) {
          if (!params.regionType) {
            return { content: [{ type: "text" as const, text: "regionType is required when createCdn=true." }], isError: true };
          }
          cdn.regionType = params.regionType;
        } else {
          if (!params.cdnDomain || params.cdnInstanceNo === undefined) {
            return { content: [{ type: "text" as const, text: "cdnDomain and cdnInstanceNo are required when createCdn=false." }], isError: true };
          }
          cdn.cdnDomain = params.cdnDomain;
          cdn.cdnInstanceNo = params.cdnInstanceNo;
        }
      } else {
        if (!params.createCdn) {
          if (params.cdnInstanceNo === undefined) {
            return { content: [{ type: "text" as const, text: "cdnInstanceNo is required when createCdn=false." }], isError: true };
          }
          cdn.cdnInstanceNo = params.cdnInstanceNo;
          if (params.cdnDomain) cdn.cdnDomain = params.cdnDomain;
        }
      }
      const body: Record<string, unknown> = { channelName: params.channelName, cdn, qualitySetId: params.qualitySetId };
      if (params.envType !== undefined) body.envType = params.envType;
      if (params.outputProtocol !== undefined) body.outputProtocol = params.outputProtocol;
      if (!fin) {
        const drmEnabled = params.drmEnabledYn === true;
        body.drmEnabledYn = drmEnabled;
        if (drmEnabled) {
          if (!params.drmSiteId || !params.drmContentId) {
            return { content: [{ type: "text" as const, text: "drmSiteId and drmContentId are required when drmEnabledYn=true." }], isError: true };
          }
          body.drm = { siteId: params.drmSiteId, contentId: params.drmContentId };
        }
      }

      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Live Station VOD-to-Live Channel Creation",
          endpoint: VOD,
          method: "POST",
          requestParams: body,
          noun: { ko: "VOD-to-Live 채널", en: "VOD-to-Live channel" },
        });
      }
      const result = await client.postRequest(VOD, body);
      const channel = result?.content || result;
      return {
        리소스타입: "Live Station VOD-to-Live Channel",
        채널ID: channel?.channelId || channel?.id || "creating",
        채널명: params.channelName,
        프로토콜: params.outputProtocol ?? "HLS",
        상태: channel?.channelStatus || "CREATING",
      };
    }
  );

  defineTool(
    server,
    "ncloud_livestation_update_vod_channel",
    "Update a Live Station VOD-to-Live channel's name, environment type or output protocol (vodchannelupdate).",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("VOD-to-Live channel ID"),
      channelName: z.string({ required_error: requiredError("channelName") }).describe("Channel name (3-20 chars: Korean, letters, digits, '_') — required by the API even when unchanged"),
      envType: z.enum(["REAL", "DEV", "STAGE"]).optional().describe("Channel environment type"),
      outputProtocol: z.enum(["HLS", "LL_HLS", "HLS,DASH"]).optional().describe("Output protocol"),
    },
    async (params) => {
      const body: Record<string, unknown> = { channelName: params.channelName };
      if (params.envType !== undefined) body.envType = params.envType;
      if (params.outputProtocol !== undefined) body.outputProtocol = params.outputProtocol;
      return client.putRequest(`${VOD}/${params.channelId}`, body);
    }
  );

  defineTool(
    server,
    "ncloud_livestation_delete_vod_channel",
    "⚠️ Destructive: Permanently delete a Live Station VOD-to-Live channel (vodchanneldelete). Set confirm=true to execute.",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("VOD-to-Live channel ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      return client.deleteRequest(`${VOD}/${params.channelId}`);
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Live Station VOD-to-Live Channel [${params.channelId}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_livestation_start_vod_channel",
    "Turn a Live Station VOD-to-Live channel on (vodchannelon).",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("VOD-to-Live channel ID to turn on"),
    },
    async (params) => {
      return client.putRequest(`${VOD}/${params.channelId}/on`, {});
    }
  );

  defineTool(
    server,
    "ncloud_livestation_stop_vod_channel",
    "⚠️ Destructive: Turn a Live Station VOD-to-Live channel off (vodchanneloff); playback is interrupted. Set confirm=true to execute.",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("VOD-to-Live channel ID to turn off"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      return client.putRequest(`${VOD}/${params.channelId}/off`, {});
    },
    { destructive: { message: (params) => `⚠️ This will turn off Live Station VOD-to-Live Channel [${params.channelId}]. Playback will be interrupted.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_livestation_get_vod_service_url",
    "Get the playback (GENERAL: HLS / MPEG-DASH) or thumbnail (THUMBNAIL) service URLs of a Live Station VOD-to-Live channel (vodserviceurl).",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("VOD-to-Live channel ID"),
      serviceUrlType: z.enum(["GENERAL", "THUMBNAIL"], { required_error: requiredError("serviceUrlType") }).describe("GENERAL for playback URLs, THUMBNAIL for thumbnail image URLs (required)"),
    },
    async (params) => {
      return client.request(`${VOD}/${params.channelId}/serviceUrls`, { serviceUrlType: params.serviceUrlType });
    }
  );
}
