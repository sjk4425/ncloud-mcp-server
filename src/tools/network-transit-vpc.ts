import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { reqField } from "./_zod.js";
import { cidrMessage, L } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

/**
 * Transit VPC Connect · Service Function Chain (VPC API, 2026-11-24 민간존·금융존 릴리스).
 *
 * 가이드: https://api.ncloud-docs.com/docs/networking-vpc-createtransitvpcconnectinstance 외 11개
 *   (networking-vpc-*transitvpcconnect*, networking-vpc-*servicefunctionchain*).
 * 금융존은 릴리스 노트(api-fin …/api-releasenote-20261124)에 같은 파라미터로 공지 — 상세 페이지는 2026-11-25 기준 404.
 * 공공존은 미제공 → registry 에서 민간존·금융존만 등록.
 * 경로는 기존 VPC 와 같은 /vpc/v2, GET.
 */

// ─── 공통 검증 ────────────────────────────────────────────────────────────────

/** 가이드 이름 규칙: 소문자·숫자·'-', 3~30자, 영문 소문자로 시작·영숫자로 종료. */
export const NAME_PATTERN = /^[a-z][a-z0-9-]{1,28}[a-z0-9]$/;

export function resourceName(field: string) {
  return z.string().regex(NAME_PATTERN, {
    message: L({
      ko: `잘못된 파라미터: '${field}'은(는) 3~30자의 영문 소문자/숫자/하이픈만 허용하며, 영문 소문자로 시작하고 영숫자로 끝나야 합니다.`,
      en: `Invalid parameter: '${field}' must be 3-30 characters of lowercase letters, digits, and hyphens, starting with a lowercase letter and ending with a letter or digit.`,
    }),
  });
}

/** 가이드: 설명 0~1,000 Bytes(UTF-8 기준 — 한글은 3바이트). */
export function descriptionField(field: string) {
  return z.string().refine((s) => Buffer.byteLength(s, "utf8") <= 1000, {
    message: L({
      ko: `잘못된 파라미터: '${field}'은(는) 최대 1,000바이트(UTF-8)입니다.`,
      en: `Invalid parameter: '${field}' must be at most 1,000 bytes (UTF-8).`,
    }),
  });
}

export const CIDR_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/;

export function cidrField(field: string, example: string) {
  return z.string(reqField(field)).regex(CIDR_PATTERN, { message: cidrMessage(field, example) });
}

/** pageNo 를 주면 pageSize 필수(가이드 공통 Conditional). */
export function checkPaging(params: { pageNo?: number; pageSize?: number }): void {
  if (params.pageNo !== undefined && params.pageSize === undefined) {
    throw new Error(L({
      ko: "잘못된 파라미터: pageNo 를 지정하면 pageSize 도 필요합니다.",
      en: "Invalid parameter: pageSize is required when pageNo is given.",
    }));
  }
}

/** 문자열 배열을 `{name}.N` 키로 펼친다(1-based). */
export function indexed(target: Record<string, string>, name: string, values: string[] | undefined): void {
  (values ?? []).forEach((v, i) => {
    target[`${name}.${i + 1}`] = v;
  });
}

// ─── Service Function Chain chainList 검증 ────────────────────────────────────

export const SFC_TARGET_TYPES = ["SVR", "LB", "TRANSITVPCCONNECT", "IGW", "VGW", "POGW", "NATGW", "OGW"] as const;

const chainTargetSchema = z.object({
  targetTypeCode: z.enum(SFC_TARGET_TYPES, reqField("targetTypeCode")).describe(
    "Target type: SVR (server) | LB (load balancer) | TRANSITVPCCONNECT | IGW | VGW | POGW | NATGW | OGW"
  ),
  targetNo: z.string().optional().describe("Target instance number. Required for every type except IGW; must be omitted for IGW"),
  ingressNetworkInterfaceNo: z.string().optional().describe("Network interface number traffic enters through. Required when targetTypeCode=SVR"),
});

type ChainTarget = z.output<typeof chainTargetSchema>;

const chainListSchema = z
  .array(chainTargetSchema)
  .min(1)
  .max(5)
  .describe(
    "Ordered chain (1-5 hops); traffic passes chainList[0] → chainList[1] → ... " +
      "All hops before the last must be SVR or LB; the last hop must NOT be SVR or LB (e.g. TRANSITVPCCONNECT, IGW, VGW, NATGW)."
  );

