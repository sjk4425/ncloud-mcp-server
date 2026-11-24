import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { reqField } from "./_zod.js";
import { L } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";
import { checkPaging, cidrField, descriptionField, indexed, resourceName } from "./network-transit-vpc.js";

/**
 * Endpoint Route Table (VPC API, 2026-11-24 민간존·금융존 릴리스) — 게이트웨이(IGW/VGW/Transit VPC Connect/POGW/OGW/NATGW)
 * 쪽에서 들어오는 트래픽의 라우팅을 정하는 라우트 테이블.
 *
 * 가이드: https://api.ncloud-docs.com/docs/networking-vpc-createendpointroutetable 외 11개.
 * 금융존은 릴리스 노트(api-fin …/api-releasenote-20261124)에 같은 파라미터로 공지 — 상세 페이지는 2026-11-25 기준 404.
 * 공공존은 미제공 → registry 에서 민간존·금융존만 등록.
 */

export const ENDPOINT_ROUTE_TABLE_TYPES = ["IGW", "VGW", "TRANSITVPCCONNECT", "POGW", "OGW", "NATGW"] as const;
/** 라우트 대상 유형 — 테이블 유형 목록에 SFC(Service Function Chain)가 더해진다. */
export const ENDPOINT_ROUTE_TARGET_TYPES = ["IGW", "VGW", "TRANSITVPCCONNECT", "SFC", "POGW", "NATGW", "OGW"] as const;

const TYPE_DESC =
  "IGW (Internet Gateway) | VGW (Virtual Private Gateway) | TRANSITVPCCONNECT (Transit VPC Connect) | " +
  "POGW (Public Onpremise Gateway) | OGW (Onpremise Gateway) | NATGW (NAT Gateway)";

const routeSchema = z.object({
  destinationCidrBlock: cidrField("destinationCidrBlock", "0.0.0.0/0").describe("Destination IPv4 CIDR (e.g. 0.0.0.0/0)"),
  targetTypeCode: z.enum(ENDPOINT_ROUTE_TARGET_TYPES, reqField("targetTypeCode")).describe(
    "Route target type: IGW | VGW | TRANSITVPCCONNECT | SFC (Service Function Chain) | POGW | NATGW | OGW"
  ),
  targetNo: z.string().optional().describe("Target instance number. Required for every type except IGW; must be omitted for IGW"),
});

type Route = z.output<typeof routeSchema>;

const routeListSchema = z.array(routeSchema).min(1).describe("Routes to add/remove");

const propagationSchema = z.object({
  targetTypeCode: z.string(reqField("targetTypeCode")).describe("Propagation source type (only types allowed for the table, e.g. VGW)"),
  targetNo: z.string(reqField("targetNo")).describe("Propagation source instance number"),
});

const propagationListSchema = z.array(propagationSchema).min(1).describe("Route propagation sources");

export function flattenRoutes(target: Record<string, string>, routes: Route[]): void {
  const errs: string[] = [];
  routes.forEach((r, i) => {
    if (r.targetTypeCode === "IGW" && r.targetNo !== undefined) errs.push(`routeList[${i}]: targetNo must be omitted for IGW`);
    if (r.targetTypeCode !== "IGW" && !r.targetNo) errs.push(`routeList[${i}]: targetNo is required for ${r.targetTypeCode}`);
    const p = `routeList.${i + 1}`;
    target[`${p}.destinationCidrBlock`] = r.destinationCidrBlock;
    target[`${p}.targetTypeCode`] = r.targetTypeCode;
    if (r.targetNo !== undefined) target[`${p}.targetNo`] = r.targetNo;
  });
  if (errs.length) throw new Error(L({ ko: "잘못된 routeList: ", en: "Invalid routeList: " }) + errs.join("; "));
}

function flattenPropagations(target: Record<string, string>, list: z.output<typeof propagationListSchema>): void {
  list.forEach((p, i) => {
    target[`propagationList.${i + 1}.targetTypeCode`] = p.targetTypeCode;
    target[`propagationList.${i + 1}.targetNo`] = p.targetNo;
  });
}

const ASSOC_NOTE = "Targets must be instances of the table's type. IGW- and POGW-type tables cannot change associations.";

