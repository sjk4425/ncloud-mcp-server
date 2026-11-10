import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";
import { withQuery } from "./_query.js";

/**
 * Global DNS API v2 (공공기관존 전용, 2026-10-22 "Ncloud 표준 스타일" 개편판).
 *
 * 베이스 URL `https://globaldns.apigw.gov-ntruss.com` + `/dns/v2/...`. 공공존에서는 v1 도구를 대체하며,
 * v1 과 의미가 같은 오퍼레이션은 v1 도구 이름을 그대로 재사용한다(공공존 사용자에게 같은 이름으로 보이도록).
 *
 * - 도메인 생성/수정/삭제와 레코드 apply 는 비동기(202 Operation {id, done, metadata, error}) —
 *   operation 조회 도구로 done=true 가 될 때까지 폴링한다. Operation 은 30일 보관.
 * - 레코드 생성/수정/삭제는 apply 전까지 대기(pending) 상태다.
 * - `If-Match` 헤더(낙관적 잠금, 선택)는 `NcloudClient.requestRaw` 가 임의 헤더를 지원하지 않아 생략한다.
 */

const BASE = "/dns/v2";
const enc = (v: string | number) => encodeURIComponent(String(v));
const domainPath = (domainNo: number) => `${BASE}/domains/${enc(domainNo)}`;
const recordsPath = (domainNo: number) => `${domainPath(domainNo)}/records`;

const RECORD_TYPES = ["A", "AAAA", "CAA", "CNAME", "DS", "MX", "NS", "PTR", "SPF", "SRV", "TXT"] as const;
const TIME_UNITS = ["MINUTE_1", "MINUTE_5", "MINUTE_30", "HOUR_3", "DAY_1"] as const;

const DOMAIN_NO = z.number({ required_error: requiredError("domainNo") }).int().describe("Domain number (domainNo, see ncloud_dns_list_domains)");
const RECORD_NO = z.number({ required_error: requiredError("recordNo") }).int().describe("Record number (recordNo, see ncloud_dns_list_records)");
const OPERATION_ID = z.string({ required_error: requiredError("operationId") }).min(1).describe("Operation ID returned by an async (202) call");
const PAGE_NO = z.number().int().min(0).optional().describe("Page number (0-based, default 0)");
const PAGE_SIZE = z.number().int().min(1).max(1000).optional().describe("Page size (1-1000, default 20)");
const DRY_RUN = z.boolean().optional().default(false).describe("If true, returns a preview of the request without calling the API");

const sortSchema = (pattern: RegExp, fields: string) =>
  z
    .array(z.string().regex(pattern, { message: L({ ko: `sort 형식: <필드>[,asc|desc], 필드=${fields}`, en: `sort format: <field>[,asc|desc], field=${fields}` }) }))
    .optional()
    .describe(`Sort orders, each "<field>" or "<field>,asc|desc" (field: ${fields}). Sent as repeated sort= query params`);

const OPERATION_SORT = sortSchema(/^(metadata\.startDateTime|metadata\.endDateTime|id)(,(asc|desc))?$/, "metadata.startDateTime | metadata.endDateTime | id");

/** v2 RecordSpec — 단건 생성/수정과 배치 생성/수정이 공유한다. */
const RECORD_SPEC_SHAPE = {
  host: z.string().max(255).optional().describe('Host label. "" or "@" or omitted = zone apex'),
  type: z.enum(RECORD_TYPES, { required_error: requiredError("type") }).describe("Record type"),
  content: z.string({ required_error: requiredError("content") }).min(1).describe("Record value. Put multiple values on separate lines (newline-separated)"),
  ttl: z.number({ required_error: requiredError("ttl") }).int().min(0).max(2147483647).describe("TTL in seconds (0-2147483647)"),
  aliasNo: z.number().int().optional().describe("Alias target record number (optional)"),
  loadBalancerNo: z.number().int().optional().describe("Load balancer number to link (requires loadBalancerRegionCode; see ncloud_dns_list_lb_records)"),
  loadBalancerRegionCode: z.string().optional().describe("Region code of the linked load balancer (required with loadBalancerNo)"),
};

type RecordSpec = {
  host?: string;
  type: string;
  content: string;
  ttl: number;
  aliasNo?: number;
  loadBalancerNo?: number;
  loadBalancerRegionCode?: string;
};