/** 가이드 chainList 규칙을 호출 전에 검사(API 는 400 으로만 알려준다). */
export function validateChain(chain: ChainTarget[]): void {
  const errs: string[] = [];
  chain.forEach((hop, i) => {
    const pos = `chainList[${i}]`;
    const isLast = i === chain.length - 1;
    const inline = hop.targetTypeCode === "SVR" || hop.targetTypeCode === "LB";
    if (isLast && inline) errs.push(`${pos}: last hop must not be SVR or LB`);
    if (!isLast && !inline) errs.push(`${pos}: hops before the last must be SVR or LB`);
    if (hop.targetTypeCode === "IGW" && hop.targetNo !== undefined) errs.push(`${pos}: targetNo must be omitted for IGW`);
    if (hop.targetTypeCode !== "IGW" && !hop.targetNo) errs.push(`${pos}: targetNo is required for ${hop.targetTypeCode}`);
    if (hop.targetTypeCode === "SVR" && !hop.ingressNetworkInterfaceNo) errs.push(`${pos}: ingressNetworkInterfaceNo is required for SVR`);
  });
  if (errs.length) {
    throw new Error(L({ ko: "잘못된 chainList: ", en: "Invalid chainList: " }) + errs.join("; "));
  }
}

export function flattenChain(target: Record<string, string>, chain: ChainTarget[]): void {
  chain.forEach((hop, i) => {
    const p = `chainList.${i + 1}`;
    target[`${p}.targetTypeCode`] = hop.targetTypeCode;
    if (hop.targetNo !== undefined) target[`${p}.targetNo`] = hop.targetNo;
    if (hop.ingressNetworkInterfaceNo !== undefined) target[`${p}.ingressNetworkInterfaceNo`] = hop.ingressNetworkInterfaceNo;
  });
}

const destinationCidrListSchema = z.array(cidrField("destinationCidrBlockList[]", "10.0.0.0/16"));

