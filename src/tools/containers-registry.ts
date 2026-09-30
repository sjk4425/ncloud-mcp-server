import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError, L } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";
import { ncrPathPrefix, type Zone } from "../client/endpoints.js";

/**
 * Container Registry(NCR) 도구.
 *
 * REST(JSON) API — `responseFormatType` 없음, 메서드가 의미를 가진다(GET/POST/PATCH/DELETE).
 * 경로 접두는 **리전별**이며 존마다 규칙이 다르다(`ncrPathPrefix`):
 *   민간존 `https://ncr.apigw.ntruss.com`      KR `/ncr/api/v2` · SGN `/ncr/sgn-api/v2` · JPN `/ncr/jpn-api/v2`
 *   공공존 `https://gov-ncr.apigw.gov-ntruss.com` KR `/ncr/kr/v2` · KRS `/ncr/krs/v2`
 *
 * 오퍼레이션(두 존 공통, 2026-09-30 원문 대조 — containerregistry-* 페이지):
 *   GET    {p}/repositories                                  레지스트리 목록 (?page&pagesize)
 *   POST   {p}/repositories/{registry}                       레지스트리 생성 { storageType?, bucket? }
 *   DELETE {p}/repositories/{registry}                       레지스트리 삭제 (204)
 *   GET    {p}/repositories/{registry}                       이미지 목록 (?page&pagesize)
 *   GET    {p}/repositories/{registry}/{imageName}           이미지 상세
 *   PATCH  {p}/repositories/{registry}/{imageName}           이미지 설명 수정 { description?, full_description? }
 *   DELETE {p}/repositories/{registry}/{imageName}           이미지 삭제
 *   GET    {p}/repositories/{registry}/{imageName}/tags      태그 목록 (?page&pagesize)
 *   GET    {p}/repositories/{registry}/{imageName}/tags/{reference}   태그 상세
 *   DELETE {p}/repositories/{registry}/{imageName}/tags/{reference}   태그 삭제
 * `imageName` 은 URI 인코딩한다(`hello/world` → `hello%2Fworld`).
 *
 * 이전 구현은 `/images/...` 하위 경로, GET `/delete` 접미, `pageNo/pageSize` 쿼리를 썼는데 어느 존 문서에도 없다.
 * `ncloud_ncr_get_registry` 의 `/{registry}/info` 는 두 존 어느 가이드에도 없는 경로다(라이브 검증 전제로 남겨 둠).
 */
export interface NcrToolOptions {
  /** 존 — 리전별 경로 접두 표를 고른다. 기본 `public`. */
  zone?: Zone;
}