const RECORD_SPEC = z.object(RECORD_SPEC_SHAPE);
const RECORD_SPEC_WITH_NO = z.object({ recordNo: z.number({ required_error: requiredError("recordNo") }).int().describe("Record number to update"), ...RECORD_SPEC_SHAPE });

/** 전송 본문 정리 — undefined 필드 제거(얕은 복사). */
function compact(o: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

/** loadBalancerNo 는 loadBalancerRegionCode 와 함께여야 한다. 위반 시 에러 문구, 아니면 null. */
function lbPairError(records: RecordSpec[]): string | null {
  const idx = records.findIndex((r) => r.loadBalancerNo !== undefined && !r.loadBalancerRegionCode);
  if (idx < 0) return null;
  return L({
    ko: `loadBalancerNo 를 지정하면 loadBalancerRegionCode 도 필수입니다(레코드 #${idx + 1}).`,
    en: `loadBalancerRegionCode is required when loadBalancerNo is set (record #${idx + 1}).`,
  });
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/** 202 Operation 응답에 폴링 안내를 붙인다. */
function withOperationHint(result: any, pollTool: string, extra: string): any {
  if (result && typeof result === "object" && !Array.isArray(result) && "id" in result && result.done !== true) {
    return { ...result, nextStep: `Async operation accepted. Poll ${pollTool} with operationId="${result.id}"${extra} until done=true (check error when done).` };
  }
  return result;
}

const ASYNC_NOTE = "Async: returns 202 with an Operation {id, done, metadata.phase}; poll ";
const PENDING_NOTE = "The change stays pending until ncloud_dns_apply_domain is called (or discarded by ncloud_dns_rollback_domain).";

export function registerGlobalDnsV2Tools(server: McpServer, client: NcloudClient): void {
  // ─── Domains ─────────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_dns_list_domains",
    "List Global DNS domains (v2) with pagination, optional name filter and sort.",
    {
      name: z.string().optional().describe("Filter by domain name"),
      pageNo: PAGE_NO,
      pageSize: PAGE_SIZE,
      sort: sortSchema(/^(name|status)(,(asc|desc))?$/, "name | status"),
    },
    async (params) =>
      client.requestRaw("GET", withQuery(`${BASE}/domains`, { name: params.name, pageNo: params.pageNo, pageSize: params.pageSize, sort: params.sort }))
  );

  defineTool(
    server,
    "ncloud_dns_get_domain_detail",
    "Get detailed information about a specific Global DNS domain (v2).",
    { domainNo: DOMAIN_NO },
    async (params) => client.requestRaw("GET", domainPath(params.domainNo))
  );

  defineTool(
    server,
    "ncloud_dns_create_domain",
    `Create a Global DNS domain (v2). ${ASYNC_NOTE}ncloud_dns_get_domain_operation until done=true. Use dryRun=true to preview.`,
    {
      name: z.string({ required_error: requiredError("name") }).min(1).max(255).describe("Domain name (FQDN, max 255 chars, e.g. example.com)"),
      dnssecEnabled: z.boolean({ required_error: requiredError("dnssecEnabled") }).describe("Whether to enable DNSSEC"),
      description: z.string().max(1000).optional().describe("Domain description (max 1000 chars)"),
      dryRun: DRY_RUN,
    },
    async (params) => {
      const { dryRun, ...rest } = params;
      const body = compact(rest);
      const endpoint = `${BASE}/domains`;
      if (dryRun) {
        return dryRunPreview({ label: "🔍 Dry-Run Preview: Global DNS Domain Creation", endpoint, method: "POST", requestParams: body, noun: { ko: "Global DNS 도메인", en: "Global DNS domain" } });
      }
      return withOperationHint(await client.requestRaw("POST", endpoint, undefined, body), "ncloud_dns_get_domain_operation", "");
    }
  );

  defineTool(
    server,
    "ncloud_dns_update_domain",
    `Update a Global DNS domain (v2). Full replacement: an omitted description is cleared. ${ASYNC_NOTE}ncloud_dns_get_domain_operation until done=true. Use dryRun=true to preview.`,
    {
      domainNo: DOMAIN_NO,
      dnssecEnabled: z.boolean({ required_error: requiredError("dnssecEnabled") }).describe("Whether DNSSEC is enabled"),
      description: z.string().max(1000).optional().describe("Domain description (max 1000 chars). Omit to clear it"),
      dryRun: DRY_RUN,
    },
    async (params) => {
      const { dryRun, domainNo, ...rest } = params;
      const body = compact(rest);
      const endpoint = domainPath(domainNo);
      if (dryRun) {
        return dryRunPreview({ label: "🔍 Dry-Run Preview: Global DNS Domain Update", endpoint, method: "PUT", requestParams: body, noun: { ko: "Global DNS 도메인 변경", en: "Global DNS domain update" }, verb: "apply" });
      }
      return withOperationHint(await client.requestRaw("PUT", endpoint, undefined, body), "ncloud_dns_get_domain_operation", "");
    }
  );

  defineTool(
    server,
    "ncloud_dns_delete_domain",
    "⚠️ Destructive: Permanently delete a Global DNS domain (v2). Only the default records (SOA/NS/DS) may remain, otherwise 409 ResourceInUse: " +
      "delete the other records (ncloud_dns_delete_records), publish with ncloud_dns_apply_domain, then delete the domain. " +
      `${ASYNC_NOTE}ncloud_dns_get_domain_operation until done=true. Set confirm=true to execute.`,
    { domainNo: DOMAIN_NO },
    async (params) => withOperationHint(await client.requestRaw("DELETE", domainPath(params.domainNo)), "ncloud_dns_get_domain_operation", ""),
    { destructive: { noun: "Global DNS Domain", describe: (p) => String(p.domainNo) } }
  );

  defineTool(
    server,
    "ncloud_dns_get_domain_operation",
    "Get the status of an async Global DNS domain operation (create/update/delete). Poll until done=true; check error when done. Operations are kept for 30 days.",
    { operationId: OPERATION_ID },
    async (params) => client.requestRaw("GET", `${BASE}/domains/operations/${enc(params.operationId)}`)
  );

  defineTool(
    server,
    "ncloud_dns_list_domain_operations",
    "List async Global DNS domain operations (create/update/delete) from the last 30 days.",
    { pageNo: PAGE_NO, pageSize: PAGE_SIZE, sort: OPERATION_SORT },
    async (params) =>
      client.requestRaw("GET", withQuery(`${BASE}/domains/operations`, { pageNo: params.pageNo, pageSize: params.pageSize, sort: params.sort }))
  );

  // ─── Records ─────────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_dns_list_records",
    "List DNS records of a Global DNS domain (v2) with pagination, optional type/content filter and sort.",
    {
      domainNo: DOMAIN_NO,
      type: z.enum(RECORD_TYPES).optional().describe("Filter by record type"),
      searchContent: z.string().optional().describe("Search filter for record content"),
      pageNo: PAGE_NO,
      pageSize: PAGE_SIZE,
      sort: sortSchema(
        /^(name|host|type|content|ttl|createdTimestamp|updatedTimestamp|recordNo)(,(asc|desc))?$/,
        "name | host | type | content | ttl | createdTimestamp | updatedTimestamp | recordNo"
      ),
    },
    async (params) => {
      const { domainNo, ...q } = params;
      return client.requestRaw("GET", withQuery(recordsPath(domainNo), { type: q.type, searchContent: q.searchContent, pageNo: q.pageNo, pageSize: q.pageSize, sort: q.sort }));
    }
  );

  defineTool(
    server,
    "ncloud_dns_get_record",
    "Get a single DNS record of a Global DNS domain (v2).",
    { domainNo: DOMAIN_NO, recordNo: RECORD_NO },
    async (params) => client.requestRaw("GET", `${recordsPath(params.domainNo)}/${enc(params.recordNo)}`)
  );

  defineTool(
    server,
    "ncloud_dns_create_record",
    `Create one DNS record in a Global DNS domain (v2). ${PENDING_NOTE} Use dryRun=true to preview.`,
    { domainNo: DOMAIN_NO, ...RECORD_SPEC_SHAPE, dryRun: DRY_RUN },
    async (params) => {
      const { dryRun, domainNo, ...spec } = params;
      const err = lbPairError([spec]);
      if (err) return errorResult(err);
      const body = compact(spec);
      const endpoint = recordsPath(domainNo);
      if (dryRun) {
        return dryRunPreview({ label: "🔍 Dry-Run Preview: Global DNS Record Creation", endpoint, method: "POST", requestParams: body, noun: { ko: "DNS 레코드", en: "DNS record" } });
      }
      return client.requestRaw("POST", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_dns_create_records",
    `Create 1-500 DNS records in a Global DNS domain (v2) in one all-or-nothing batch. ${PENDING_NOTE} Use dryRun=true to preview.`,
    {
      domainNo: DOMAIN_NO,
      records: z.array(RECORD_SPEC, { required_error: requiredError("records") }).min(1).max(500).describe("Records to create (1-500)"),
      dryRun: DRY_RUN,
    },
    async (params) => {
      const err = lbPairError(params.records);
      if (err) return errorResult(err);
      const body = { records: params.records.map(compact) };
      const endpoint = `${recordsPath(params.domainNo)}/batch-create`;
      if (params.dryRun) {
        return dryRunPreview({ label: "🔍 Dry-Run Preview: Global DNS Batch Record Creation", endpoint, method: "POST", requestParams: body, noun: { ko: "DNS 레코드", en: "DNS records" } });
      }
      return client.requestRaw("POST", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_dns_update_record",
    `Update one DNS record of a Global DNS domain (v2). Full replacement: omitted optional fields are cleared. ${PENDING_NOTE} Use dryRun=true to preview.`,
    { domainNo: DOMAIN_NO, recordNo: RECORD_NO, ...RECORD_SPEC_SHAPE, dryRun: DRY_RUN },
    async (params) => {
      const { dryRun, domainNo, recordNo, ...spec } = params;
      const err = lbPairError([spec]);
      if (err) return errorResult(err);
      const body = compact(spec);
      const endpoint = `${recordsPath(domainNo)}/${enc(recordNo)}`;
      if (dryRun) {
        return dryRunPreview({ label: "🔍 Dry-Run Preview: Global DNS Record Update", endpoint, method: "PUT", requestParams: body, noun: { ko: "DNS 레코드 변경", en: "DNS record update" }, verb: "apply" });
      }
      return client.requestRaw("PUT", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_dns_update_records",
    `Update 1-500 DNS records of a Global DNS domain (v2) in one batch. Each entry is a full replacement identified by recordNo. ${PENDING_NOTE} Use dryRun=true to preview.`,
    {
      domainNo: DOMAIN_NO,
      records: z.array(RECORD_SPEC_WITH_NO, { required_error: requiredError("records") }).min(1).max(500).describe("Records to update (1-500), each with recordNo"),
      dryRun: DRY_RUN,
    },
    async (params) => {
      const err = lbPairError(params.records);
      if (err) return errorResult(err);
      const body = { records: params.records.map(compact) };
      const endpoint = `${recordsPath(params.domainNo)}/batch-update`;
      if (params.dryRun) {
        return dryRunPreview({ label: "🔍 Dry-Run Preview: Global DNS Batch Record Update", endpoint, method: "POST", requestParams: body, noun: { ko: "DNS 레코드 변경", en: "DNS record updates" }, verb: "apply" });
      }
      return client.requestRaw("POST", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_dns_delete_record",
    `⚠️ Destructive: Delete one DNS record from a Global DNS domain (v2). Default records (SOA/NS/DS) cannot be deleted. ${PENDING_NOTE} Set confirm=true to execute.`,
    { domainNo: DOMAIN_NO, recordNo: RECORD_NO },
    async (params) => client.requestRaw("DELETE", `${recordsPath(params.domainNo)}/${enc(params.recordNo)}`),
    { destructive: { message: (p) => `⚠️ This will delete DNS record [${p.recordNo}] from Domain [${p.domainNo}] (effective after ncloud_dns_apply_domain).\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_dns_delete_records",
    `⚠️ Destructive: Delete 1-500 DNS records from a Global DNS domain (v2) in one batch. Default records (SOA/NS/DS) cannot be deleted. ${PENDING_NOTE} Set confirm=true to execute.`,
    {
      domainNo: DOMAIN_NO,
      recordNos: z.array(z.number().int(), { required_error: requiredError("recordNos") }).min(1).max(500).describe("Record numbers to delete (1-500)"),
    },
    async (params) => client.requestRaw("POST", `${recordsPath(params.domainNo)}/batch-delete`, undefined, { recordNos: params.recordNos }),
    { destructive: { message: (p) => `⚠️ This will delete ${p.recordNos?.length ?? 0} DNS record(s) from Domain [${p.domainNo}] (effective after ncloud_dns_apply_domain).\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_dns_apply_domain",
    `Apply (publish) all pending record changes of a Global DNS domain (v2). ${ASYNC_NOTE}ncloud_dns_get_record_operation (with the same domainNo) until done=true. Use dryRun=true to preview.`,
    { domainNo: DOMAIN_NO, dryRun: DRY_RUN },
    async (params) => {
      const endpoint = `${recordsPath(params.domainNo)}/apply`;
      if (params.dryRun) {
        return dryRunPreview({ label: "🔍 Dry-Run Preview: Global DNS Record Apply", endpoint, method: "POST", requestParams: {}, noun: { ko: "레코드 변경사항", en: "pending record changes" }, verb: "apply" });
      }
      return withOperationHint(
        await client.requestRaw("POST", endpoint),
        "ncloud_dns_get_record_operation",
        ` and domainNo=${params.domainNo}`
      );
    }
  );

  defineTool(
    server,
    "ncloud_dns_rollback_domain",
    "⚠️ Destructive: Discard all pending (not yet applied) record changes of a Global DNS domain (v2), returning to the last applied state. Set confirm=true to execute.",
    { domainNo: DOMAIN_NO },
    async (params) => client.requestRaw("POST", `${recordsPath(params.domainNo)}/rollback`),
    { destructive: { message: (p) => `⚠️ This will discard all pending record changes of Global DNS Domain [${p.domainNo}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_dns_get_record_operation",
    "Get the status of an async record apply operation of a Global DNS domain (v2). Poll until done=true; check error when done. Operations are kept for 30 days.",
    { domainNo: DOMAIN_NO, operationId: OPERATION_ID },
    async (params) => client.requestRaw("GET", `${recordsPath(params.domainNo)}/operations/${enc(params.operationId)}`)
  );

  defineTool(
    server,
    "ncloud_dns_list_record_operations",
    "List async record apply operations of a Global DNS domain (v2) from the last 30 days.",
    { domainNo: DOMAIN_NO, pageNo: PAGE_NO, pageSize: PAGE_SIZE, sort: OPERATION_SORT },
    async (params) =>
      client.requestRaw("GET", withQuery(`${recordsPath(params.domainNo)}/operations`, { pageNo: params.pageNo, pageSize: params.pageSize, sort: params.sort }))
  );

  // ─── Load balancers / statistics ─────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_dns_list_lb_records",
    "List load balancers that can be linked to a Global DNS record (v2). Use the returned load balancer number/region as loadBalancerNo/loadBalancerRegionCode in record tools.",
    {
      platformType: z.enum(["CLASSIC", "VPC", "BOTH"]).default("VPC").describe("Platform type: VPC (default) | CLASSIC | BOTH"),
      recordType: z.string().default("A").describe('Record type (documented value: "A")'),
      loadBalancerRegionCode: z.string().optional().describe("Load balancer region code (default KR)"),
      searchContent: z.string().optional().describe("Filter by load balancer name"),
    },
    async (params) =>
      client.requestRaw(
        "GET",
        withQuery(`${BASE}/record-linkable-load-balancers`, {
          platformType: params.platformType,
          recordType: params.recordType,
          loadBalancerRegionCode: params.loadBalancerRegionCode,
          searchContent: params.searchContent,
        })
      )
  );

  defineTool(
    server,
    "ncloud_dns_get_query_count",
    "Get Global DNS query statistics (v2). Without domainNo returns account-wide (member) statistics; with domainNo returns that domain's statistics. " +
      'Optional filter narrows the time range, e.g. "baseTimestamp >= 1568111263000 AND baseTimestamp < 1568711263000" (epoch ms).',
    {
      baseTimeUnit: z.enum(TIME_UNITS, { required_error: requiredError("baseTimeUnit") }).describe("Aggregation unit"),
      domainNo: z.number().int().optional().describe("Domain number. Omit for account-wide statistics"),
      filter: z.string().optional().describe('Filter expression, e.g. "baseTimestamp >= 1568111263000 AND baseTimestamp < 1568711263000"'),
    },
    async (params) => {
      const path = params.domainNo !== undefined ? `${domainPath(params.domainNo)}/query-statistics` : `${BASE}/query-statistics`;
      return client.requestRaw("GET", withQuery(path, { baseTimeUnit: params.baseTimeUnit, filter: params.filter }));
    }
  );
}