export function registerEndpointRouteTableTools(server: McpServer, client: NcloudClient): void {
  // ─── Query ─────────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_endpoint_route_tables",
    "List Endpoint Route Tables (summary only — use ncloud_get_endpoint_route_table_detail for associations and routes)",
    {
      endpointRouteTableNoList: z.array(z.string()).optional().describe("Filter by Endpoint Route Table numbers"),
      vpcNo: z.string().optional().describe("Filter by VPC number"),
      endpointRouteTableName: z.string().optional().describe("Filter: names containing this string"),
      endpointRouteTableTypeCode: z.enum(ENDPOINT_ROUTE_TABLE_TYPES).optional().describe(`Filter by type: ${TYPE_DESC}`),
      pageNo: z.number().int().min(0).optional().describe("Page number (requires pageSize)"),
      pageSize: z.number().int().min(1).optional().describe("Results per page (required when pageNo is given)"),
    },
    async (params) => {
      checkPaging(params);
      return client.request("/vpc/v2/getEndpointRouteTableList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_endpoint_route_table_detail",
    "Get details of an Endpoint Route Table, including associationList and routeList",
    {
      endpointRouteTableNo: z.string(reqField("endpointRouteTableNo")).describe("Endpoint Route Table number"),
    },
    async (params) => client.request("/vpc/v2/getEndpointRouteTableDetail", params)
  );

  defineTool(
    server,
    "ncloud_list_endpoint_route_table_propagations",
    "List route propagation sources of an Endpoint Route Table",
    {
      endpointRouteTableNo: z.string(reqField("endpointRouteTableNo")).describe("Endpoint Route Table number"),
    },
    async (params) => client.request("/vpc/v2/getEndpointRouteTablePropagationList", params)
  );

  // ─── Create / Description ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_endpoint_route_table",
    "Create an Endpoint Route Table for a gateway type (routes traffic arriving from that gateway). Use dryRun=true to preview.",
    {
      vpcNo: z.string(reqField("vpcNo")).describe("VPC number"),
      endpointRouteTableTypeCode: z.enum(ENDPOINT_ROUTE_TABLE_TYPES, reqField("endpointRouteTableTypeCode")).describe(
        `Table type (only types enabled for the account/region): ${TYPE_DESC}`
      ),
      endpointRouteTableName: resourceName("endpointRouteTableName").optional().describe("Name (3-30 chars; lowercase letters, digits, '-'; starts with a letter). Auto-assigned if omitted"),
      endpointRouteTableDescription: descriptionField("endpointRouteTableDescription").optional().describe("Description (max 1,000 bytes)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the resource"),
    },
    async (params) => {
      const { dryRun, ...apiParams } = params;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Endpoint Route Table Creation",
          endpoint: "/vpc/v2/createEndpointRouteTable",
          requestParams: apiParams,
          noun: { ko: "Endpoint Route Table", en: "Endpoint Route Table" },
        });
      }
      return client.request("/vpc/v2/createEndpointRouteTable", apiParams);
    }
  );

  defineTool(
    server,
    "ncloud_set_endpoint_route_table_description",
    "Set or update the description of an Endpoint Route Table",
    {
      endpointRouteTableNo: z.string(reqField("endpointRouteTableNo")).describe("Endpoint Route Table number"),
      endpointRouteTableDescription: descriptionField("endpointRouteTableDescription").optional().describe("New description (max 1,000 bytes)"),
    },
    async (params) => client.request("/vpc/v2/setEndpointRouteTableDescription", params)
  );

  // ─── Associations ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_add_endpoint_route_table_associations",
    `Associate gateway instances with an Endpoint Route Table. ${ASSOC_NOTE}`,
    {
      endpointRouteTableNo: z.string(reqField("endpointRouteTableNo")).describe("Endpoint Route Table number"),
      targetNoList: z.array(z.string()).min(1, reqField("targetNoList")).describe("Instance numbers to associate (same type as the table)"),
    },
    async ({ endpointRouteTableNo, targetNoList }) => {
      const apiParams: Record<string, string> = { endpointRouteTableNo };
      indexed(apiParams, "targetNoList", targetNoList);
      return client.request("/vpc/v2/addEndpointRouteTableAssociation", apiParams);
    }
  );

  defineTool(
    server,
    "ncloud_remove_endpoint_route_table_associations",
    `⚠️ Destructive: Remove gateway associations from an Endpoint Route Table. ${ASSOC_NOTE} Set confirm=true to execute.`,
    {
      endpointRouteTableNo: z.string(reqField("endpointRouteTableNo")).describe("Endpoint Route Table number"),
      targetNoList: z.array(z.string()).min(1, reqField("targetNoList")).describe("Associated instance numbers to remove (see associationList in the detail)"),
    },
    async ({ endpointRouteTableNo, targetNoList }) => {
      const apiParams: Record<string, string> = { endpointRouteTableNo };
      indexed(apiParams, "targetNoList", targetNoList);
      return client.request("/vpc/v2/removeEndpointRouteTableAssociation", apiParams);
    },
    {
      destructive: {
        message: (p) =>
          `⚠️ This will remove association(s) [${(p.targetNoList ?? []).join(", ")}] from Endpoint Route Table [${p.endpointRouteTableNo}]. ` +
          "To execute, call this tool again with confirm=true.",
      },
    }
  );

  // ─── Routes ────────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_add_endpoint_route_table_routes",
    "Add routes to an Endpoint Route Table (targetNo is omitted for IGW, required otherwise)",
    {
      endpointRouteTableNo: z.string(reqField("endpointRouteTableNo")).describe("Endpoint Route Table number"),
      routeList: routeListSchema,
    },
    async ({ endpointRouteTableNo, routeList }) => {
      const apiParams: Record<string, string> = { endpointRouteTableNo };
      flattenRoutes(apiParams, routeList);
      return client.request("/vpc/v2/addEndpointRouteTableRoute", apiParams);
    }
  );

  defineTool(
    server,
    "ncloud_remove_endpoint_route_table_routes",
    "⚠️ Destructive: Remove routes from an Endpoint Route Table (values from routeList in the detail). Set confirm=true to execute.",
    {
      endpointRouteTableNo: z.string(reqField("endpointRouteTableNo")).describe("Endpoint Route Table number"),
      routeList: routeListSchema,
    },
    async ({ endpointRouteTableNo, routeList }) => {
      const apiParams: Record<string, string> = { endpointRouteTableNo };
      flattenRoutes(apiParams, routeList);
      return client.request("/vpc/v2/removeEndpointRouteTableRoute", apiParams);
    },
    {
      destructive: {
        message: (p) =>
          `⚠️ This will remove route(s) [${(p.routeList ?? []).map((r: Route) => r.destinationCidrBlock).join(", ")}] from Endpoint Route Table [${p.endpointRouteTableNo}]. ` +
          "To execute, call this tool again with confirm=true.",
      },
    }
  );

  // ─── Propagation ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_add_endpoint_route_table_propagations",
    "Enable route propagation from gateway instances (e.g. VGW) into an Endpoint Route Table",
    {
      endpointRouteTableNo: z.string(reqField("endpointRouteTableNo")).describe("Endpoint Route Table number"),
      propagationList: propagationListSchema,
    },
    async ({ endpointRouteTableNo, propagationList }) => {
      const apiParams: Record<string, string> = { endpointRouteTableNo };
      flattenPropagations(apiParams, propagationList);
      return client.request("/vpc/v2/addEndpointRouteTablePropagation", apiParams);
    }
  );

  defineTool(
    server,
    "ncloud_remove_endpoint_route_table_propagations",
    "⚠️ Destructive: Disable route propagation sources of an Endpoint Route Table (values from ncloud_list_endpoint_route_table_propagations). Set confirm=true to execute.",
    {
      endpointRouteTableNo: z.string(reqField("endpointRouteTableNo")).describe("Endpoint Route Table number"),
      propagationList: propagationListSchema,
    },
    async ({ endpointRouteTableNo, propagationList }) => {
      const apiParams: Record<string, string> = { endpointRouteTableNo };
      flattenPropagations(apiParams, propagationList);
      return client.request("/vpc/v2/removeEndpointRouteTablePropagation", apiParams);
    },
    {
      destructive: {
        message: (p) =>
          `⚠️ This will remove propagation source(s) [${(p.propagationList ?? []).map((x: { targetNo: string }) => x.targetNo).join(", ")}] from Endpoint Route Table [${p.endpointRouteTableNo}]. ` +
          "To execute, call this tool again with confirm=true.",
      },
    }
  );

  // ─── Delete ────────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_endpoint_route_table",
    "⚠️ Destructive: Permanently delete an Endpoint Route Table. Tables with associated targets cannot be deleted — remove associations first. Set confirm=true to execute.",
    {
      endpointRouteTableNo: z.string(reqField("endpointRouteTableNo")).describe("Endpoint Route Table number to delete"),
    },
    async (params) => client.request("/vpc/v2/deleteEndpointRouteTable", params),
    { destructive: { noun: "Endpoint Route Table", describe: (params) => params.endpointRouteTableNo } }
  );
}