export function registerContainersRegistryTools(server: McpServer, client: NcloudClient, opts: NcrToolOptions = {}): void {
  const zone: Zone = opts.zone ?? "public";
  const base = () => `${ncrPathPrefix(zone, client.getRegionCode())}/repositories`;
  const enc = (s: string) => encodeURIComponent(s);
  const pageQuery = (p: { pageNo?: number; pageSize?: number }): Record<string, string> | undefined => {
    const q: Record<string, string> = {};
    if (p.pageNo !== undefined) q.page = String(p.pageNo);
    if (p.pageSize !== undefined) q.pagesize = String(p.pageSize);
    return Object.keys(q).length ? q : undefined;
  };
  const ok = (message: string) => (result: unknown) => result ?? { success: true, message };

  // ─── Registry Query Tools ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncr_list_registries",
    "List all container registries in the current region",
    {
      pageNo: z.number().int().min(1).optional().describe("Page number (sent as 'page', > 0)"),
      pageSize: z.number().int().min(1).optional().describe("Page size (sent as 'pagesize', > 0)"),
    },
    async (params) => {
      return client.requestRaw("GET", base(), pageQuery(params));
    }
  );

  defineTool(
    server,
    "ncloud_ncr_get_registry",
    "Get detailed information about a specific container registry (GET /{registry}/info — not listed in the official guide; kept pending live verification)",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry to query"),
    },
    async (params) => {
      // 공식 가이드에는 없는 경로. (검증 시나리오 D로 실응답 확인 후 확정 — /info가 아니면 경로 되돌릴 것)
      return client.request(`${base()}/${enc(params.registryName)}/info`);
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

      // 공식 스펙: POST {p}/repositories/{registry} + JSON body (storageType/bucket).
      // ncloudStorage일 때 bucket은 무시되므로 body에 포함하지 않는다.
      const body: Record<string, string> = { storageType };
      if (storageType === "objectStorage" && params.bucket) body.bucket = params.bucket;
      const endpoint = `${base()}/${enc(params.registryName)}`;

      if (params.dryRun) {
        // registryName은 경로 세그먼트라 본문에 들어가지 않는다.
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Container Registry Creation",
          endpoint,
          method: "POST",
          requestParams: body,
          noun: { ko: "레지스트리", en: "registry" },
        });
      }

      await client.requestRaw("POST", endpoint, undefined, body);
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
    "⚠️ Destructive: Permanently delete a container registry (DELETE /repositories/{registry}, 204 on success). Set confirm=true to execute.",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `${base()}/${enc(params.registryName)}`);
      return ok(`Registry [${params.registryName}] deleted (204 No Content)`)(result);
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Container Registry [${params.registryName}]. All images and tags will be destroyed.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Image Query Tools ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncr_list_images",
    "List all container images in a specified registry (GET /repositories/{registry})",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry"),
      pageNo: z.number().int().min(1).optional().describe("Page number (sent as 'page', > 0)"),
      pageSize: z.number().int().min(1).optional().describe("Page size (sent as 'pagesize', > 0)"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/${enc(params.registryName)}`, pageQuery(params));
    }
  );

  defineTool(
    server,
    "ncloud_ncr_get_image",
    "Get detailed information about a specific container image (GET /repositories/{registry}/{imageName})",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry"),
      imageName: z.string({ required_error: requiredError("imageName") }).describe("Name of the image to query (e.g. 'hello/world' — URI-encoded automatically)"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/${enc(params.registryName)}/${enc(params.imageName)}`);
    }
  );

  // ─── Image Update Tool ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncr_update_image",
    "Update the description of a container image in a registry (PATCH /repositories/{registry}/{imageName}). Provide description (short, ≤100 chars) and/or full_description (Markdown).",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry"),
      imageName: z.string({ required_error: requiredError("imageName") }).describe("Name of the image to update (URI-encoded automatically)"),
      description: z.string().max(100).optional().describe("Short description (max 100 characters)"),
      full_description: z.string().optional().describe("Detailed description (Markdown supported)"),
    },
    async (params) => {
      if (params.description === undefined && params.full_description === undefined) {
        return { content: [{ type: "text" as const, text: "Provide at least one of description or full_description." }], isError: true };
      }
      const body: Record<string, string> = {};
      if (params.description !== undefined) body.description = params.description;
      if (params.full_description !== undefined) body.full_description = params.full_description;
      const result = await client.requestRaw("PATCH", `${base()}/${enc(params.registryName)}/${enc(params.imageName)}`, undefined, body);
      return ok(`Image [${params.imageName}] updated`)(result);
    }
  );

  // ─── Image Delete Tool ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncr_delete_image",
    "⚠️ Destructive: Permanently delete a container image from a registry (DELETE /repositories/{registry}/{imageName}). Set confirm=true to execute.",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry"),
      imageName: z.string({ required_error: requiredError("imageName") }).describe("Name of the image to delete (URI-encoded automatically)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `${base()}/${enc(params.registryName)}/${enc(params.imageName)}`);
      return ok(`Image [${params.imageName}] deleted`)(result);
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Image [${params.imageName}] from Registry [${params.registryName}]. All associated tags will be removed.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Tag Query Tools ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncr_list_tags",
    "List all tags for a specific container image in a registry (GET /repositories/{registry}/{imageName}/tags)",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry"),
      imageName: z.string({ required_error: requiredError("imageName") }).describe("Name of the image (URI-encoded automatically)"),
      pageNo: z.number().int().min(1).optional().describe("Page number (sent as 'page', > 0)"),
      pageSize: z.number().int().min(1).optional().describe("Page size (sent as 'pagesize', > 0)"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/${enc(params.registryName)}/${enc(params.imageName)}/tags`, pageQuery(params));
    }
  );

  defineTool(
    server,
    "ncloud_ncr_get_tag_detail",
    "Get detailed information about a specific tag of a container image (GET .../tags/{reference})",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry"),
      imageName: z.string({ required_error: requiredError("imageName") }).describe("Name of the image (URI-encoded automatically)"),
      tagName: z.string({ required_error: requiredError("tagName") }).describe("Tag name to query"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/${enc(params.registryName)}/${enc(params.imageName)}/tags/${enc(params.tagName)}`);
    }
  );

  // ─── Tag Delete Tool ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncr_delete_tag",
    "⚠️ Destructive: Permanently delete a tag from a container image (DELETE .../tags/{reference}). Set confirm=true to execute.",
    {
      registryName: z.string({ required_error: requiredError("registryName") }).describe("Name of the registry"),
      imageName: z.string({ required_error: requiredError("imageName") }).describe("Name of the image (URI-encoded automatically)"),
      tag: z.string({ required_error: requiredError("tag") }).describe("Tag name to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `${base()}/${enc(params.registryName)}/${enc(params.imageName)}/tags/${enc(params.tag)}`);
      return ok(`Tag [${params.tag}] deleted`)(result);
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Tag [${params.tag}] from Image [${params.imageName}] in Registry [${params.registryName}].\n\nTo execute, call this tool again with confirm=true.` } }
  );
}
