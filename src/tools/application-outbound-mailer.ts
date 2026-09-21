import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

/**
 * Cloud Outbound Mailer API v1 (레거시) — Base URL: https://mail.apigw.ntruss.com
 *   리전은 경로 세그먼트: KR `/api/v1`, SGN `/api/v1-sgn`, JPN `/api/v1-jpn` (호스트 동일)
 *
 * 2026-09-17 Cloud Outbound Mailer가 SENS로 흡수 통합됐다(guide: sens-integrationguide).
 *   - 이 API는 **이관된 프로젝트(`mail-UUID`)에 한해 12개월간만** 제공된다(SENS 개요는 "'27년 12월").
 *     이관 프로젝트를 삭제하면 즉시 사용 불가.
 *   - 메일 발송·조회 5 op(createMailRequest/getMailRequestList/…)는 SENS `/mail/v2`가 대체하므로
 *     여기서 감싸지 않는다 → `application-sens-mail.ts`의 `ncloud_sens_*_mail*` 사용.
 *   - SENS v2에 아직 없는 기능만 감싼다: 템플릿·카테고리, 주소록(수신자 그룹), 발송 차단·수신 거부.
 *   - `createFile`(multipart/form-data 업로드)과 그 위의 getFile/deleteFile은 MCP 텍스트 채널로
 *     바이너리를 올릴 수 없어 감싸지 않는다(콘솔 업로드 후 fileId를 `attachFileIds`에 쓰는 흐름은 v2 도구가 지원).
 *   - v2에 템플릿/주소록 op가 추가되면 그쪽으로 이관하고 이 파일은 종료 전에 제거한다.
 *
 * 응답은 API GW 공통 코드(100/200/210/300/…) + Spring `Page` 형태(`content`, 0-based `number`).
 * `x-ncp-lang`에 따라 `label`이 번역되므로 로직은 `code`로 분기한다.
 * 고전 Ncloud API의 `responseFormatType`/`regionCode` 쿼리는 쓰지 않으므로 `client.requestRaw`만 사용한다.
 */

const LEGACY_TAG =
  "[Legacy Cloud Outbound Mailer API — merged into SENS on 2026-09-17; available only to projects migrated from Cloud Outbound Mailer and only for ~12 months (SENS overview: until Dec 2027). New mail sending/lookup: ncloud_sens_send_mail / ncloud_sens_list_mail_requests.] ";

const REGION_PATH: Record<string, string> = { KR: "/api/v1", SGN: "/api/v1-sgn", JPN: "/api/v1-jpn" };

/** 그룹·템플릿·카테고리 이름 공통 규칙: 한글/영문/숫자/`.`/`_`/`-` 1~100자 */
const NAME_PATTERN = /^[\p{Script=Hangul}A-Za-z0-9._-]{1,100}$/u;
const NAME_RULE = "1-100 chars of Korean, letters, digits, '.', '_' or '-'";

const EMAIL_LIST = z.array(z.string().email()).min(1);