export function registerTransitVpcTools(server: McpServer, client: NcloudClient): void {
  // ═══ Transit VPC Connect ═══════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_list_transit_vpc_connects",
    "List Transit VPC Connect instances (attachments of normal VPCs to a Transit VPC)",
    {
      transitVpcConnectInstanceNoList: z.array(z.string()).optional().describe("Filter by Transit VPC Connect instance numbers"),
      transitVpcConnectName: z.string().optional().describe("Filter: names containing this string"),
      transitVpcNo: z.string().optional().describe("Filter by Transit VPC number"),
      normalVpcNo: z.string().optional().describe("Filter by attached (normal) VPC number"),
      pageNo: z.number().int().min(0).optional().describe("Page number (requires pageSize)"),
      pageSize: z.number().int().min(1).optional().describe("Results per page (required when pageNo is given)"),
    },
    async (params) => {
      checkPaging(params);
      return client.request("/vpc/v2/getTransitVpcConnectInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_transit_vpc_connect_detail",
    "Get details of a Transit VPC Connect instance, including both VPCs' CIDR lists and associated Endpoint Route Tables",
    {
      transitVpcConnectInstanceNo: z.string(reqField("transitVpcConnectInstanceNo")).describe("Transit VPC Connect instance number"),
    },
    async (params) => client.request("/vpc/v2/getTransitVpcConnectInstanceDetail", params)
  );

  defineTool(
    server,
    "ncloud_create_transit_vpc_connect",
    "Attach a normal VPC to a Transit VPC (Transit VPC Connect). If the Transit VPC belongs to another account, " +
      "transitVpcLoginId and transitVpcName are required and the owner must accept via ncloud_accept_reject_transit_vpc_connect. " +
      "Use dryRun=true to preview without creating.",
    {
      transitVpcNo: z.string(reqField("transitVpcNo")).describe("Transit VPC number (a VPC created with vpcTypeCode=TRANSIT)"),
      normalVpcNo: z.string(reqField("normalVpcNo")).describe("Normal VPC number to attach"),
      transitVpcLoginId: z.string().email().optional().describe("Login ID (email) of the Transit VPC owner account. Required when the Transit VPC belongs to another account"),
      transitVpcName: z.string().optional().describe("Transit VPC name. Required when the Transit VPC belongs to another account"),
      transitVpcConnectName: resourceName("transitVpcConnectName").optional().describe("Name (3-30 chars; lowercase letters, digits, '-'; starts with a letter). Auto-assigned if omitted"),
      transitVpcConnectDescription: descriptionField("transitVpcConnectDescription").optional().describe("Description (max 1,000 bytes)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the resource"),
    },
    async (params) => {
      const { dryRun, ...apiParams } = params;
      if ((apiParams.transitVpcLoginId === undefined) !== (apiParams.transitVpcName === undefined)) {
        throw new Error(L({
          ko: "잘못된 파라미터: 다른 계정의 Transit VPC 에 연결할 때는 transitVpcLoginId 와 transitVpcName 을 함께 지정해야 합니다.",
          en: "Invalid parameter: transitVpcLoginId and transitVpcName must be given together (cross-account Transit VPC).",
        }));
      }
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Transit VPC Connect Creation",
          endpoint: "/vpc/v2/createTransitVpcConnectInstance",
          requestParams: apiParams,
          noun: { ko: "Transit VPC Connect", en: "Transit VPC Connect" },
        });
      }
      return client.request("/vpc/v2/createTransitVpcConnectInstance", apiParams);
    }
  );

  defineTool(
    server,
    "ncloud_set_transit_vpc_connect_description",
    "Set or update the description of a Transit VPC Connect instance",
    {
      transitVpcConnectInstanceNo: z.string(reqField("transitVpcConnectInstanceNo")).describe("Transit VPC Connect instance number"),
      transitVpcConnectDescription: descriptionField("transitVpcConnectDescription").optional().describe("New description (max 1,000 bytes)"),
    },
    async (params) => client.request("/vpc/v2/setTransitVpcConnectDescription", params)
  );

  defineTool(
    server,
    "ncloud_accept_reject_transit_vpc_connect",
    "Accept or reject a pending cross-account Transit VPC Connect request (called by the Transit VPC owner account)",
    {
      transitVpcConnectInstanceNo: z.string(reqField("transitVpcConnectInstanceNo")).describe("Transit VPC Connect instance number"),
      isAccept: z.boolean(reqField("isAccept")).describe("true to accept, false to reject"),
    },
    async (params) => client.request("/vpc/v2/acceptOrRejectTransitVpcConnect", params)
  );

  defineTool(
    server,
    "ncloud_delete_transit_vpc_connect",
    "⚠️ Destructive: Delete a Transit VPC Connect instance (detaches the VPC from the Transit VPC). Set confirm=true to execute.",
    {
      transitVpcConnectInstanceNo: z.string(reqField("transitVpcConnectInstanceNo")).describe("Transit VPC Connect instance number to delete"),
    },
    async (params) => client.request("/vpc/v2/deleteTransitVpcConnectInstance", params),
    { destructive: { noun: "Transit VPC Connect", describe: (params) => params.transitVpcConnectInstanceNo } }
  );

  // ═══ Service Function Chain ════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_list_service_function_chains",
    "List Service Function Chains (summary fields only — use ncloud_get_service_function_chain_detail for chainList / destination CIDRs)",
    {
      serviceFunctionChainName: z.string().optional().describe("Filter: names containing this string"),
      vpcName: z.string().optional().describe("Filter: VPC names containing this string"),
      pageNo: z.number().int().min(0).optional().describe("Page number (requires pageSize)"),
      pageSize: z.number().int().min(1).optional().describe("Results per page (required when pageNo is given)"),
      sortedBy: z.enum(["serviceFunctionChainNo", "serviceFunctionChainName", "vpcName", "zoneCode"]).optional().describe("Sort key"),
      sortingOrder: z.enum(["ASC", "DESC"]).optional().describe("Sort order (default ASC)"),
    },
    async (params) => {
      checkPaging(params);
      return client.request("/vpc/v2/getServiceFunctionChainList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_service_function_chain_detail",
    "Get details of a Service Function Chain, including the ordered chainList and destination CIDR blocks",
    {
      serviceFunctionChainNo: z.string(reqField("serviceFunctionChainNo")).describe("Service Function Chain number"),
    },
    async (params) => client.request("/vpc/v2/getServiceFunctionChainDetail", params)
  );

  defineTool(
    server,
    "ncloud_create_service_function_chain",
    "Create a Service Function Chain (steers traffic through inline SVR/LB hops to a final gateway). Only allowed in a Transit VPC. " +
      "Use dryRun=true to preview the flattened request.",
    {
      zoneCode: z.string(reqField("zoneCode")).describe("Zone code (e.g. KR-1)"),
      vpcNo: z.string(reqField("vpcNo")).describe("Transit VPC number (vpcTypeCode=TRANSIT)"),
      chainList: chainListSchema,
      destinationCidrBlockList: destinationCidrListSchema.optional().describe("Destination IPv4 CIDR blocks (e.g. [\"10.0.0.0/16\"])"),
      serviceFunctionChainName: resourceName("serviceFunctionChainName").optional().describe("Name (3-30 chars; lowercase letters, digits, '-'; starts with a letter). Auto-assigned if omitted"),
      serviceFunctionChainDescription: descriptionField("serviceFunctionChainDescription").optional().describe("Description (max 1,000 bytes)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the resource"),
    },
    async (params) => {
      const { dryRun, chainList, destinationCidrBlockList, ...rest } = params;
      validateChain(chainList);
      const apiParams: Record<string, string> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) apiParams[k] = String(v);
      flattenChain(apiParams, chainList);
      indexed(apiParams, "destinationCidrBlockList", destinationCidrBlockList);
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Service Function Chain Creation",
          endpoint: "/vpc/v2/createServiceFunctionChain",
          requestParams: apiParams,
          noun: { ko: "Service Function Chain", en: "Service Function Chain" },
        });
      }
      return client.request("/vpc/v2/createServiceFunctionChain", apiParams);
    }
  );

  defineTool(
    server,
    "ncloud_change_service_function_chain_configuration",
    "Change a Service Function Chain's chainList and/or destination CIDR list. At least one is required. " +
      "Each list you send REPLACES the existing list entirely; a list you omit is left unchanged.",
    {
      serviceFunctionChainNo: z.string(reqField("serviceFunctionChainNo")).describe("Service Function Chain number"),
      chainList: chainListSchema.optional(),
      destinationCidrBlockList: destinationCidrListSchema.min(1).optional().describe("New full destination CIDR list (replaces the existing one)"),
    },
    async (params) => {
      const { serviceFunctionChainNo, chainList, destinationCidrBlockList } = params;
      if (!chainList && !destinationCidrBlockList) {
        throw new Error(L({
          ko: "잘못된 파라미터: chainList 또는 destinationCidrBlockList 중 하나 이상이 필요합니다.",
          en: "Invalid parameter: at least one of chainList or destinationCidrBlockList is required.",
        }));
      }
      const apiParams: Record<string, string> = { serviceFunctionChainNo };
      if (chainList) {
        validateChain(chainList);
        flattenChain(apiParams, chainList);
      }
      indexed(apiParams, "destinationCidrBlockList", destinationCidrBlockList);
      return client.request("/vpc/v2/changeServiceFunctionChainConfiguration", apiParams);
    }
  );

  defineTool(
    server,
    "ncloud_set_service_function_chain_description",
    "Set or update the description of a Service Function Chain",
    {
      serviceFunctionChainNo: z.string(reqField("serviceFunctionChainNo")).describe("Service Function Chain number"),
      serviceFunctionChainDescription: descriptionField("serviceFunctionChainDescription").optional().describe("New description (max 1,000 bytes)"),
    },
    async (params) => client.request("/vpc/v2/setServiceFunctionChainDescription", params)
  );

  defineTool(
    server,
    "ncloud_delete_service_function_chain",
    "⚠️ Destructive: Delete a Service Function Chain (asynchronous — status goes to TERMTING). Set confirm=true to execute.",
    {
      serviceFunctionChainNo: z.string(reqField("serviceFunctionChainNo")).describe("Service Function Chain number to delete"),
    },
    async (params) => client.request("/vpc/v2/deleteServiceFunctionChain", params),
    { destructive: { noun: "Service Function Chain", describe: (params) => params.serviceFunctionChainNo } }
  );
}
