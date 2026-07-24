import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError } from "./_messages.js";

export function registerGlobalDnsTools(server: McpServer, client: NcloudClient): void {
  // ─── Domain Management Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_dns_list_domains",
    "List Global DNS domains with pagination. Returns Spring Page structure (content, pageable, totalElements).",
    {
      page: z.number({ required_error: requiredError("page") }).describe("Page number (0-based)"),
      size: z.number({ required_error: requiredError("size") }).describe("Number of items per page"),
      domainName: z.string().optional().describe("Filter by domain name"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {
        page: String(params.page),
        size: String(params.size),
      };
      if (params.domainName !== undefined) {
        queryParams.domainName = params.domainName;
      }
      const result = await client.requestRaw("GET", "/dns/v1/ncpdns/domain", queryParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_dns_get_domain_detail",
    "Get detailed information about a specific Global DNS domain",
    {
      domainId: z.number({ required_error: requiredError("domainId") }).describe("Domain ID to query"),
    },
    async (params) => {
      return client.requestRaw("GET", `/dns/v1/ncpdns/domain/${params.domainId}`);
    }
  );

  defineTool(
    server,
    "ncloud_dns_create_domain",
    "Create a new Global DNS domain",
    {
      name: z.string({ required_error: requiredError("name") }).describe("Domain name (e.g., example.com)"),
      comment: z.string().optional().describe("Optional comment for the domain"),
    },
    async (params) => {
      const body: Record<string, unknown> = { name: params.name };
      if (params.comment !== undefined) {
        body.comment = params.comment;
      }
      const result = await client.requestRaw("POST", "/dns/v1/ncpdns/domain", undefined, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_dns_delete_domain",
    "⚠️ Destructive: Permanently delete a Global DNS domain. All records under this domain will be removed. Set confirm=true to execute.",
    {
      domainId: z.number({ required_error: requiredError("domainId") }).describe("Domain ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `/dns/v1/ncpdns/domain/${params.domainId}`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Global DNS Domain [${params.domainId}] and all associated records.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_dns_apply_domain",
    "Apply pending changes to a Global DNS domain (publish DNS records)",
    {
      domainId: z.number({ required_error: requiredError("domainId") }).describe("Domain ID to apply"),
    },
    async (params) => {
      return client.requestRaw("PUT", `/dns/v1/ncpdns/domain/${params.domainId}/apply`);
    }
  );

  defineTool(
    server,
    "ncloud_dns_rollback_domain",
    "⚠️ Destructive: Rollback a Global DNS domain to the previously applied state. Pending changes will be discarded. Set confirm=true to execute.",
    {
      domainId: z.number({ required_error: requiredError("domainId") }).describe("Domain ID to rollback"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("PUT", `/dns/v1/ncpdns/domain/${params.domainId}/rollback`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will rollback Global DNS Domain [${params.domainId}] to the previously applied state. All pending changes will be discarded.\n\nTo execute, call this tool again with confirm=true.` } }
  );


  // ─── Record Management Tools ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_dns_list_records",
    "List DNS records for a specific Global DNS domain with pagination",
    {
      domainId: z.number({ required_error: requiredError("domainId") }).describe("Domain ID to list records for"),
      page: z.number({ required_error: requiredError("page") }).describe("Page number (0-based)"),
      size: z.number({ required_error: requiredError("size") }).describe("Number of items per page"),
      recordType: z.enum(["A", "AAAA", "CNAME", "MX", "PTR", "SPF", "TXT", "NS", "SRV", "CAA", "DS"]).optional().describe("Filter by record type"),
      searchContent: z.string().optional().describe("Search filter for record content"),
    },
    async (params) => {
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
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_dns_create_records",
    "Create DNS records for a specific Global DNS domain",
    {
      domainId: z.number({ required_error: requiredError("domainId") }).describe("Domain ID to create records for"),
      records: z.array(z.object({
        host: z.string().describe("Record host name"),
        type: z.string().describe("Record type (A, AAAA, CNAME, MX, PTR, SPF, TXT, NS, SRV, CAA, DS)"),
        content: z.string().describe("Record content/value"),
        ttl: z.number().describe("TTL in seconds"),
        aliasId: z.number().optional().describe("Alias ID (optional)"),
        lbId: z.number().optional().describe("Load Balancer ID (optional)"),
        lbRegionCode: z.string().optional().describe("Load Balancer region code (optional)"),
      }), { required_error: requiredError("records") }).describe("Array of DNS records to create"),
    },
    async (params) => {
      return client.requestRaw("POST", `/dns/v1/ncpdns/record/${params.domainId}`, undefined, params.records);
    }
  );

  defineTool(
    server,
    "ncloud_dns_update_records",
    "Update DNS records for a specific Global DNS domain",
    {
      domainId: z.number({ required_error: requiredError("domainId") }).describe("Domain ID to update records for"),
      records: z.array(z.object({
        id: z.number().describe("Record ID to update"),
        host: z.string().describe("Record host name"),
        type: z.string().describe("Record type (A, AAAA, CNAME, MX, PTR, SPF, TXT, NS, SRV, CAA, DS)"),
        content: z.string().describe("Record content/value"),
        ttl: z.number().describe("TTL in seconds"),
        aliasId: z.number().optional().describe("Alias ID (optional)"),
        lbId: z.number().optional().describe("Load Balancer ID (optional)"),
        lbRegionCode: z.string().optional().describe("Load Balancer region code (optional)"),
      }), { required_error: requiredError("records") }).describe("Array of DNS records to update"),
    },
    async (params) => {
      return client.requestRaw("PUT", `/dns/v1/ncpdns/record/${params.domainId}`, undefined, params.records);
    }
  );

  defineTool(
    server,
    "ncloud_dns_delete_records",
    "⚠️ Destructive: Delete DNS records from a Global DNS domain. This permanently removes the specified records. Set confirm=true to execute.",
    {
      domainId: z.number({ required_error: requiredError("domainId") }).describe("Domain ID to delete records from"),
      recordIds: z.array(z.number(), { required_error: requiredError("recordIds") }).describe("Array of record IDs to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `/dns/v1/ncpdns/record/${params.domainId}`, undefined, { recordIds: params.recordIds });
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete ${params.recordIds.length} DNS record(s) from Domain [${params.domainId}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_dns_list_lb_records",
    "List available Load Balancer records for Global DNS integration",
    {},
    async () => {
      return client.requestRaw("GET", "/dns/v1/ncpdns/record/lb");
    }
  );

  // ─── Monitoring Tools ─────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_dns_get_query_count",
    "Get DNS query count monitoring data for Global DNS domains",
    {
      baseTimeUnit: z.enum(["MINUTE_1", "MINUTE_5", "MINUTE_30", "HOUR_3", "DAY_1"], { required_error: requiredError("baseTimeUnit") }).describe("Time unit for aggregation"),
      domainId: z.number().optional().describe("Filter by specific domain ID"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {
        baseTimeUnit: params.baseTimeUnit,
      };
      if (params.domainId !== undefined) {
        queryParams.domainId = String(params.domainId);
      }
      const result = await client.requestRaw("GET", "/dns/v1/ncpdns/domain/monitoring", queryParams);
      return result;
    }
  );
}
