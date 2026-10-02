import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool, excludingTools } from "./_tool.js";
import { L, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";
import { withQuery } from "./_sens.js";
import type { Zone } from "../client/endpoints.js";

/**
 * 존 차이(2026-09-30 두 존 sens-overview 대조): 공공존 SENS 에는 **메일 채널(/mail/v2)이 없다** — 공공존은
 * Cloud Outbound Mailer 가 별개 서비스로 남아 있다(`application-outbound-mailer.ts`). 프로젝트(/common/v2)는 두 존 동일.
 * → 공공존에서는 아래 메일 도구 5종을 등록하지 않는다.
 */
export const SENS_MAIL_PUBLIC_ONLY_TOOLS = [
  "ncloud_sens_send_mail",
  "ncloud_sens_list_mail_requests",
  "ncloud_sens_get_mail_request",
  "ncloud_sens_list_mails",
  "ncloud_sens_get_mail",
] as const;

export interface SensMailToolOptions {
  /** 존 — 공공존이면 메일 채널 도구를 제외(프로젝트 도구만 등록). 기본 `public`. */
  zone?: Zone;
}

/**
 * SENS(Simple & Easy Notification Service) — Mail(/mail/v2) + Project(/common/v2)
 * Base URL: https://sens.apigw.ntruss.com
 *
 * 2026-09-17 Cloud Outbound Mailer가 SENS로 **흡수 통합**됐다(guide: sens-integrationguide).
 *   - 메일 발송·조회는 이 파일의 `/mail/v2/services/{serviceId}/…` 5 op가 통합 API다.
 *   - 기존 Cloud Outbound Mailer API(mail.apigw.ntruss.com/api/v1)는 이관된 프로젝트에 한해
 *     12개월('27년 12월)까지만 제공 → `application-outbound-mailer.ts`(레거시)에 분리.
 *   - SMS/알림톡/Push는 변경 없음(`application-sens.ts` 유지).
 *
 * serviceId는 NRN 형식(`ncp:mail:kr:1********2:main`, 콜론 포함)이라 경로에 넣을 때 인코딩한다.
 * 프로젝트 목록/조회 API가 채널별 serviceId(NRN)를 돌려주므로 serviceId를 모를 때의 진입점이다.
 *
 * 응답은 표준 REST — 발송은 202 Accepted, 프로젝트 삭제는 204, 오류는
 * `{ error: { errorCode, message, detail, fieldErrors[] } }` 또는 `{ status, error, message }`.
 * 고전 Ncloud API의 `responseFormatType`/`regionCode` 쿼리는 쓰지 않으므로 `client.requestRaw`만 사용한다.
 */

const PAGE_PARAMS = {
  pageNo: z.number().int().min(0).optional().describe("Page number (0-based, default 0)"),
  pageSize: z.number().int().min(1).max(1000).optional().describe("Items per page (1-1000, default 10)"),
  sort: z.string().optional().describe("Sort as '{field},{direction}' (default 'createDateTime,desc')"),
};

const MAIL_STATUS = ["PREPARING", "READY", "RESERVED", "SENDING", "COMPLETED", "FAILED", "PARTIAL_FAILED", "CANCELED"] as const;

export function registerSensMailTools(server: McpServer, client: NcloudClient, opts: SensMailToolOptions = {}): void {
  // 메일 채널(sens-mail-*)은 민간존 가이드에만 있다 — 공공존·금융존 인덱스에 없음(2026-09-30).
  const s = (opts.zone ?? "pub") !== "pub" ? excludingTools(server, SENS_MAIL_PUBLIC_ONLY_TOOLS) : server;
  const envMailServiceId = process.env.NCLOUD_SENS_MAIL_SERVICE_ID ?? process.env.NCLOUD_SENS_SERVICE_ID ?? "";

  const serviceIdParam = z.string().optional().describe(
    "Mail service ID in NRN form (e.g. ncp:mail:kr:1********2:main). Defaults to NCLOUD_SENS_MAIL_SERVICE_ID / NCLOUD_SENS_SERVICE_ID. Find it with ncloud_sens_list_projects (mailService.serviceId). A 'Forbidden' reply means that project's Mail channel is not enabled (useMail=false) — pick a project with useMail=true."
  );

  /** serviceId 해석: 파라미터 > env. 없으면 에러 결과. */
  function resolveServiceId(param?: string): { ok: true; base: string } | { ok: false; result: any } {
    const id = (param ?? "").trim() || envMailServiceId;
    if (!id) {
      return {
        ok: false,
        result: {
          content: [{ type: "text" as const, text: L({
            ko: "Error: 메일 serviceId가 없습니다. serviceId 파라미터를 주거나 NCLOUD_SENS_MAIL_SERVICE_ID(또는 NCLOUD_SENS_SERVICE_ID) 환경 변수를 설정하세요. serviceId(NRN)는 ncloud_sens_list_projects 로 확인할 수 있습니다.",
            en: "Error: no mail serviceId. Pass the serviceId parameter or set NCLOUD_SENS_MAIL_SERVICE_ID (or NCLOUD_SENS_SERVICE_ID). Use ncloud_sens_list_projects to look up the NRN.",
          }) }],
          isError: true,
        },
      };
    }
    return { ok: true, base: `/mail/v2/services/${encodeURIComponent(id)}` };
  }

  // ─── Mail: send ─────────────────────────────────────────────────────────────

  defineTool(
    s,
    "ncloud_sens_send_mail",
    "Send email through SENS Mail (POST /mail/v2/services/{serviceId}/requests — the unified API that replaced Cloud Outbound Mailer on 2026-09-17). " +
      "Either templateNo, or all of senderAddress/title/body, is required; either recipients or recipientGroupFilter is required. " +
      "Returns HTTP 202 with requestId (track with ncloud_sens_get_mail_request). Use dryRun=true to preview the request body without sending.",
    {
      serviceId: serviceIdParam,
      senderAddress: z.string().max(254).optional().describe("Sender address (≤254 bytes). Required unless templateNo is given"),
      senderName: z.string().optional().describe("Sender display name (≤69 bytes UTF-8)"),
      templateNo: z.number().int().optional().describe("Template number — when set, sender/title/body come from the template"),
      title: z.string().optional().describe("Subject (≤500 bytes UTF-8, supports ${key} substitution). Required unless templateNo is given"),
      body: z.string().optional().describe("Body (≤500 KB UTF-8, HTML allowed, supports ${key} substitution). Required unless templateNo is given"),
      individual: z.boolean().optional().describe("true (default) = one mail per recipient; false = grouped mail (enables CC/BCC, disables advertising)"),
      confirmAndSend: z.boolean().optional().describe("true = send only after console approval (default false)"),
      advertising: z.boolean().optional().describe("true = advertising mail (adds the (광고) notice and unsubscribe text; not allowed with individual=false)"),
      parameters: z.record(z.string()).optional().describe("Shared ${key} substitution values"),
      reservationDateTime: z.string().optional().describe("Scheduled send time, ISO 8601 with offset (e.g. 2026-10-01T09:00:00+09:00), at most 30 days ahead"),
      attachFileIds: z.array(z.string()).optional().describe("Attachment file IDs (≤10 MB each, ≤20 MB total)"),
      recipients: z.array(z.object({
        address: z.string().max(254).describe("Recipient address (≤254 bytes)"),
        name: z.string().optional().describe("Recipient name (≤69 bytes UTF-8)"),
        type: z.enum(["TO", "CC", "BCC"]).optional().describe("TO (default) | CC | BCC — CC/BCC only when individual=false, max 30 each"),
        parameters: z.record(z.string()).optional().describe("Per-recipient ${key} substitution values"),
      })).max(100000).optional().describe("Recipients (≤100,000; at least one TO). Required unless recipientGroupFilter is given"),
      recipientGroupFilter: z.object({
        operator: z.enum(["OR", "AND"]).optional().describe("How to combine groups (default OR)"),
        groups: z.array(z.string()).min(1).describe("Address-group names"),
      }).optional().describe("Send to address groups instead of explicit recipients (individual=true only)"),
      useBasicUnsubscribeMessage: z.boolean().optional().describe("Use the default unsubscribe text for advertising mail (default true)"),
      unsubscribeMessage: z.string().optional().describe("Custom unsubscribe text (when useBasicUnsubscribeMessage=false)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns the request preview without sending"),
    },
    async (params) => {
      const svc = resolveServiceId(params.serviceId);
      if (!svc.ok) return svc.result;

      // ── 문서상 조합 규칙을 호출 전에 검증(서버는 400 InvalidParameter + fieldErrors) ──
      const problems: string[] = [];
      if (params.templateNo === undefined) {
        const missing = (["senderAddress", "title", "body"] as const).filter((k) => !params[k]);
        if (missing.length > 0) problems.push(L({
          ko: `templateNo가 없으면 ${missing.join(", ")} 가 필수입니다.`,
          en: `${missing.join(", ")} required when templateNo is not given.`,
        }));
      }
      const hasRecipients = (params.recipients?.length ?? 0) > 0;
      const hasFilter = params.recipientGroupFilter !== undefined;
      if (!hasRecipients && !hasFilter) problems.push(L({
        ko: "recipients 또는 recipientGroupFilter 중 하나는 필수입니다.",
        en: "Either recipients or recipientGroupFilter is required.",
      }));
      const individual = params.individual ?? true;
      if (hasRecipients) {
        const to = params.recipients!.filter((r) => (r.type ?? "TO") === "TO").length;
        const cc = params.recipients!.filter((r) => r.type === "CC").length;
        const bcc = params.recipients!.filter((r) => r.type === "BCC").length;
        if (to === 0) problems.push(L({ ko: "TO 수신자가 최소 1명 필요합니다.", en: "At least one TO recipient is required." }));
        if (individual && (cc > 0 || bcc > 0)) problems.push(L({
          ko: "individual=true(기본값)에서는 CC/BCC를 쓸 수 없습니다. individual=false로 보내거나 TO만 지정하세요.",
          en: "CC/BCC are not allowed with individual=true (the default). Use individual=false or TO recipients only.",
        }));
        if (cc > 30 || bcc > 30) problems.push(L({ ko: "CC, BCC는 각각 최대 30명입니다.", en: "CC and BCC are limited to 30 recipients each." }));
      }
      if (hasFilter && !individual) problems.push(L({
        ko: "recipientGroupFilter는 individual=true에서만 쓸 수 있습니다.",
        en: "recipientGroupFilter is only allowed with individual=true.",
      }));
      if (params.advertising && !individual) problems.push(L({
        ko: "advertising=true는 individual=false와 함께 쓸 수 없습니다.",
        en: "advertising=true cannot be combined with individual=false.",
      }));
      if (problems.length > 0) {
        return { content: [{ type: "text" as const, text: `❌ ${problems.join("\n❌ ")}` }], isError: true };
      }

      const body: Record<string, unknown> = {
        senderAddress: params.senderAddress,
        senderName: params.senderName,
        templateNo: params.templateNo,
        title: params.title,
        body: params.body,
        individual: params.individual,
        confirmAndSend: params.confirmAndSend,
        advertising: params.advertising,
        parameters: params.parameters,
        reservationDateTime: params.reservationDateTime,
        attachFileIds: params.attachFileIds,
        recipients: params.recipients,
        recipientGroupFilter: params.recipientGroupFilter,
        useBasicUnsubscribeMessage: params.useBasicUnsubscribeMessage,
        unsubscribeMessage: params.unsubscribeMessage,
      };
      for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];

      const endpoint = `${svc.base}/requests`;
      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: SENS Mail Send Request",
          endpoint,
          method: "POST",
          requestParams: body,
          noun: { ko: "메일 발송 요청", en: "mail send request" },
          notes: {
            recipientCount: params.recipients?.length ?? 0,
            recipientGroups: params.recipientGroupFilter?.groups ?? [],
            bodyBytes: params.body ? Buffer.byteLength(params.body, "utf8") : 0,
          },
        });
      }
      const result = await client.requestRaw("POST", endpoint, undefined, body);
      return {
        ...result,
        hint: L({
          ko: "202 Accepted — 발송은 비동기로 진행됩니다. ncloud_sens_get_mail_request(requestId)로 상태를, ncloud_sens_list_mails로 개별 메일을 확인하세요.",
          en: "202 Accepted — delivery is asynchronous. Track it with ncloud_sens_get_mail_request(requestId) and ncloud_sens_list_mails.",
        }),
      };
    }
  );

  // ─── Mail: lookups ──────────────────────────────────────────────────────────

  defineTool(
    s,
    "ncloud_sens_list_mail_requests",
    "List SENS mail send requests in a period (GET /mail/v2/services/{serviceId}/requests). fromDateTime and toDateTime are required (ISO 8601 with offset).",
    {
      serviceId: serviceIdParam,
      fromDateTime: z.string({ required_error: requiredError("fromDateTime") }).describe("Period start, ISO 8601 with offset (e.g. 2026-09-01T00:00:00+09:00)"),
      toDateTime: z.string({ required_error: requiredError("toDateTime") }).describe("Period end, ISO 8601 with offset"),
      requestId: z.string().optional().describe("Exact request ID"),
      mailId: z.string().optional().describe("Mail ID"),
      title: z.string().optional().describe("Subject (partial match)"),
      templateNo: z.number().int().optional().describe("Template number"),
      senderAddress: z.string().optional().describe("Sender address"),
      recipientAddress: z.string().optional().describe("Recipient address"),
      dispatchType: z.enum(["CONSOLE", "API"]).optional().describe("How the request was made"),
      status: z.enum(MAIL_STATUS).optional().describe("Request status"),
      ...PAGE_PARAMS,
    },
    async (params) => {
      const svc = resolveServiceId(params.serviceId);
      if (!svc.ok) return svc.result;
      const { serviceId: _s, ...query } = params;
      return client.requestRaw("GET", withQuery(`${svc.base}/requests`, query));
    }
  );

  defineTool(
    s,
    "ncloud_sens_get_mail_request",
    "Get one SENS mail send request with status counts (GET /mail/v2/services/{serviceId}/requests/{requestId}): status, requestCount, sentCount, finishCount, countsByStatus[].",
    {
      serviceId: serviceIdParam,
      requestId: z.string({ required_error: requiredError("requestId") }).describe("Request ID returned by ncloud_sens_send_mail"),
    },
    async (params) => {
      const svc = resolveServiceId(params.serviceId);
      if (!svc.ok) return svc.result;
      return client.requestRaw("GET", `${svc.base}/requests/${encodeURIComponent(params.requestId)}`);
    }
  );

  defineTool(
    s,
    "ncloud_sens_list_mails",
    "List the individual mails of a SENS mail send request (GET /mail/v2/services/{serviceId}/requests/{requestId}/mails). Mails whose only recipients were unsubscribed/blocked are counted as FAILED.",
    {
      serviceId: serviceIdParam,
      requestId: z.string({ required_error: requiredError("requestId") }).describe("Request ID"),
      mailId: z.string().optional().describe("Exact mail ID"),
      recipientAddress: z.string().optional().describe("Exact recipient address"),
      title: z.string().optional().describe("Subject (partial match)"),
      status: z.array(z.enum(MAIL_STATUS)).optional().describe("Mail statuses to include (repeatable)"),
      ...PAGE_PARAMS,
    },
    async (params) => {
      const svc = resolveServiceId(params.serviceId);
      if (!svc.ok) return svc.result;
      const { serviceId: _s, requestId, ...query } = params;
      return client.requestRaw("GET", withQuery(`${svc.base}/requests/${encodeURIComponent(requestId)}/mails`, query));
    }
  );

  defineTool(
    s,
    "ncloud_sens_get_mail",
    "Get one SENS mail in detail (GET /mail/v2/services/{serviceId}/requests/{requestId}/mails/{mailId}): substituted title/body, attachFiles[], and per-recipient status / sendResultCode / received / retryCount.",
    {
      serviceId: serviceIdParam,
      requestId: z.string({ required_error: requiredError("requestId") }).describe("Request ID"),
      mailId: z.string({ required_error: requiredError("mailId") }).describe("Mail ID (from ncloud_sens_list_mails)"),
    },
    async (params) => {
      const svc = resolveServiceId(params.serviceId);
      if (!svc.ok) return svc.result;
      return client.requestRaw(
        "GET",
        `${svc.base}/requests/${encodeURIComponent(params.requestId)}/mails/${encodeURIComponent(params.mailId)}`
      );
    },
    { prune: true }
  );

  // ─── Project (/common/v2/projects) ───────────────────────────────────────────

  defineTool(
    s,
    "ncloud_sens_list_projects",
    "List SENS projects (GET /common/v2/projects). Each project carries the per-channel service IDs in NRN form — smsService.serviceId, kkoBizMsgService.serviceId and mailService.serviceId (ncp:mail:kr:…) — which the SMS/Alimtalk/Mail tools take as serviceId; useMail marks projects with the Mail channel. Projects migrated from Cloud Outbound Mailer are named 'mail-<UUID>'.",
    {
      projectName: z.string().optional().describe("Filter by project name (full or partial match)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Items per page (1-100, default 100)"),
      pageIndex: z.number().int().min(0).optional().describe("Page index (0-based, default 0)"),
    },
    async (params) => client.requestRaw("GET", withQuery("/common/v2/projects", params))
  );

  defineTool(
    s,
    "ncloud_sens_get_project",
    "Get one SENS project with its channel service IDs (GET /common/v2/projects/{projectId}).",
    {
      projectId: z.string({ required_error: requiredError("projectId") }).describe("Project ID (from ncloud_sens_list_projects)"),
    },
    async (params) => client.requestRaw("GET", `/common/v2/projects/${encodeURIComponent(params.projectId)}`)
  );

  defineTool(
    s,
    "ncloud_sens_create_project",
    // 가이드(sens-project-create)에는 약관 동의 필드가 없다. 라이브(2026-10-01)에서 useSms/useKkoBizMsg 모두 false 면
    // "You must select at least one service", 하나를 켜면 계정이 콘솔에서 SENS 이용약관·개인정보 동의를 마치지 않은 경우
    // "You must agree to both the Terms of Service and the Privacy Policy" 를 돌려준다 — API 로는 해결할 수 없어 설명에 안내만 둔다.
    "Create a SENS project (POST /common/v2/projects). projectName: lowercase letters, digits, '-' and '_', ≤24 chars. Enable at least one of useSms / useKkoBizMsg (the API rejects a project with no service). The account must already have accepted the SENS Terms of Service and Privacy Policy in the console — the API has no agreement field and returns 'You must agree to both the Terms of Service and the Privacy Policy' otherwise. Returns the created channel service IDs (NRN).",
    {
      projectName: z.string({ required_error: requiredError("projectName") })
        .regex(/^[a-z0-9_-]{1,24}$/, "projectName must be 1-24 chars of lowercase letters, digits, '-' or '_'")
        .describe("Project name (lowercase letters, digits, '-', '_'; ≤24 chars)"),
      projectDesc: z.string().max(128).optional().describe("Description (0-128 chars)"),
      useSms: z.boolean().optional().describe("Enable the SMS service (default false)"),
      useKkoBizMsg: z.boolean().optional().describe("Enable the Biz Message (Kakao) service (default false)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without creating"),
    },
    async (params) => {
      const body: Record<string, unknown> = { projectName: params.projectName };
      if (params.projectDesc !== undefined) body.projectDesc = params.projectDesc;
      if (params.useSms !== undefined) body.useSms = params.useSms;
      if (params.useKkoBizMsg !== undefined) body.useKkoBizMsg = params.useKkoBizMsg;
      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: SENS Project Creation",
          endpoint: "/common/v2/projects",
          method: "POST",
          requestParams: body,
          noun: { ko: "SENS 프로젝트", en: "SENS project" },
        });
      }
      return client.requestRaw("POST", "/common/v2/projects", undefined, body);
    }
  );

  defineTool(
    s,
    "ncloud_sens_update_project",
    "Update a SENS project's description or enabled channels (PUT /common/v2/projects/{projectId}). At least one field must be given.",
    {
      projectId: z.string({ required_error: requiredError("projectId") }).describe("Project ID"),
      projectDesc: z.string().max(128).optional().describe("Description (0-128 chars)"),
      useSms: z.boolean().optional().describe("Enable/disable the SMS service"),
      useKkoBizMsg: z.boolean().optional().describe("Enable/disable the Biz Message service"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.projectDesc !== undefined) body.projectDesc = params.projectDesc;
      if (params.useSms !== undefined) body.useSms = params.useSms;
      if (params.useKkoBizMsg !== undefined) body.useKkoBizMsg = params.useKkoBizMsg;
      if (Object.keys(body).length === 0) {
        return { content: [{ type: "text" as const, text: L({
          ko: "❌ 변경할 필드가 없습니다. projectDesc, useSms, useKkoBizMsg 중 하나 이상을 지정하세요.",
          en: "❌ Nothing to update. Give at least one of projectDesc, useSms, useKkoBizMsg.",
        }) }], isError: true };
      }
      return client.requestRaw("PUT", `/common/v2/projects/${encodeURIComponent(params.projectId)}`, undefined, body);
    }
  );

  defineTool(
    s,
    "ncloud_sens_delete_project",
    "⚠️ Destructive: Delete a SENS project and its channel services (DELETE /common/v2/projects/{projectId}, 204 on success). Message history and service IDs under the project become unusable. Set confirm=true to execute.",
    {
      projectId: z.string({ required_error: requiredError("projectId") }).describe("Project ID to delete (from ncloud_sens_list_projects)"),
    },
    async (params) => client.requestRaw("DELETE", `/common/v2/projects/${encodeURIComponent(params.projectId)}`),
    { destructive: { noun: "SENS project", describe: (p) => p.projectId } }
  );
}
