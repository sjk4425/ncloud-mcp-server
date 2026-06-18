import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { dryRunMessage, requiredError } from "./_messages.js";

export function registerLiveStationTools(server: McpServer, client: NcloudClient): void {
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
      return client.request("/api/v2/channels", params);
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
      return client.request(`/api/v2/channels/${params.channelId}`);
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
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: Live Station Channel Creation",
          channelName: params.channelName,
          envType: params.envType,
          outputProtocol: params.outputProtocol,
          createCdn: params.createCdn,
          cdnProfileId: params.cdnProfileId,
          cdnRegionType: params.cdnRegionType,
          qualitySetId: params.qualitySetId,
          useDvr: params.useDvr,
          recordType: params.recordType,
          isStreamFailOver: params.isStreamFailOver,
          drmEnabledYn: params.drmEnabledYn,
          message: dryRunMessage({ ko: "채널", en: "channel" }),
        };
        return preview;
      }

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

      const result = await client.postRequest("/api/v2/channels", body);
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
      const result = await client.deleteRequest(`/api/v2/channels/${params.channelId}`);
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
      return client.request("/api/v2/quality-sets", params);
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
      return client.request(`/api/v2/channels/${params.channelId}/serviceUrls`);
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
      const result = await client.putRequest(`/api/v2/channels/${params.channelId}/stop`, {});
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
      return client.putRequest(`/api/v2/channels/${params.channelId}/resume`, {});
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
      const result = await client.putRequest(`/api/v2/channels/${channelId}`, body);
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
      return client.putRequest(`/api/v2/channels/${params.channelId}/record/start`, {});
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
      return client.putRequest(`/api/v2/channels/${params.channelId}/record/stop`, {});
    }
  );
}
