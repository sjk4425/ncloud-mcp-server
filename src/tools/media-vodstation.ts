import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

export function registerVodStationTools(server: McpServer, client: NcloudClient): void {
  // ─── Channel Query Tools ───────────────────────────────────────────────────

  server.tool(
    "ncloud_vodstation_list_channels",
    "List all VOD Station streaming channels with pagination",
    {
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSizeNo: z.number().optional().describe("Number of items per page (default: 20)"),
    },
    async (params) => {
      try {
        const result = await client.request("/api/v2/channels", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_vodstation_get_channel",
    "Get detailed information about a specific VOD Station channel",
    {
      channelId: z.string({ required_error: "필수 파라미터 'channelId'가 누락되었습니다." }).describe("Channel ID (e.g., vs-20250821095732-xxxxxxx)"),
    },
    async (params) => {
      try {
        const result = await client.request(`/api/v2/channels/${params.channelId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Channel Create Tool ───────────────────────────────────────────────────

  server.tool(
    "ncloud_vodstation_create_channel",
    "Create a new VOD Station streaming channel. Use dryRun=true to preview without creating.",
    {
      channelName: z.string({ required_error: "필수 파라미터 'channelName'이 누락되었습니다." }).describe("Channel name (3-20 chars)"),
      storageBucketName: z.string({ required_error: "필수 파라미터 'storageBucketName'이 누락되었습니다." }).describe("Object Storage bucket name containing video files"),
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
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: VOD Station Channel Creation",
            channelName: params.channelName,
            storageBucketName: params.storageBucketName,
            protocolList: params.protocolList,
            segmentDuration: params.segmentDuration,
            segmentDurationOption: params.segmentDurationOption,
            accessPrivateFiles: params.accessPrivateFiles,
            createCdn: params.createCdn,
            cdnProfileId: params.cdnProfileId,
            cdnRegionType: params.cdnRegionType,
            message: "이 요청은 실제 채널을 생성하지 않습니다. dryRun=false로 호출하면 채널이 생성됩니다.",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }

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
        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Channel Delete Tool ───────────────────────────────────────────────────

  server.tool(
    "ncloud_vodstation_delete_channel",
    "⚠️ Destructive: Permanently delete a VOD Station channel. Only channels in STOPPED status can be deleted. Set confirm=true to execute.",
    {
      channelId: z.string({ required_error: "필수 파라미터 'channelId'가 누락되었습니다." }).describe("Channel ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete VOD Station Channel [${params.channelId}]. Only channels in STOPPED status can be deleted. The integrated CDN will be maintained.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.deleteRequest(`/api/v2/channels/${params.channelId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Channel Control Tools ─────────────────────────────────────────────────

  server.tool(
    "ncloud_vodstation_start_channel",
    "Start (resume) a VOD Station channel that is in STOPPED status",
    {
      channelId: z.string({ required_error: "필수 파라미터 'channelId'가 누락되었습니다." }).describe("Channel ID to start"),
    },
    async (params) => {
      try {
        const result = await client.putRequest(`/api/v2/channels/${params.channelId}/start`, {});
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_vodstation_stop_channel",
    "Stop a VOD Station channel that is in READY status",
    {
      channelId: z.string({ required_error: "필수 파라미터 'channelId'가 누락되었습니다." }).describe("Channel ID to stop"),
    },
    async (params) => {
      try {
        const result = await client.putRequest(`/api/v2/channels/${params.channelId}/stop`, {});
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Category Tools ────────────────────────────────────────────────────────

  server.tool(
    "ncloud_vodstation_list_categories",
    "List all VOD Station encoding categories",
    {
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSizeNo: z.number().optional().describe("Number of items per page (default: 20)"),
    },
    async (params) => {
      try {
        const result = await client.request("/api/v2/category", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_vodstation_create_category",
    "Create a new VOD Station encoding category. Use dryRun=true to preview without creating.",
    {
      name: z.string({ required_error: "필수 파라미터 'name'이 누락되었습니다." }).describe("Category name (folder with this name is auto-created in output bucket)"),
      bucketName: z.string({ required_error: "필수 파라미터 'bucketName'이 누락되었습니다." }).describe("Output bucket name to save encoded files"),
      filePath: z.string({ required_error: "필수 파라미터 'filePath'이 누락되었습니다." }).describe("Detailed path to save output files (e.g., /)"),
      encodingOptions: z.array(z.number()).optional().describe("Encoding option IDs to apply"),
      encodingOptionTemplateId: z.number().optional().describe("Encoding template ID"),
      thumbnail: z.boolean().optional().default(false).describe("Whether to enable thumbnail extraction"),
      notificationUrl: z.string().optional().describe("Callback URL for encoding completion notifications"),
      accessControl: z.enum(["PUBLIC_READ", "PRIVATE"]).optional().default("PRIVATE").describe("Output file disclosure scope"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the category"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: VOD Station Category Creation",
            name: params.name,
            bucketName: params.bucketName,
            filePath: params.filePath,
            encodingOptions: params.encodingOptions,
            encodingOptionTemplateId: params.encodingOptionTemplateId,
            thumbnail: params.thumbnail,
            accessControl: params.accessControl,
            message: "이 요청은 실제 카테고리를 생성하지 않습니다. dryRun=false로 호출하면 카테고리가 생성됩니다.",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }

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

        const result = await client.postRequest("/api/v2/category", body);
        const summary = {
          리소스타입: "VOD Station Category",
          카테고리명: params.name,
          출력버킷: params.bucketName,
          출력경로: params.filePath,
          썸네일: params.thumbnail,
          상태: "created",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
