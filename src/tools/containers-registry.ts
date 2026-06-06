import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

export function registerContainersRegistryTools(server: McpServer, client: NcloudClient): void {
  // ─── Registry Query Tools ──────────────────────────────────────────────────

  server.tool(
    "ncloud_ncr_list_registries",
    "List all container registries in the current region",
    {
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      try {
        const result = await client.request("/ncr/api/v2/repositories", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_ncr_get_registry",
    "Get detailed information about a specific container registry",
    {
      registryName: z.string({ required_error: "필수 파라미터 'registryName'이 누락되었습니다." }).describe("Name of the registry to query"),
    },
    async (params) => {
      try {
        const result = await client.request(`/ncr/api/v2/repositories/${params.registryName}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Registry Create Tool ──────────────────────────────────────────────────

  server.tool(
    "ncloud_ncr_create_registry",
    "Create a new container registry. Use dryRun=true to preview without creating.",
    {
      registryName: z.string({ required_error: "필수 파라미터 'registryName'이 누락되었습니다." }).describe("Name for the new registry"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the registry"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: Container Registry Creation",
            registryName: params.registryName,
            message: "이 요청은 실제 레지스트리를 생성하지 않습니다. dryRun=false로 호출하면 레지스트리가 생성됩니다.",
          };
          return toolText(preview);
        }

        const { dryRun, ...apiParams } = params;
        const result = await client.request("/ncr/api/v2/repositories", apiParams);
        const summary = {
          리소스타입: "Container Registry",
          레지스트리명: params.registryName,
          상태: "creating",
        };
        return toolText(summary);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Registry Delete Tool ──────────────────────────────────────────────────

  server.tool(
    "ncloud_ncr_delete_registry",
    "⚠️ Destructive: Permanently delete a container registry. Set confirm=true to execute.",
    {
      registryName: z.string({ required_error: "필수 파라미터 'registryName'이 누락되었습니다." }).describe("Name of the registry to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Container Registry [${params.registryName}]. All images and tags will be destroyed.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.request(`/ncr/api/v2/repositories/${params.registryName}/delete`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Image Query Tools ─────────────────────────────────────────────────────

  server.tool(
    "ncloud_ncr_list_images",
    "List all container images in a specified registry",
    {
      registryName: z.string({ required_error: "필수 파라미터 'registryName'이 누락되었습니다." }).describe("Name of the registry"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      try {
        const { registryName, ...queryParams } = params;
        const result = await client.request(`/ncr/api/v2/repositories/${registryName}/images`, queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_ncr_get_image",
    "Get detailed information about a specific container image",
    {
      registryName: z.string({ required_error: "필수 파라미터 'registryName'이 누락되었습니다." }).describe("Name of the registry"),
      imageName: z.string({ required_error: "필수 파라미터 'imageName'이 누락되었습니다." }).describe("Name of the image to query"),
    },
    async (params) => {
      try {
        const result = await client.request(`/ncr/api/v2/repositories/${params.registryName}/images/${params.imageName}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Image Update Tool ───────────────────────────────────────────────────────

  server.tool(
    "ncloud_ncr_update_image",
    "Update the description of a container image in a registry",
    {
      registryName: z.string({ required_error: "필수 파라미터 'registryName'이 누락되었습니다." }).describe("Name of the registry"),
      imageName: z.string({ required_error: "필수 파라미터 'imageName'이 누락되었습니다." }).describe("Name of the image to update"),
      description: z.string({ required_error: "필수 파라미터 'description'이 누락되었습니다." }).describe("New description for the image"),
    },
    async (params) => {
      try {
        const result = await client.request(`/ncr/api/v2/repositories/${params.registryName}/images/${params.imageName}`, {
          description: params.description,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Image Delete Tool ─────────────────────────────────────────────────────

  server.tool(
    "ncloud_ncr_delete_image",
    "⚠️ Destructive: Permanently delete a container image from a registry. Set confirm=true to execute.",
    {
      registryName: z.string({ required_error: "필수 파라미터 'registryName'이 누락되었습니다." }).describe("Name of the registry"),
      imageName: z.string({ required_error: "필수 파라미터 'imageName'이 누락되었습니다." }).describe("Name of the image to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Image [${params.imageName}] from Registry [${params.registryName}]. All associated tags will be removed.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.request(`/ncr/api/v2/repositories/${params.registryName}/images/${params.imageName}/delete`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Tag Query Tools ───────────────────────────────────────────────────────

  server.tool(
    "ncloud_ncr_list_tags",
    "List all tags for a specific container image in a registry",
    {
      registryName: z.string({ required_error: "필수 파라미터 'registryName'이 누락되었습니다." }).describe("Name of the registry"),
      imageName: z.string({ required_error: "필수 파라미터 'imageName'이 누락되었습니다." }).describe("Name of the image"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      try {
        const { registryName, imageName, ...queryParams } = params;
        const result = await client.request(`/ncr/api/v2/repositories/${registryName}/images/${imageName}/tags`, queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_ncr_get_tag_detail",
    "Get detailed information about a specific tag of a container image",
    {
      registryName: z.string({ required_error: "필수 파라미터 'registryName'이 누락되었습니다." }).describe("Name of the registry"),
      imageName: z.string({ required_error: "필수 파라미터 'imageName'이 누락되었습니다." }).describe("Name of the image"),
      tagName: z.string({ required_error: "필수 파라미터 'tagName'이 누락되었습니다." }).describe("Tag name to query"),
    },
    async (params) => {
      try {
        const result = await client.request(`/ncr/api/v2/repositories/${params.registryName}/images/${params.imageName}/tags/${params.tagName}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Tag Delete Tool ───────────────────────────────────────────────────────

  server.tool(
    "ncloud_ncr_delete_tag",
    "⚠️ Destructive: Permanently delete a tag from a container image. Set confirm=true to execute.",
    {
      registryName: z.string({ required_error: "필수 파라미터 'registryName'이 누락되었습니다." }).describe("Name of the registry"),
      imageName: z.string({ required_error: "필수 파라미터 'imageName'이 누락되었습니다." }).describe("Name of the image"),
      tag: z.string({ required_error: "필수 파라미터 'tag'가 누락되었습니다." }).describe("Tag name to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Tag [${params.tag}] from Image [${params.imageName}] in Registry [${params.registryName}].\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.request(`/ncr/api/v2/repositories/${params.registryName}/images/${params.imageName}/tags/${params.tag}/delete`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