export function registerOutboundMailerTools(server: McpServer, client: NcloudClient): void {
  const regionParam = z.enum(["KR", "SGN", "JPN"]).optional().describe(
    "Region path segment (KR=/api/v1, SGN=/api/v1-sgn, JPN=/api/v1-jpn). Defaults to the server region (NCLOUD_REGION) when it is one of these, otherwise KR"
  );

  function basePath(region?: string): string {
    const r = (region ?? client.getRegionCode() ?? "KR").toUpperCase();
    return REGION_PATH[r] ?? REGION_PATH.KR;
  }

  // ─── Templates / Categories ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_mailer_get_template_structure",
    LEGACY_TAG + "Get the category/template tree (GET /template). Template nodes have isCategory=false; use their sid as templateSid.",
    {
      isUse: z.boolean().optional().describe("true = only templates/categories in use"),
      region: regionParam,
    },
    async (params) => {
      const q = params.isUse === undefined ? "" : `?isUse=${params.isUse}`;
      return client.requestRaw("GET", `${basePath(params.region)}/template${q}`);
    }
  );

  defineTool(
    server,
    "ncloud_mailer_get_template",
    LEGACY_TAG + "Get one mail template (GET /template/{templateSid}).",
    {
      templateSid: z.number().int({ message: requiredError("templateSid") }).describe("Template SID (from ncloud_mailer_get_template_structure)"),
      region: regionParam,
    },
    async (params) => client.requestRaw("GET", `${basePath(params.region)}/template/${params.templateSid}`)
  );

  const templateBodyFields = {
    templateName: z.string({ required_error: requiredError("templateName") }).regex(NAME_PATTERN, `templateName: ${NAME_RULE}`).describe(`Template name (${NAME_RULE})`),
    description: z.string().optional().describe("Description (0-300 bytes)"),
    title: z.string({ required_error: requiredError("title") }).min(1).describe("Mail subject (1-500 bytes)"),
    body: z.string({ required_error: requiredError("body") }).describe("Mail body (HTML allowed)"),
    senderAddress: z.string({ required_error: requiredError("senderAddress") }).email().describe("Sender address (naver.com / navercorp.com / ncloud.com domains are not allowed)"),
    senderName: z.string().optional().describe("Sender name (0-69 bytes)"),
    isUse: z.boolean().optional().describe("Whether the template is active"),
  };

  defineTool(
    server,
    "ncloud_mailer_create_template",
    LEGACY_TAG + "Create a mail template (POST /template). The created sid can be used as templateNo in ncloud_sens_send_mail (migrated projects) or templateSid in v1.",
    {
      ...templateBodyFields,
      categorySid: z.number().int().optional().describe("Parent category SID (default -1 = root)"),
      region: regionParam,
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without creating"),
    },
    async (params) => {
      const { region, dryRun, ...body } = params;
      for (const k of Object.keys(body)) if ((body as any)[k] === undefined) delete (body as any)[k];
      const endpoint = `${basePath(region)}/template`;
      if (dryRun) {
        return dryRunPreview({ label: "🔍 Dry-Run Preview: Mail Template Creation", endpoint, method: "POST", requestParams: body, noun: { ko: "메일 템플릿", en: "mail template" } });
      }
      return client.requestRaw("POST", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_mailer_update_template",
    LEGACY_TAG + "Replace a mail template (PUT /template/{templateSid}). This is a full replacement — templateName, title, body and senderAddress must all be sent again; the category cannot be changed here.",
    {
      templateSid: z.number().int().describe("Template SID"),
      ...templateBodyFields,
      region: regionParam,
    },
    async (params) => {
      const { region, templateSid, ...body } = params;
      for (const k of Object.keys(body)) if ((body as any)[k] === undefined) delete (body as any)[k];
      return client.requestRaw("PUT", `${basePath(region)}/template/${templateSid}`, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_mailer_delete_template",
    LEGACY_TAG + "⚠️ Destructive: Delete a mail template (DELETE /template/{templateSid}). This is a soft delete (isUse=false) that ncloud_mailer_restore_template can undo. Set confirm=true to execute.",
    {
      templateSid: z.number().int().describe("Template SID to delete"),
      region: regionParam,
    },
    async (params) => client.requestRaw("DELETE", `${basePath(params.region)}/template/${params.templateSid}`),
    { destructive: { noun: "mail template", describe: (p) => `templateSid=${p.templateSid}` } }
  );

  defineTool(
    server,
    "ncloud_mailer_restore_template",
    LEGACY_TAG + "Restore a soft-deleted mail template (PUT /template/{templateSid}/restoration).",
    {
      templateSid: z.number().int().describe("Template SID to restore"),
      region: regionParam,
    },
    async (params) => client.requestRaw("PUT", `${basePath(params.region)}/template/${params.templateSid}/restoration`),
    { annotations: { destructiveHint: false, idempotentHint: true } }
  );

  defineTool(
    server,
    "ncloud_mailer_create_category",
    LEGACY_TAG + "Create a template category (POST /category).",
    {
      categoryName: z.string({ required_error: requiredError("categoryName") }).regex(NAME_PATTERN, `categoryName: ${NAME_RULE}`).describe(`Category name (${NAME_RULE})`),
      parentSid: z.number().int().optional().describe("Parent category SID (default -1 = root)"),
      region: regionParam,
    },
    async (params) => {
      const body: Record<string, unknown> = { categoryName: params.categoryName };
      if (params.parentSid !== undefined) body.parentSid = params.parentSid;
      return client.requestRaw("POST", `${basePath(params.region)}/category`, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_mailer_delete_category",
    LEGACY_TAG + "⚠️ Destructive: Delete a template category (DELETE /category/{categorySid}). Only an empty category (no templates, no sub-categories) can be deleted. Set confirm=true to execute.",
    {
      categorySid: z.number().int().describe("Category SID to delete (from ncloud_mailer_get_template_structure)"),
      region: regionParam,
    },
    async (params) => client.requestRaw("DELETE", `${basePath(params.region)}/category/${params.categorySid}`),
    { destructive: { noun: "template category", describe: (p) => `categorySid=${p.categorySid}` } }
  );

  // ─── Address book (recipient groups) ────────────────────────────────────────

  defineTool(
    server,
    "ncloud_mailer_get_address_book",
    LEGACY_TAG + "Get the address book summary (GET /address-book): totalAddressCount and per-group sid/groupName/addressCount. There is no API to list the individual addresses of a group.",
    { region: regionParam },
    async (params) => client.requestRaw("GET", `${basePath(params.region)}/address-book`)
  );

  defineTool(
    server,
    "ncloud_mailer_create_address_book",
    LEGACY_TAG + "Add recipient groups and/or addresses to the address book (POST /address-book). An existing groupName appends to that group. Processing is asynchronous — the response reflects the state before this request; re-read with ncloud_mailer_get_address_book.",
    {
      groups: z.array(z.object({
        groupName: z.string().regex(NAME_PATTERN, `groupName: ${NAME_RULE}`).describe(`Group name (${NAME_RULE})`),
        emailAddresses: z.array(z.string().email()).optional().describe("Addresses to add; omit to create an empty group"),
      })).min(1).describe("Groups to create or append to"),
      region: regionParam,
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without writing"),
    },
    async (params) => {
      const body = { groups: params.groups };
      const endpoint = `${basePath(params.region)}/address-book`;
      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Address Book Update",
          endpoint, method: "POST", requestParams: body,
          noun: { ko: "수신자 그룹/주소", en: "recipient groups/addresses" },
          notes: { groupCount: params.groups.length, addressCount: params.groups.reduce((n, g) => n + (g.emailAddresses?.length ?? 0), 0) },
        });
      }
      return client.requestRaw("POST", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_mailer_delete_address_book",
    LEGACY_TAG + "⚠️ Destructive: Delete the ENTIRE address book — every recipient group and every address — and reset it (DELETE /address-book). This cannot be undone. To remove only some addresses or one group use ncloud_mailer_delete_addresses / ncloud_mailer_delete_recipient_group. Set confirm=true to execute.",
    { region: regionParam },
    async (params) => client.requestRaw("DELETE", `${basePath(params.region)}/address-book`),
    { destructive: { message: () => [
      "⚠️ This will delete the ENTIRE Cloud Outbound Mailer address book (all recipient groups and all addresses) and cannot be undone.",
      "Run ncloud_mailer_get_address_book first to see what will be lost.",
      "",
      "To execute, call this tool again with confirm=true.",
    ].join("\n") } }
  );

  defineTool(
    server,
    "ncloud_mailer_delete_addresses",
    LEGACY_TAG + "⚠️ Destructive: Remove specific email addresses from every recipient group (DELETE /address-book/address with a JSON body). Set confirm=true to execute.",
    {
      emailAddresses: EMAIL_LIST.describe("Addresses to remove from all groups"),
      region: regionParam,
    },
    async (params) => client.requestRaw("DELETE", `${basePath(params.region)}/address-book/address`, undefined, { emailAddresses: params.emailAddresses }),
    { destructive: { action: "remove", noun: "addresses from the address book", describe: (p) => `${p.emailAddresses.length} address(es)` } }
  );

  defineTool(
    server,
    "ncloud_mailer_delete_recipient_group",
    LEGACY_TAG + "⚠️ Destructive: Delete one recipient group (DELETE /address-book/recipient-groups?groupName=…). Set confirm=true to execute.",
    {
      groupName: z.string({ required_error: requiredError("groupName") }).min(1).describe("Group name to delete (exact; Korean names are URL-encoded automatically)"),
      region: regionParam,
    },
    async (params) => client.requestRaw("DELETE", `${basePath(params.region)}/address-book/recipient-groups`, { groupName: params.groupName }),
    { destructive: { noun: "recipient group", describe: (p) => p.groupName } }
  );

  // ─── Send block / unsubscribe ───────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_mailer_get_send_block_list",
    LEGACY_TAG + "Get the send-block history and current block status of one address (GET /send-block?targetAddress=…): registerStatus, expectedDeleteDate, content[] with actionType C(blocked)/D(released), sendResultCode.",
    {
      targetAddress: z.string({ required_error: requiredError("targetAddress") }).email().describe("Email address to look up"),
      size: z.number().int().min(1).optional().describe("Page size (default 10)"),
      page: z.number().int().min(0).optional().describe("Page index (0-based)"),
      sort: z.string().optional().describe("Sort 'property(,asc|desc)' (default createUtc)"),
      region: regionParam,
    },
    async (params) => {
      const { region, ...query } = params;
      return client.requestRaw("GET", `${basePath(region)}/send-block`, query);
    }
  );

  defineTool(
    server,
    "ncloud_mailer_register_unsubscribers",
    LEGACY_TAG + "Register addresses as unsubscribed so they are excluded from advertising mail (POST /unsubscribers). Returns count / requestCount / ignoreCount. There is no list API for unsubscribers in v1.",
    {
      blockedReceivers: EMAIL_LIST.describe("Addresses to register as unsubscribed"),
      region: regionParam,
    },
    async (params) => client.requestRaw("POST", `${basePath(params.region)}/unsubscribers`, undefined, { blockedReceivers: params.blockedReceivers }),
    { annotations: { destructiveHint: false } }
  );

  defineTool(
    server,
    "ncloud_mailer_delete_unsubscribers",
    LEGACY_TAG + "⚠️ Destructive: Remove addresses from the unsubscribe list so they can receive advertising mail again (DELETE /unsubscribers with a JSON body). Set confirm=true to execute.",
    {
      blockedReceivers: EMAIL_LIST.describe("Addresses to remove from the unsubscribe list"),
      region: regionParam,
    },
    async (params) => client.requestRaw("DELETE", `${basePath(params.region)}/unsubscribers`, undefined, { blockedReceivers: params.blockedReceivers }),
    { destructive: { action: "remove", noun: "unsubscribed addresses", describe: (p) => `${p.blockedReceivers.length} address(es)` } }
  );

  void L; // i18n 헬퍼는 향후 안내 문구용으로 유지
}
