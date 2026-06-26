import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { dryRunMessage, requiredError, L } from "./_messages.js";

export function registerContainersRegistryTools(server: McpServer, client: NcloudClient): void {
  // ─── Registry Query Tools ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncr_list_registries",
    "List all container registries in the current region",
    {
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/ncr/api/v2/repositories", params);
    }
  );

  defineTool(
    server,
    "ncloud_ncr_get_registry",
    "Get detailed information about a specific container registry",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry to query"),
    },
    async (params) => {
      // 공식 가이드 기준 상세 조회 경로는 /{registry}/info 이며 응답에 storage_type 포함.
      // (검증 시나리오 D로 실응답 확인 후 확정 — /info가 아니면 경로 되돌릴 것)
      return client.request(`/ncr/api/v2/repositories/${params.registryName}/info`);
    }
  );

  // ─── Registry Create Tool ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncr_create_registry",
    "Create a new container registry. 'storageType' selects the storage backend: 'objectStorage' (default) reuses an existing Object Storage bucket (then 'bucket' is required); 'ncloudStorage' auto-provisions dedicated NCR storage (then 'bucket' is ignored). Use dryRun=true to preview without creating.",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name for the new registry"),
      storageType: z.enum(["objectStorage", "ncloudStorage"]).optional().describe("Storage backend. 'objectStorage' (default) reuses an existing Object Storage bucket — 'bucket' is then required. 'ncloudStorage' auto-provisions dedicated NCR storage (bucket 'registry-{privateId}') — 'bucket' is ignored."),
      bucket: z.string().optional().describe("Object Storage bucket name. Required when storageType='objectStorage' (the default); ignored when storageType='ncloudStorage'. Cannot be reused across registries."),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the registry"),
    },
    async (params) => {
      // storageType 생략 시 NCP 기본값은 objectStorage. objectStorage는 bucket이 필수이며
      // 미지정 시 NCP가 400을 반환하므로 호출 전에 명확한 메시지로 사전 차단한다.
      const storageType = params.storageType ?? "objectStorage";
      if (storageType === "objectStorage" && !params.bucket) {
        throw new Error(
          L({
            ko: "storageType='objectStorage'(기본값)에는 'bucket'이 필수입니다. 버킷을 지정하거나 storageType='ncloudStorage'를 사용하세요.",
            en: "'bucket' is required when storageType='objectStorage' (the default). Specify a bucket or use storageType='ncloudStorage'.",
          })
        );
      }

      if (params.dryRun) {
        return {
          label: "🔍 Dry-Run Preview: Container Registry Creation",
          registryName: params.registryName,
          storageType,
          ...(storageType === "objectStorage" ? { bucket: params.bucket } : {}),
          message: dryRunMessage({ ko: "레지스트리", en: "registry" }),
        };
      }

      // 공식 스펙: POST /ncr/api/v2/repositories/{registry} + JSON body (storageType/bucket).
      // ncloudStorage일 때 bucket은 무시되므로 body에 포함하지 않는다.
      const body: Record<string, string> = { storageType };
      if (storageType === "objectStorage" && params.bucket) body.bucket = params.bucket;
      await client.requestRaw(
        "POST",
        `/ncr/api/v2/repositories/${encodeURIComponent(params.registryName)}`,
        undefined,
        body
      );
      return {
        리소스타입: "Container Registry",
        레지스트리명: params.registryName,
        storageType,
        상태: "creating",
      };
    }
  );

  // ─── Registry Delete Tool ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncr_delete_registry",
    "⚠️ Destructive: Permanently delete a container registry. Set confirm=true to execute.",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.request(`/ncr/api/v2/repositories/${params.registryName}/delete`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Container Registry [${params.registryName}]. All images and tags will be destroyed.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Image Query Tools ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncr_list_images",
    "List all container images in a specified registry",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      const { registryName, ...queryParams } = params;
      const result = await client.request(`/ncr/api/v2/repositories/${registryName}/images`, queryParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ncr_get_image",
    "Get detailed information about a specific container image",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry"),
      imageName: z.string({ required_error: requiredError("imageName") }).describe("Name of the image to query"),
    },
    async (params) => {
      return client.request(`/ncr/api/v2/repositories/${params.registryName}/images/${params.imageName}`);
    }
  );

  // ─── Image Update Tool ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncr_update_image",
    "Update the description of a container image in a registry",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry"),
      imageName: z.string({ required_error: requiredError("imageName") }).describe("Name of the image to update"),
      description: z.string({ required_error: requiredError("description") }).describe("New description for the image"),
    },
    async (params) => {
      return client.request(`/ncr/api/v2/repositories/${params.registryName}/images/${params.imageName}`, {
          description: params.description,
        });
    }
  );

  // ─── Image Delete Tool ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncr_delete_image",
    "⚠️ Destructive: Permanently delete a container image from a registry. Set confirm=true to execute.",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry"),
      imageName: z.string({ required_error: requiredError("imageName") }).describe("Name of the image to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.request(`/ncr/api/v2/repositories/${params.registryName}/images/${params.imageName}/delete`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Image [${params.imageName}] from Registry [${params.registryName}]. All associated tags will be removed.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Tag Query Tools ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncr_list_tags",
    "List all tags for a specific container image in a registry",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry"),
      imageName: z.string({ required_error: requiredError("imageName") }).describe("Name of the image"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      const { registryName, imageName, ...queryParams } = params;
      const result = await client.request(`/ncr/api/v2/repositories/${registryName}/images/${imageName}/tags`, queryParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ncr_get_tag_detail",
    "Get detailed information about a specific tag of a container image",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry"),
      imageName: z.string({ required_error: requiredError("imageName") }).describe("Name of the image"),
      tagName: z.string({ required_error: requiredError("tagName") }).describe("Tag name to query"),
    },
    async (params) => {
      return client.request(`/ncr/api/v2/repositories/${params.registryName}/images/${params.imageName}/tags/${params.tagName}`);
    }
  );

  // ─── Tag Delete Tool ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncr_delete_tag",
    "⚠️ Destructive: Permanently delete a tag from a container image. Set confirm=true to execute.",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry"),
      imageName: z.string({ required_error: requiredError("imageName") }).describe("Name of the image"),
      tag: z.string({ required_error: requiredError("tag") }).describe("Tag name to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.request(`/ncr/api/v2/repositories/${params.registryName}/images/${params.imageName}/tags/${params.tag}/delete`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Tag [${params.tag}] from Image [${params.imageName}] in Registry [${params.registryName}].\n\nTo execute, call this tool again with confirm=true.` } }
  );
}
