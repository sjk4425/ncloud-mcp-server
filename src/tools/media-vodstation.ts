import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

export function registerVodStationTools(server: McpServer, client: NcloudClient): void {
  // ─── Channel Query Tools ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_vodstation_list_channels",
    "List all VOD Station streaming channels with pagination",
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
    "ncloud_vodstation_get_channel",
    "Get detailed information about a specific VOD Station channel",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("Channel ID (e.g., vs-20250821095732-xxxxxxx)"),
    },
    async (params) => {
      return client.request(`/api/v2/channels/${params.channelId}`);
    }
  );

  // ─── Channel Create Tool ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_vodstation_create_channel",
    "Create a new VOD Station streaming channel. Use dryRun=true to preview without creating.",
    {
      channelName: z.string({ required_error: requiredError("channelName") }).describe("Channel name (3-20 chars)"),
      storageBucketName: z.string({ required_error: requiredError("storageBucketName") }).describe("Object Storage bucket name containing video files"),
      protocolList: z.array(z.enum(["HLS", "DASH"])).optional().default(["HLS"]).describe("Streaming protocols (HLS, DASH)"),
      segmentDuration: z.number().optional().default(10).describe("Playback time per segment in seconds (default: 10)"),
      segmentDurationOption: z.enum(["BASIC", "VARIABLE"]).optional().default("BASIC").describe("Segmentation method: BASIC (regular intervals) or VARIABLE (keyframe-based)"),
      accessPrivateFiles: z.boolean().optional().default(false).describe("Whether to allow access to private files in the bucket"),
      createCdn: z.boolean().optional().default(true).describe("Whether to auto-create a Global Edge CDN"),
      cdnProfileId: z.number().optional().describe("Global Edge profile ID (required when createCdn=true)"),
      cdnRegionType: z.enum(["KOREA", "JAPAN", "GLOBAL"]).optional().describe("CDN service region (required when createCdn=true)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the channel"),
    },
    async (params) => {
      const body: any = {
        channelName: params.channelName,
        storageBucketName: params.storageBucketName,
        protocolList: params.protocolList,
        segmentDuration: params.segmentDuration,
        segmentDurationOption: params.segmentDurationOption,
        accessPrivateFiles: params.accessPrivateFiles,
        cdn: {
          createCdn: params.createCdn,
          cdnType: "GLOBAL_EDGE",
          profileId: params.cdnProfileId,
          regionType: params.cdnRegionType,
        },
      };

      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: VOD Station Channel Creation",
          endpoint: "/api/v2/channels",
          method: "POST",
          requestParams: body,
          noun: { ko: "채널", en: "channel" },
        });
      }

      const result = await client.postRequest("/api/v2/channels", body);
      const channel = result?.content || result;
      const summary = {
        리소스타입: "VOD Station Channel",
        채널ID: channel?.id || "creating",
        채널명: params.channelName,
        버킷: params.storageBucketName,
        프로토콜: params.protocolList,
        상태: channel?.channelStatus || "CREATING",
      };
      return summary;
    }
  );

  // ─── Channel Update Tool ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_vodstation_update_channel",
    "Update a VOD Station streaming channel's details (name, protocols, segment settings, encryption/DRM). This is a PUT that replaces the channel configuration, so provide the full desired state.",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("Channel ID to update (e.g., vs-20250821095732-xxxxxxx)"),
      channelName: z.string({ required_error: requiredError("channelName") }).describe("Channel name (3-20 chars, alphanumeric + hyphen). Sent as the API 'name' field"),
      protocolList: z.array(z.enum(["HLS", "DASH"]), { required_error: requiredError("protocolList") }).min(1).describe("Streaming protocols (HLS, DASH)"),
      segmentDuration: z.number({ required_error: requiredError("segmentDuration") }).describe("Playback seconds per segment (5-20)"),
      segmentDurationOption: z.enum(["BASIC", "VARIABLE"]).optional().describe("Segmentation method: BASIC (default, regular intervals) or VARIABLE (keyframe-based)"),
      encryptionList: z.array(z.object({
        protocol: z.enum(["HLS", "DASH"]).describe("Protocol this encryption applies to"),
        drmContentId: z.string().optional().describe("DRM content identifier (1-200 alphanumeric)"),
        drmKeyUrl: z.string().optional().describe("DRM provider CPIX API URL"),
        systemIdList: z.array(z.string()).optional().describe("DRM system identifiers (1-256 chars each)"),
        drmTypeCode: z.number().optional().describe("DRM type: 21 (FairPlay), 22 (Widevine/PlayReady)"),
        mediaEncryptTypeCode: z.number().optional().describe("HLS encryption: 1 (AES-128), 2 (Sample-AES), 3 (CENC)"),
      })).optional().describe("Content protection (encryption) settings per protocol"),
      drm: z.object({
        siteId: z.string().optional().describe("Multi-DRM site ID (from the Site List API)"),
        contentId: z.string().optional().describe("DRM content ID (3-100 chars, alphanumeric + -/_)"),
      }).optional().describe("Multi-DRM configuration"),
    },
    async (params) => {
      const { channelId, channelName, ...rest } = params;
      // 수정 API의 채널명 필드는 'name' (생성 API의 channelName과 다름).
      const body: Record<string, unknown> = {
        name: channelName,
        protocolList: rest.protocolList,
        segmentDuration: rest.segmentDuration,
      };
      if (rest.segmentDurationOption !== undefined) body.segmentDurationOption = rest.segmentDurationOption;
      if (rest.encryptionList !== undefined) body.encryptionList = rest.encryptionList;
      if (rest.drm !== undefined) body.drm = rest.drm;
      return client.putRequest(`/api/v2/channels/${channelId}`, body);
    }
  );

  // ─── Channel Delete Tool ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_vodstation_delete_channel",
    "⚠️ Destructive: Permanently delete a VOD Station channel. Only channels in STOPPED status can be deleted. Set confirm=true to execute.",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("Channel ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.deleteRequest(`/api/v2/channels/${params.channelId}`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete VOD Station Channel [${params.channelId}]. Only channels in STOPPED status can be deleted. The integrated CDN will be maintained.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Channel Control Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_vodstation_start_channel",
    "Start (resume) a VOD Station channel that is in STOPPED status",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("Channel ID to start"),
    },
    async (params) => {
      return client.putRequest(`/api/v2/channels/${params.channelId}/start`, {});
    }
  );

  defineTool(
    server,
    "ncloud_vodstation_stop_channel",
    "Stop a VOD Station channel that is in READY status",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("Channel ID to stop"),
    },
    async (params) => {
      return client.putRequest(`/api/v2/channels/${params.channelId}/stop`, {});
    }
  );

  // ─── Category Tools ────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_vodstation_list_categories",
    "List all VOD Station encoding categories",
    {
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSizeNo: z.number().optional().describe("Number of items per page (default: 20)"),
    },
    async (params) => {
      return client.request("/api/v2/category", params);
    }
  );

  defineTool(
    server,
    "ncloud_vodstation_create_category",
    "Create a new VOD Station encoding category. Use dryRun=true to preview without creating.",
    {
      name: z.string({ required_error: requiredError("name") }).describe("Category name (folder with this name is auto-created in output bucket)"),
      bucketName: z.string({ required_error: requiredError("bucketName") }).describe("Output bucket name to save encoded files"),
      filePath: z.string({ required_error: requiredError("filePath") }).describe("Detailed path to save output files (e.g., /)"),
      encodingOptions: z.array(z.number()).optional().describe("Encoding option IDs to apply"),
      encodingOptionTemplateId: z.number().optional().describe("Encoding template ID"),
      thumbnail: z.boolean().optional().default(false).describe("Whether to enable thumbnail extraction"),
      notificationUrl: z.string().optional().describe("Callback URL for encoding completion notifications"),
      accessControl: z.enum(["PUBLIC_READ", "PRIVATE"]).optional().default("PRIVATE").describe("Output file disclosure scope"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the category"),
    },
    async (params) => {
      const body: any = {
        name: params.name,
        thumbnail: params.thumbnail,
        output: {
          bucketName: params.bucketName,
          filePath: params.filePath,
          accessControl: params.accessControl,
        },
      };
      if (params.encodingOptions) body.encodingOptions = params.encodingOptions;
      if (params.encodingOptionTemplateId) body.encodingOptionTemplateId = params.encodingOptionTemplateId;
      if (params.notificationUrl) body.notificationUrl = params.notificationUrl;

      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: VOD Station Category Creation",
          endpoint: "/api/v2/category",
          method: "POST",
          requestParams: body,
          noun: { ko: "카테고리", en: "category" },
        });
      }

      const result = await client.postRequest("/api/v2/category", body);
      const summary = {
        리소스타입: "VOD Station Category",
        카테고리명: params.name,
        출력버킷: params.bucketName,
        출력경로: params.filePath,
        썸네일: params.thumbnail,
        상태: "created",
      };
      return summary;
    }
  );
}
