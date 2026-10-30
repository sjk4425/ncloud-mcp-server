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
    "Create a new Global DNS domain. The result includes the new domain ID (looked up by name after creation).",
    {
      name: z.string({ required_error: requiredError("name") }).describe("Domain name (e.g., example.com)"),
      // 가이드 DomainCreateRequest 의 설명 필드는 `comments`(세 존 동일). 예전 `comment` 는 저장되지 않았다(금융존 테스트).
      comments: z.string().optional().describe("Optional description for the domain"),
    },
    async (params) => {
      const body: Record<string, unknown> = { name: params.name };
      if (params.comments !== undefined) {
        body.comments = params.comments;
      }
      const result = await client.requestRaw("POST", "/dns/v1/ncpdns/domain", undefined, body);
      // 응답이 { success: true } 뿐이라 이름으로 다시 조회해 ID 를 붙인다. 조회 실패는 생성 결과를 막지 않는다.
      try {
        const page = await client.requestRaw("GET", "/dns/v1/ncpdns/domain", { page: "0", size: "20", domainName: params.name });
        const found = (page?.content ?? []).find((d: any) => d?.name === params.name);
        if (found?.id !== undefined) return { ...(result ?? {}), domainId: found.id, name: params.name };
      } catch {
        // 무시
      }
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_dns_delete_domain",
    "⚠️ Destructive: Permanently delete a Global DNS domain. A domain that still has records other than SOA/NS is rejected (X00006): " +
      "delete the records with ncloud_dns_delete_records, publish with ncloud_dns_apply_domain, then delete the domain. Set confirm=true to execute.",
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
      // 경로는 /record/apply/{domainId} — 예전 /domain/{id}/apply 는 게이트웨이 404(금융존 테스트 E-19, 직접 호출로 확인).
      return client.requestRaw("PUT", `/dns/v1/ncpdns/record/apply/${params.domainId}`);
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
      // 가이드 networking-globaldns-record-rollback: PUT /record/rollback/{domainId}(세 존 동일). 예전 /domain/{id}/rollback 은 404.
      const result = await client.requestRaw("PUT", `/dns/v1/ncpdns/record/rollback/${params.domainId}`);
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
      // Guide networking-globaldns-record-getrecordlist: page and size are Required query params → send defaults when omitted.
      domainId: z.number({ required_error: requiredError("domainId") }).describe("Domain ID to list records for"),
      page: z.number().int().min(0).optional().default(0).describe("Page number (0-based, default 0)"),
      size: z.number().int().min(1).optional().default(100).describe("Number of items per page (default 100)"),
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
    "⚠️ Destructive: Delete DNS records from a Global DNS domain. This permanently removes the specified records. " +
      "Run ncloud_dns_apply_domain afterwards to publish the deletion. Set confirm=true to execute.",
    {
      domainId: z.number({ required_error: requiredError("domainId") }).describe("Domain ID to delete records from"),
      recordIds: z.array(z.number(), { required_error: requiredError("recordIds") }).describe("Array of record IDs to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      // 본문은 레코드 ID 배열 그 자체다 — { recordIds } 로 감싸면 400 X00008(금융존 테스트 E-18, 직접 호출로 확인).
      const result = await client.requestRaw("DELETE", `/dns/v1/ncpdns/record/${params.domainId}`, undefined, params.recordIds);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete ${params.recordIds.length} DNS record(s) from Domain [${params.domainId}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_dns_list_lb_records",
    "List load balancers that can be linked to a Global DNS record (returns sid and name)",
    {
      // 가이드 networking-globaldns-record-getlbrecordlist: GET /lb-record/{platformType}/{recordType}.
      //   예전 /record/lb 는 존재하지 않는 경로라 500 X00001 이었다(금융존 테스트). 금융존 가이드는 VPC/A 만 싣는다.
      platformType: z.enum(["VPC", "CLASSIC"]).default("VPC").describe("Platform type: VPC (default) | CLASSIC (CLASSIC is not available in every zone)"),
      recordType: z.enum(["A", "AAAA", "CNAME", "MX", "PTR", "SPF", "TXT", "NS", "SRV", "CAA", "DS"]).default("A").describe("Record type (default A)"),
      searchContent: z.string().optional().describe("Filter by load balancer name"),
      lbRegionCode: z.string().optional().describe("Load balancer region (public zone only: KR | SGN, default KR)"),
    },
    async (params) => {
      const query: Record<string, string> = {};
      if (params.searchContent !== undefined) query.searchContent = params.searchContent;
      if (params.lbRegionCode !== undefined) query.lbRegionCode = params.lbRegionCode;
      return client.requestRaw("GET", `/dns/v1/ncpdns/lb-record/${params.platformType}/${params.recordType}`, Object.keys(query).length ? query : undefined);
    }
  );

  // ─── Monitoring Tools ─────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_dns_get_query_count",
    "Get DNS query count monitoring data for Global DNS domains",
    {
      // v1 가이드에는 기간 파라미터가 없다(세 존 동일) — 단위가 클수록 많은 포인트가 온다(DAY_1 ≈ 2년치).
      baseTimeUnit: z.enum(["MINUTE_1", "MINUTE_5", "MINUTE_30", "HOUR_3", "DAY_1"], { required_error: requiredError("baseTimeUnit") }).describe("Time unit for aggregation. There is no time-range filter; DAY_1 returns about two years of points"),
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
