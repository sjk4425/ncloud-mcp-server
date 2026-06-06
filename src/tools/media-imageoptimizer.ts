import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

export function registerImageOptimizerTools(server: McpServer, client: NcloudClient): void {
  // ─── Project Query Tools ───────────────────────────────────────────────────

  server.tool(
    "ncloud_imageoptimizer_list_projects",
    "List all Image Optimizer projects with pagination",
    {
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSizeNo: z.number().optional().describe("Number of items per page (default: 20)"),
    },
    async (params) => {
      try {
        const result = await client.request("/api/v2/projects", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_imageoptimizer_get_project",
    "Get detailed information about a specific Image Optimizer project",
    {
      projectId: z.string({ required_error: "필수 파라미터 'projectId'가 누락되었습니다." }).describe("Project ID to query"),
    },
    async (params) => {
      try {
        const result = await client.request(`/api/v2/projects/${params.projectId}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Project Create Tool ───────────────────────────────────────────────────

  server.tool(
    "ncloud_imageoptimizer_create_project",
    "Create a new Image Optimizer project. Use dryRun=true to preview without creating.",
    {
      projectName: z.string({ required_error: "필수 파라미터 'projectName'이 누락되었습니다." }).describe("Project name"),
      bucketName: z.string({ required_error: "필수 파라미터 'bucketName'이 누락되었습니다." }).describe("Object Storage bucket name for source images"),
      createCdn: z.boolean().optional().default(true).describe("Whether to auto-create a Global Edge CDN"),
      cdnProfileId: z.number().optional().describe("Global Edge profile ID (required when createCdn=true)"),
      cdnRegionType: z.enum(["KOREA", "JAPAN", "GLOBAL"]).optional().describe("CDN service region (required when createCdn=true)"),
      cdnDomain: z.string().optional().describe("Existing Global Edge domain (required when createCdn=false)"),
      cdnInstanceNo: z.number().optional().describe("Existing Global Edge instance ID (required when createCdn=false)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the project"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: Image Optimizer Project Creation",
            projectName: params.projectName,
            bucketName: params.bucketName,
            createCdn: params.createCdn,
            cdnProfileId: params.cdnProfileId,
            cdnRegionType: params.cdnRegionType,
            message: "이 요청은 실제 프로젝트를 생성하지 않습니다. dryRun=false로 호출하면 프로젝트가 생성됩니다.",
          };
          return toolText(preview);
        }

        const body: any = {
          projectName: params.projectName,
          bucketName: params.bucketName,
          cdn: {
            createCdn: params.createCdn,
            cdnType: "GLOBAL_EDGE",
            profileId: params.cdnProfileId,
            regionType: params.cdnRegionType,
            cdnDomain: params.cdnDomain,
            cdnInstanceNo: params.cdnInstanceNo,
          },
        };

        const result = await client.postRequest("/api/v2/projects", body);
        const project = result?.content || result;
        const summary = {
          리소스타입: "Image Optimizer Project",
          프로젝트ID: project?.projectId || project?.id || "creating",
          프로젝트명: params.projectName,
          버킷: params.bucketName,
          CDN생성: params.createCdn,
          상태: project?.projectStatus || "CREATING",
        };
        return toolText(summary);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Project Delete Tool ───────────────────────────────────────────────────

  server.tool(
    "ncloud_imageoptimizer_delete_project",
    "⚠️ Destructive: Permanently delete an Image Optimizer project. Set confirm=true to execute.",
    {
      projectId: z.string({ required_error: "필수 파라미터 'projectId'가 누락되었습니다." }).describe("Project ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Image Optimizer Project [${params.projectId}]. All transformation rules will be removed.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.deleteRequest(`/api/v2/projects/${params.projectId}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Transformation Rule Tools ─────────────────────────────────────────────

  server.tool(
    "ncloud_imageoptimizer_list_rules",
    "List all transformation rules for an Image Optimizer project",
    {
      projectId: z.string({ required_error: "필수 파라미터 'projectId'가 누락되었습니다." }).describe("Project ID to list rules for"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSizeNo: z.number().optional().describe("Number of items per page (default: 20)"),
    },
    async (params) => {
      try {
        const { projectId, ...queryParams } = params;
        const result = await client.request(`/api/v2/projects/${projectId}/rules`, queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_imageoptimizer_create_rule",
    "Create a new transformation rule for an Image Optimizer project. Use dryRun=true to preview without creating.",
    {
      projectId: z.string({ required_error: "필수 파라미터 'projectId'가 누락되었습니다." }).describe("Project ID to add the rule to"),
      ruleName: z.string({ required_error: "필수 파라미터 'ruleName'이 누락되었습니다." }).describe("Rule name"),
      resizeType: z.enum(["f", "w", "h", "fw", "fh", "wh", "h_wm"]).optional().describe("Resize type: f(fit), w(width), h(height), fw(force width), fh(force height), wh(width+height), h_wm(height with watermark)"),
      width: z.number().optional().describe("Target width in pixels"),
      height: z.number().optional().describe("Target height in pixels"),
      quality: z.number().optional().describe("Output quality (1-100, default: 75)"),
      format: z.enum(["jpg", "png", "webp", "gif"]).optional().describe("Output image format"),
      autorotate: z.boolean().optional().default(true).describe("Whether to auto-rotate based on EXIF data"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the rule"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: Image Optimizer Rule Creation",
            projectId: params.projectId,
            ruleName: params.ruleName,
            resizeType: params.resizeType,
            width: params.width,
            height: params.height,
            quality: params.quality,
            format: params.format,
            autorotate: params.autorotate,
            message: "이 요청은 실제 규칙을 생성하지 않습니다. dryRun=false로 호출하면 규칙이 생성됩니다.",
          };
          return toolText(preview);
        }

        const body: any = {
          ruleName: params.ruleName,
          autorotate: params.autorotate,
        };
        if (params.resizeType) body.resizeType = params.resizeType;
        if (params.width) body.width = params.width;
        if (params.height) body.height = params.height;
        if (params.quality) body.quality = params.quality;
        if (params.format) body.format = params.format;

        const result = await client.postRequest(`/api/v2/projects/${params.projectId}/rules`, body);
        const summary = {
          리소스타입: "Image Optimizer Rule",
          프로젝트ID: params.projectId,
          규칙명: params.ruleName,
          리사이즈타입: params.resizeType || "none",
          크기: `${params.width || "auto"}x${params.height || "auto"}`,
          품질: params.quality || 75,
          포맷: params.format || "original",
          상태: "created",
        };
        return toolText(summary);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_imageoptimizer_delete_rule",
    "⚠️ Destructive: Delete a transformation rule from an Image Optimizer project. Set confirm=true to execute.",
    {
      projectId: z.string({ required_error: "필수 파라미터 'projectId'가 누락되었습니다." }).describe("Project ID containing the rule"),
      ruleId: z.string({ required_error: "필수 파라미터 'ruleId'가 누락되었습니다." }).describe("Rule ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Rule [${params.ruleId}] from Project [${params.projectId}].\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.deleteRequest(`/api/v2/projects/${params.projectId}/rules/${params.ruleId}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
