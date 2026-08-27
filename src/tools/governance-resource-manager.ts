import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L } from "./_messages.js";

/** 응답에서 리소스 항목 배열을 꺼낸다(형태가 `{items}` 또는 bare 배열 모두 가능). */
function resourceItems(result: any): any[] {
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result)) return result;
  return [];
}

/** 서비스 코드 비교용 정규화 — 대소문자·공백·괄호 등 비영숫자 제거. */
function normalizeProductName(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * `productName` 필터가 0건일 때만 호출되는 진단 프로브.
 *
 * 같은 조건에서 productName 만 제외하고 1회 재조회해, 이 계정에 실제 존재하는
 * **서비스 코드 ↔ 표시명** 쌍을 모아 돌려준다. 입력값을 정규화(소문자·비영숫자 제거)해
 * 일치하는 코드가 있으면 `suggestedProductName` 으로 제시한다("Data Query" → `DataQuery`).
 *
 * 프로브가 실패하면(권한·일시 오류) 힌트 없이 원본 응답을 그대로 두기 위해 null 을 반환한다 —
 * 진단용 부가 호출이 본 조회 결과를 에러로 바꾸면 안 된다.
 */
async function probeProductNames(
  client: NcloudClient,
  body: Record<string, unknown>,
  requested: string
): Promise<Record<string, unknown> | null> {
  const { productName, page, size, ...rest } = body;
  try {
    const probe = await client.postRequest("/api/v1/resources", { ...rest, page: 0, size: 100 });
    const pairs = new Map<string, string>();
    for (const item of resourceItems(probe)) {
      if (typeof item?.productName === "string") {
        pairs.set(item.productName, typeof item.productDisplayName === "string" ? item.productDisplayName : "");
      }
    }
    const available = [...pairs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, displayName]) => (displayName ? { productName: code, productDisplayName: displayName } : { productName: code }));

    const wanted = normalizeProductName(requested);
    const suggested = [...pairs.keys()].find((code) => normalizeProductName(code) === wanted);

    return {
      reason: L({
        ko: `productName="${requested}" 로 0건입니다. 이 필터는 서비스 **코드** 정확일치이며 콘솔 표시명이 아닙니다.`,
        en: `No resource matched productName="${requested}". This filter is an exact match on the service CODE, not the console display name.`,
      }),
      ...(suggested !== undefined
        ? {
            suggestedProductName: suggested,
            suggestion: L({
              ko: `productName="${suggested}" 로 다시 호출하세요.`,
              en: `Retry with productName="${suggested}".`,
            }),
          }
        : {}),
      availableProductNames: available,
      availableProductNamesNote: L({
        ko: "같은 조건에서 productName 필터만 제외해 조회한 첫 100건에서 수집한 목록이라, 계정 전체 코드 목록은 아닐 수 있습니다.",
        en: "Collected from the first 100 resources matching the same filters with productName removed, so it may not list every code in the account.",
      }),
    };
  } catch {
    return null;
  }
}

