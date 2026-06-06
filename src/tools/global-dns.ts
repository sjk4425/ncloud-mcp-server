import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

export function registerGlobalDnsTools(server: McpServer, client: NcloudClient): void {
  // ─── Domain Management Tools ─────────────────────────────────────────────────

  server.tool(
    "ncloud_dns_list_domains",
    "List Global DNS domains with pagination. Returns Spring Page structure (content, pageable, totalElements).",
    {
      page: z.number({ required_error: "필수 파라미터 'page'가 누락되었습니다." }).describe("Page number (0-based)"),
      size: z.number({ required_error: "필수 파라미터 'size'가 누락되었습니다." }).describe("Number of items per page"),
      domainName: z.string().optional().describe("Filter by domain name"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          page: String(params.page),
          size: String(params.size),
        };
        if (params.domainName !== undefined) {
          queryParams.domainName = params.domainName;
        }
        const result = await client.requestRaw("GET", "/dns/v1/ncpdns/domain", queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dns_get_domain_detail",
    "Get detailed information about a specific Global DNS domain",
    {
      domainId: z.number({ required_error: "필수 파라미터 'domainId'가 누락되었습니다." }).describe("Domain ID to query"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/dns/v1/ncpdns/domain/${params.domainId}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dns_create_domain",
    "Create a new Global DNS domain",
    {
      name: z.string({ required_error: "필수 파라미터 'name'이 누락되었습니다." }).describe("Domain name (e.g., example.com)"),
      comment: z.string().optional().describe("Optional comment for the domain"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = { name: params.name };
        if (params.comment !== undefined) {
          body.comment = params.comment;
        }
        const result = await client.requestRaw("POST", "/dns/v1/ncpdns/domain", undefined, body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dns_delete_domain",
    "⚠️ Destructive: Permanently delete a Global DNS domain. All records under this domain will be removed. Set confirm=true to execute.",
    {
      domainId: z.number({ required_error: "필수 파라미터 'domainId'가 누락되었습니다." }).describe("Domain ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Global DNS Domain [${params.domainId}] and all associated records.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.requestRaw("DELETE", `/dns/v1/ncpdns/domain/${params.domainId}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dns_apply_domain",
    "Apply pending changes to a Global DNS domain (publish DNS records)",
    {
      domainId: z.number({ required_error: "필수 파라미터 'domainId'가 누락되었습니다." }).describe("Domain ID to apply"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("PUT", `/dns/v1/ncpdns/domain/${params.domainId}/apply`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dns_rollback_domain",
    "⚠️ Destructive: Rollback a Global DNS domain to the previously applied state. Pending changes will be discarded. Set confirm=true to execute.",
    {
      domainId: z.number({ required_error: "필수 파라미터 'domainId'가 누락되었습니다." }).describe("Domain ID to rollback"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will rollback Global DNS Domain [${params.domainId}] to the previously applied state. All pending changes will be discarded.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.requestRaw("PUT", `/dns/v1/ncpdns/domain/${params.domainId}/rollback`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Record Management Tools ──────────────────────────────────────────────────

  server.tool(
    "ncloud_dns_list_records",
    "List DNS records for a specific Global DNS domain with pagination",
    {
      domainId: z.number({ required_error: "필수 파라미터 'domainId'가 누락되었습니다." }).describe("Domain ID to list records for"),
      page: z.number({ required_error: "필수 파라미터 'page'가 누락되었습니다." }).describe("Page number (0-based)"),
      size: z.number({ required_error: "필수 파라미터 'size'가 누락되었습니다." }).describe("Number of items per page"),
      recordType: z.enum(["A", "AAAA", "CNAME", "MX", "PTR", "SPF", "TXT", "NS", "SRV", "CAA", "DS"]).optional().describe("Filter by record type"),
      searchContent: z.string().optional().describe("Search filter for record content"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          page: String(params.page),
          size: String(params.size),
        };
        if (params.recordType !== undefined) {
          queryParams.recordType = params.recordType;
        }
        if (params.searchContent !== undefined) {
          queryParams.searchContent = params.searchContent;
        }
        const result = await client.requestRaw("GET", `/dns/v1/ncpdns/record/${params.domainId}`, queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dns_create_records",
    "Create DNS records for a specific Global DNS domain",
    {
      domainId: z.number({ required_error: "필수 파라미터 'domainId'가 누락되었습니다." }).describe("Domain ID to create records for"),
      records: z.array(z.object({
        host: z.string().describe("Record host name"),
        type: z.string().describe("Record type (A, AAAA, CNAME, MX, PTR, SPF, TXT, NS, SRV, CAA, DS)"),
        content: z.string().describe("Record content/value"),
        ttl: z.number().describe("TTL in seconds"),
        aliasId: z.number().optional().describe("Alias ID (optional)"),
        lbId: z.number().optional().describe("Load Balancer ID (optional)"),
        lbRegionCode: z.string().optional().describe("Load Balancer region code (optional)"),
      }), { required_error: "필수 파라미터 'records'가 누락되었습니다." }).describe("Array of DNS records to create"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/dns/v1/ncpdns/record/${params.domainId}`, undefined, params.records);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dns_update_records",
    "Update DNS records for a specific Global DNS domain",
    {
      domainId: z.number({ required_error: "필수 파라미터 'domainId'가 누락되었습니다." }).describe("Domain ID to update records for"),
      records: z.array(z.object({
        id: z.number().describe("Record ID to update"),
        host: z.string().describe("Record host name"),
        type: z.string().describe("Record type (A, AAAA, CNAME, MX, PTR, SPF, TXT, NS, SRV, CAA, DS)"),
        content: z.string().describe("Record content/value"),
        ttl: z.number().describe("TTL in seconds"),
        aliasId: z.number().optional().describe("Alias ID (optional)"),
        lbId: z.number().optional().describe("Load Balancer ID (optional)"),
        lbRegionCode: z.string().optional().describe("Load Balancer region code (optional)"),
      }), { required_error: "필수 파라미터 'records'가 누락되었습니다." }).describe("Array of DNS records to update"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("PUT", `/dns/v1/ncpdns/record/${params.domainId}`, undefined, params.records);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dns_delete_records",
    "⚠️ Destructive: Delete DNS records from a Global DNS domain. This permanently removes the specified records. Set confirm=true to execute.",
    {
      domainId: z.number({ required_error: "필수 파라미터 'domainId'가 누락되었습니다." }).describe("Domain ID to delete records from"),
      recordIds: z.array(z.number(), { required_error: "필수 파라미터 'recordIds'가 누락되었습니다." }).describe("Array of record IDs to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete ${params.recordIds.length} DNS record(s) from Domain [${params.domainId}].\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.requestRaw("DELETE", `/dns/v1/ncpdns/record/${params.domainId}`, undefined, { recordIds: params.recordIds });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dns_list_lb_records",
    "List available Load Balancer records for Global DNS integration",
    {},
    async () => {
      try {
        const result = await client.requestRaw("GET", "/dns/v1/ncpdns/record/lb");
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Monitoring Tools ─────────────────────────────────────────────────────────

  server.tool(
    "ncloud_dns_get_query_count",
    "Get DNS query count monitoring data for Global DNS domains",
    {
      baseTimeUnit: z.enum(["MINUTE_1", "MINUTE_5", "MINUTE_30", "HOUR_3", "DAY_1"], { required_error: "필수 파라미터 'baseTimeUnit'이 누락되었습니다." }).describe("Time unit for aggregation"),
      domainId: z.number().optional().describe("Filter by specific domain ID"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          baseTimeUnit: params.baseTimeUnit,
        };
        if (params.domainId !== undefined) {
          queryParams.domainId = String(params.domainId);
        }
        const result = await client.requestRaw("GET", "/dns/v1/ncpdns/domain/monitoring", queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