export function registerResourceManagerTools(server: McpServer, client: NcloudClient): void {
  // ncloud_resource_list_resources — List resources with optional filters
  defineTool(
    server,
    "ncloud_resource_list_resources",
    "List resources managed in Ncloud. When NRN is specified, returns single resource detail with tags and groups. Note that every filter is an EXACT match — there is no partial/contains matching in this API. Each returned item carries both productName (the service code, the only value the productName filter accepts) and productDisplayName (the human-readable service name shown in the console).",
    {
      nrn: z.string().optional().describe("Ncloud Resource Name for single resource detail lookup"),
      productName: z.string().optional().describe("Service CODE of the resource, matched exactly — not the display name shown in the console. Service codes carry no spaces or parentheses: use 'DataQuery', not 'Data Query'. To discover the valid codes for this account, call this tool without a productName filter and read each item's productName (its productDisplayName is the console name). When a productName filter returns nothing, this tool retries once without it and reports the codes that do exist as productNameFilterHint"),
      regionCode: z.string().optional().describe("Region code filter, exact match (e.g., 'KR', 'JPN')"),
      resourceType: z.string().optional().describe("Resource type filter, exact match (e.g., 'DataSource', 'Project'). See a returned item's resourceType for valid values"),
      resourceId: z.string().optional().describe("Resource ID filter, exact match"),
      resourceName: z.string().optional().describe("Resource name filter, exact match"),
      tag: z.array(z.object({
        tagKey: z.string().describe("Tag key (1-128 chars; the special characters _ . / = + - @ are allowed)"),
        tagValue: z.string().optional().describe("Tag value (1-256 chars). OPTIONAL — omit it to match every resource carrying the key, whatever its value"),
      })).optional().describe("Tag filter array, e.g. [{tagKey: 'env', tagValue: 'dev'}] or [{tagKey: 'env'}] to filter by key alone"),
      groupName: z.string().optional().describe("Group name filter, exact match"),
      page: z.number().optional().describe("Page number, 0-based (default 0)"),
      size: z.number().optional().describe("Page size, documented as 1~100 (default 20). The API was observed returning more than 100 rows for a larger value rather than rejecting or clamping it, so values above 100 work today but are outside the documented range — do not rely on them"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.nrn !== undefined) body.nrn = params.nrn;
      if (params.productName !== undefined) body.productName = params.productName;
      if (params.regionCode !== undefined) body.regionCode = params.regionCode;
      if (params.resourceType !== undefined) body.resourceType = params.resourceType;
      if (params.resourceId !== undefined) body.resourceId = params.resourceId;
      if (params.resourceName !== undefined) body.resourceName = params.resourceName;
      if (params.tag !== undefined) body.tag = params.tag;
      if (params.groupName !== undefined) body.groupName = params.groupName;
      if (params.page !== undefined) body.page = params.page;
      if (params.size !== undefined) body.size = params.size;

      const result = await client.postRequest("/api/v1/resources", body);

      // productName 은 정확일치 + 서비스 "코드"라, 콘솔 표시명("Data Query")을 넣으면 리소스가
      // 있는데도 0건이 나와 "그 서비스는 Resource Manager에 없다"는 오판을 부른다(MCP-BUG-REPORT #6).
      // 0건일 때만 필터를 뺀 조회를 1회 더 해서, 실제 존재하는 코드↔표시명 쌍을 힌트로 돌려준다.
      if (params.productName !== undefined && resourceItems(result).length === 0) {
        const hint = await probeProductNames(client, body, params.productName);
        if (hint) return { ...result, productNameFilterHint: hint };
      }

      return result;
    }
  );

  // ncloud_resource_attach_tag — Attach tag to resources
  defineTool(
    server,
    "ncloud_resource_attach_tag",
    "Attach a tag to one or more resources. If the tag key already exists on a resource, only its value is updated.",
    {
      nrnList: z.array(z.string()).min(1, { message: L({ ko: "nrnList는 최소 1개 이상의 NRN을 포함해야 합니다.", en: "nrnList must contain at least one NRN." }) }).describe("List of Ncloud Resource Names to tag (see ncloud_resource_list_resources)"),
      tagKey: z.string().describe("Tag key to attach (1-128 chars; the special characters _ . / = + - @ are allowed)"),
      tagValue: z.string().describe("Tag value to attach (1-256 chars; the special characters _ . / = + - @ are allowed)"),
    },
    async (params) => {
      const body = {
        nrnList: params.nrnList,
        tagKey: params.tagKey,
        tagValue: params.tagValue,
      };

      const result = await client.postRequest("/api/v1/resource-tags", body);
      return result;
    }
  );

  // ncloud_resource_detach_tag — Detach tag from resources (destructive)
  defineTool(
    server,
    "ncloud_resource_detach_tag",
    "\u26a0\ufe0f Destructive: Remove a tag from one or more resources. Set confirm=true to execute.",
    {
      nrnList: z.array(z.string()).min(1, { message: L({ ko: "nrnList는 최소 1개 이상의 NRN을 포함해야 합니다.", en: "nrnList must contain at least one NRN." }) }).describe("List of Ncloud Resource Names to remove tag from"),
      tagKey: z.string().describe("Tag key to remove (1-128 chars)"),
      tagValue: z.string().optional().describe("Tag value (optional; omit to remove the key regardless of its value)"),
      confirm: z.boolean().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {

      const body: Record<string, unknown> = {
        nrnList: params.nrnList,
        tagKey: params.tagKey,
      };
      if (params.tagValue !== undefined) body.tagValue = params.tagValue;

      const result = await client.deleteRequest("/api/v1/resource-tags", body);
      return result;
    },
    { destructive: { message: (params) => `\u26a0\ufe0f This will remove tag [${params.tagKey}${params.tagValue ? `=${params.tagValue}` : ""}] from ${params.nrnList.length} resource(s).\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ncloud_resource_list_groups — List resource groups
  defineTool(
    server,
    "ncloud_resource_list_groups",
    "List resource groups with optional name filter and pagination.",
    {
      groupName: z.string().optional().describe("Group name filter, exact match"),
      page: z.number().optional().describe("Page number, 0-based (default 0)"),
      size: z.number().optional().describe("Page size 1~100 (default 20)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.groupName !== undefined) queryParams.groupName = params.groupName;
      if (params.page !== undefined) queryParams.page = String(params.page);
      if (params.size !== undefined) queryParams.size = String(params.size);

      const result = await client.requestRaw("GET", "/api/v1/groups", Object.keys(queryParams).length > 0 ? queryParams : undefined);
      return result;
    }
  );

  // ncloud_resource_attach_group — Add resources to a group
  defineTool(
    server,
    "ncloud_resource_attach_group",
    "Add one or more resources to a resource group.",
    {
      groupId: z.string().describe("Resource group ID"),
      nrnList: z.array(z.string()).min(1, { message: L({ ko: "nrnList는 최소 1개 이상의 NRN을 포함해야 합니다.", en: "nrnList must contain at least one NRN." }) }).describe("List of Ncloud Resource Names to add to the group (see ncloud_resource_list_resources)"),
    },
    async (params) => {
      const body = {
        nrnList: params.nrnList,
      };

      const result = await client.requestRaw(
        "POST",
        `/api/v1/groups/${encodeURIComponent(params.groupId)}/resources`,
        undefined,
        body
      );
      return result;
    }
  );

  // ncloud_resource_detach_group — Remove resources from a group (destructive)
  defineTool(
    server,
    "ncloud_resource_detach_group",
    "\u26a0\ufe0f Destructive: Remove one or more resources from a resource group. Set confirm=true to execute.",
    {
      groupId: z.string().describe("Resource group ID"),
      nrnList: z.array(z.string()).min(1, { message: L({ ko: "nrnList는 최소 1개 이상의 NRN을 포함해야 합니다.", en: "nrnList must contain at least one NRN." }) }).describe("List of Ncloud Resource Names to remove from the group"),
      confirm: z.boolean().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {

      const body = {
        nrnList: params.nrnList,
      };

      const result = await client.requestRaw(
        "DELETE",
        `/api/v1/groups/${encodeURIComponent(params.groupId)}/resources`,
        undefined,
        body
      );
      return result;
    },
    { destructive: { message: (params) => `\u26a0\ufe0f This will remove ${params.nrnList.length} resource(s) from group [${params.groupId}].\n\nTo execute, call this tool again with confirm=true.` } }
  );
}
