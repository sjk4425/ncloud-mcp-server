import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";
import {
  serviceIdParam, resolveServiceId, withQuery, reserveTimeSchema, reserveTimeZoneSchema,
  listWindowParams, listWindowProblem, failoverConfigSchema, telNoSchema,
} from "./_sens.js";

/**
 * SENS(Simple & Easy Notification Service) — SMS(/sms/v2) + 알림톡(/alimtalk/v2)
 * Base URL: https://sens.apigw.ntruss.com
 *
 * 2026-09-21 공식 문서(sens-overview, sens-sms-*, sens-alimtalk-*) 전량 대조 결과로 재작성.
 *   - SENS가 제공하는 채널은 SMS, 알림톡, 브랜드 메시지(→ application-sens-brandmessage.ts),
 *     메일(2026-09-17 Outbound Mailer 통합 → application-sens-mail.ts). **Push는 API 문서·개요·llms.txt
 *     어디에도 없고 경로도 404** → 기존 `ncloud_sens_send_push` 도구 제거(1.16.0 Breaking).
 *   - SMS 발송에 `files[]`(MMS 첨부), 알림톡 발송에 `headerContent`/`itemHighlight`/`item`(아이템 리스트형)이
 *     빠져 있었고, 예약 상태·예약 취소·수신 거부·첨부 업로드·채널 조회·알림톡 발송 목록/결과 조회가 없었다.
 *   - 문서에 없는 `responseFormatType`/`regionCode` 쿼리를 붙이던 `client.request` 대신 `requestRaw`만 쓴다.
 *
 * 라이브(2026-09-21, Sub Account admin): 알림톡 `GET /channels` 200. SMS 경로는 useSms=true 프로젝트 2개에서
 * 목록·수신거부 조회가 모두 HTTP 404(빈 응답)였다 — 계정에 SMS 발신번호/이력이 없어서인지 확인 필요(콘솔).
 */

const SMS_TYPES = ["SMS", "LMS", "MMS"] as const;
const BUTTON_TYPES = ["DS", "WL", "AL", "BK", "MD", "AC"] as const;

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

export function registerSensTools(server: McpServer, client: NcloudClient): void {
  const smsService = serviceIdParam("sms");
  const kkoService = serviceIdParam("alimtalk");

  // ═══════════════════════════════════════════════════════════════════════════
  // SMS
  // ═══════════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_sens_send_sms",
    "Send SMS/LMS/MMS through SENS (POST /sms/v2/services/{serviceId}/messages → 202). Byte limits: SMS content 90, LMS/MMS content 2000, subject 40 (EUC-KR; unsupported emoji fail; oversize is truncated). " +
      "MMS needs files[] with fileId from ncloud_sens_upload_sms_attachment — an MMS without files is sent as LMS. Use dryRun=true to preview.",
    {
      serviceId: smsService,
      type: z.enum(SMS_TYPES).describe("SMS (short) | LMS (long) | MMS (image attachment)"),
      from: telNoSchema.describe("Sender number registered in the console (digits only)"),
      content: z.string({ required_error: requiredError("content") }).describe("Default content (SMS ≤90 bytes, LMS/MMS ≤2000 bytes)"),
      messages: z.array(z.object({
        to: telNoSchema.describe("Recipient number (digits only)"),
        subject: z.string().optional().describe("Per-recipient subject (LMS/MMS, ≤40 bytes)"),
        content: z.string().optional().describe("Per-recipient content (overrides the default)"),
      })).min(1).max(100).describe("Recipients (1-100)"),
      contentType: z.enum(["COMM", "AD"]).optional().describe("COMM (default) | AD (advertising)"),
      countryCode: z.string().optional().describe("Country code (default 82)"),
      subject: z.string().optional().describe("Default subject (LMS/MMS only, ≤40 bytes)"),
      files: z.array(z.object({ fileId: z.string().describe("File ID from ncloud_sens_upload_sms_attachment") })).optional().describe("MMS attachments (MMS only)"),
      reserveTime: reserveTimeSchema,
      reserveTimeZone: reserveTimeZoneSchema,
      dryRun: z.boolean().optional().default(false).describe("If true, returns the request preview without sending"),
    },
    async (params) => {
      const svc = resolveServiceId("sms", params.serviceId);
      if (!svc.ok) return svc.result;
      if (params.files && params.type !== "MMS") {
        return { content: [{ type: "text" as const, text: L({ ko: "❌ files는 type=MMS에서만 쓸 수 있습니다.", en: "❌ files is only allowed with type=MMS." }) }], isError: true };
      }
      const { serviceId: _s, dryRun, ...body } = params;
      stripUndefined(body);
      const endpoint = `${svc.base}/messages`;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: SENS SMS Send", endpoint, method: "POST", requestParams: body,
          noun: { ko: "문자 메시지", en: "SMS message" },
          notes: {
            recipientCount: params.messages.length,
            contentBytes: Buffer.byteLength(params.content, "utf8"),
            ...(params.type === "MMS" && !params.files ? { warning: L({ ko: "MMS인데 files가 없어 LMS로 발송됩니다.", en: "MMS without files is delivered as LMS." }) } : {}),
          },
        });
      }
      return client.requestRaw("POST", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_sens_get_sms_status",
    "Get one SMS delivery result (GET /sms/v2/services/{serviceId}/messages/{messageId}): status READY|PROCESSING|COMPLETED, statusCode (carrier result code), statusName success|fail, telcoCode, completeTime.",
    {
      serviceId: smsService,
      messageId: z.string({ required_error: requiredError("messageId") }).describe("Message ID (from the send response or ncloud_sens_list_sms_requests)"),
    },
    async (params) => {
      const svc = resolveServiceId("sms", params.serviceId);
      if (!svc.ok) return svc.result;
      return client.requestRaw("GET", `${svc.base}/messages/${encodeURIComponent(params.messageId)}`);
    }
  );

  defineTool(
    server,
    "ncloud_sens_list_sms_requests",
    "List SMS delivery requests of the last 90 days (GET /sms/v2/services/{serviceId}/messages). Requires requestId, or requestStartTime+requestEndTime (≤30 days), or completeStartTime+completeEndTime (≤24 h). Paginate with nextToken. " +
      "An empty HTTP 404 reply means no matching records for this service (observed live 2026-09), not a wrong path.",
    {
      serviceId: smsService,
      ...listWindowParams,
      messageId: z.string().optional().describe("Filter by message ID"),
      type: z.enum(SMS_TYPES).optional().describe("Filter by message type"),
      contentType: z.enum(["COMM", "AD"]).optional().describe("Filter by content type"),
      countryCode: z.string().optional().describe("Filter by country code"),
      status: z.enum(["READY", "PROCESSING", "COMPLETED"]).optional().describe("Filter by request status"),
      statusName: z.enum(["success", "fail"]).optional().describe("Filter by delivery result"),
      from: z.string().optional().describe("Filter by sender number (digits only)"),
      to: z.string().optional().describe("Filter by recipient number (digits only)"),
    },
    async (params) => {
      const svc = resolveServiceId("sms", params.serviceId);
      if (!svc.ok) return svc.result;
      const problem = listWindowProblem(params);
      if (problem) return problem;
      const { serviceId: _s, ...query } = params;
      return client.requestRaw("GET", withQuery(`${svc.base}/messages`, query));
    }
  );

  defineTool(
    server,
    "ncloud_sens_get_sms_reservation_status",
    "Get the status of a scheduled SMS request (GET /sms/v2/services/{serviceId}/reservations/{reserveId}/reserve-status): READY|PROCESSING|CANCELED|FAIL|DONE|STALE|SKIP.",
    {
      serviceId: smsService,
      reserveId: z.string({ required_error: requiredError("reserveId") }).describe("Reservation ID = the requestId returned by a send with reserveTime"),
    },
    async (params) => {
      const svc = resolveServiceId("sms", params.serviceId);
      if (!svc.ok) return svc.result;
      return client.requestRaw("GET", `${svc.base}/reservations/${encodeURIComponent(params.reserveId)}/reserve-status`);
    }
  );

  defineTool(
    server,
    "ncloud_sens_cancel_sms_reservation",
    "⚠️ Destructive: Cancel a scheduled SMS request before it is sent (DELETE /sms/v2/services/{serviceId}/reservations/{reserveId} → 204). Set confirm=true to execute.",
    {
      serviceId: smsService,
      reserveId: z.string({ required_error: requiredError("reserveId") }).describe("Reservation ID (requestId of the scheduled send)"),
    },
    async (params) => {
      const svc = resolveServiceId("sms", params.serviceId);
      if (!svc.ok) return svc.result;
      return client.requestRaw("DELETE", `${svc.base}/reservations/${encodeURIComponent(params.reserveId)}`);
    },
    { destructive: { action: "cancel", noun: "scheduled SMS request", describe: (p) => p.reserveId } }
  );

  defineTool(
    server,
    "ncloud_sens_register_sms_unsubscribes",
    "Register phone numbers on the SMS unsubscribe (수신 거부) list (POST /sms/v2/services/{serviceId}/unsubscribes; body is a JSON array, ≤1,000 numbers).",
    {
      serviceId: smsService,
      clientTelNos: z.array(telNoSchema).min(1).max(1000).describe("Numbers to block (digits only, ≤1,000)"),
    },
    async (params) => {
      const svc = resolveServiceId("sms", params.serviceId);
      if (!svc.ok) return svc.result;
      return client.requestRaw("POST", `${svc.base}/unsubscribes`, undefined, params.clientTelNos.map((clientTelNo) => ({ clientTelNo })));
    },
    { annotations: { destructiveHint: false } }
  );

  defineTool(
    server,
    "ncloud_sens_list_sms_unsubscribes",
    "List SMS unsubscribe (수신 거부) numbers (GET /sms/v2/services/{serviceId}/unsubscribes). startTime/endTime are epoch milliseconds. registerType C = ARS, M = manual. An empty HTTP 404 reply was observed live when the service has no records.",
    {
      serviceId: smsService,
      clientTelNo: z.string().optional().describe("Filter by number (digits only)"),
      startTime: z.number().int().optional().describe("Registered-after, epoch milliseconds"),
      endTime: z.number().int().optional().describe("Registered-before, epoch milliseconds"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Items per page (1-100)"),
      pageIndex: z.number().int().min(0).optional().describe("Page index (0-based)"),
    },
    async (params) => {
      const svc = resolveServiceId("sms", params.serviceId);
      if (!svc.ok) return svc.result;
      const { serviceId: _s, ...query } = params;
      return client.requestRaw("GET", withQuery(`${svc.base}/unsubscribes`, query));
    }
  );

  defineTool(
    server,
    "ncloud_sens_delete_sms_unsubscribes",
    "⚠️ Destructive: Remove numbers from the SMS unsubscribe list so they can receive messages again (DELETE /sms/v2/services/{serviceId}/unsubscribes with a JSON array body → 204). Set confirm=true to execute.",
    {
      serviceId: smsService,
      clientTelNos: z.array(telNoSchema).min(1).max(1000).describe("Numbers to remove from the list (≤1,000)"),
    },
    async (params) => {
      const svc = resolveServiceId("sms", params.serviceId);
      if (!svc.ok) return svc.result;
      return client.requestRaw("DELETE", `${svc.base}/unsubscribes`, undefined, params.clientTelNos.map((clientTelNo) => ({ clientTelNo })));
    },
    { destructive: { action: "remove", noun: "numbers from the SMS unsubscribe list", describe: (p) => `${p.clientTelNos.length} number(s)` } }
  );

  defineTool(
    server,
    "ncloud_sens_upload_sms_attachment",
    "Upload a JPG/JPEG image for MMS (POST /sms/v2/services/{serviceId}/files; JSON with Base64 body, not multipart). ≤300 KB, ≤1500x1440, kept 6 days. Returns fileId for ncloud_sens_send_sms files[]. A file with the same name and size is reused.",
    {
      serviceId: smsService,
      fileName: z.string().min(1).max(40).regex(/\.(jpe?g)$/i, "fileName must end with .jpg or .jpeg").describe("File name ending in .jpg/.jpeg (≤40 chars)"),
      fileBody: z.string().min(1).describe("Base64-encoded image (a 'data:image/...;base64,' prefix is stripped automatically)"),
    },
    async (params) => {
      const svc = resolveServiceId("sms", params.serviceId);
      if (!svc.ok) return svc.result;
      const fileBody = params.fileBody.replace(/^data:[^;]+;base64,/, "");
      const bytes = Buffer.from(fileBody, "base64").length;
      if (bytes > 300 * 1024) {
        return { content: [{ type: "text" as const, text: L({
          ko: `❌ 첨부 파일이 300KB를 넘습니다(${Math.round(bytes / 1024)}KB).`,
          en: `❌ Attachment exceeds 300 KB (${Math.round(bytes / 1024)} KB).`,
        }) }], isError: true };
      }
      return client.requestRaw("POST", `${svc.base}/files`, undefined, { fileName: params.fileName, fileBody });
    },
    { annotations: { destructiveHint: false } }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 알림톡 (AlimTalk) — serviceId는 kkobizmsg NRN
  // ═══════════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_sens_list_alimtalk_channels",
    "List KakaoTalk channels registered to the Biz Message service (GET /alimtalk/v2/services/{serviceId}/channels): channelId (@…), channelStatus, useSmsFailover, failoverServiceId.",
    { serviceId: kkoService },
    async (params) => {
      const svc = resolveServiceId("alimtalk", params.serviceId);
      if (!svc.ok) return svc.result;
      return client.requestRaw("GET", `${svc.base}/channels`);
    }
  );

  defineTool(
    server,
    "ncloud_sens_list_alimtalk_templates",
    "List Alim Talk templates of a channel (GET /alimtalk/v2/services/{serviceId}/templates). channelId is required; giving templateCode returns that template's full detail including inspection comments.",
    {
      serviceId: kkoService,
      channelId: z.string({ required_error: requiredError("channelId") }).describe("KakaoTalk channel ID (e.g. @channelname, from ncloud_sens_list_alimtalk_channels)"),
      templateCode: z.string().optional().describe("Template code → detailed view"),
      templateName: z.string().optional().describe("Filter by name (full or partial match)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Items per page (1-100, default 100)"),
      pageIndex: z.number().int().min(0).optional().describe("Page index (0-based, default 0)"),
    },
    async (params) => {
      const svc = resolveServiceId("alimtalk", params.serviceId);
      if (!svc.ok) return svc.result;
      const { serviceId: _s, ...query } = params;
      return client.requestRaw("GET", withQuery(`${svc.base}/templates`, query));
    }
  );

  defineTool(
    server,
    "ncloud_sens_send_alimtalk",
    "Send Alim Talk (KakaoTalk notification) messages through SENS (POST /alimtalk/v2/services/{serviceId}/messages → 202). Every field must match the approved template (content, buttons, item list). " +
      "Optional SMS failover per message. Use dryRun=true to preview.",
    {
      serviceId: kkoService,
      plusFriendId: z.string({ required_error: requiredError("plusFriendId") }).describe("KakaoTalk channel ID (e.g. @channelname)"),
      templateCode: z.string({ required_error: requiredError("templateCode") }).describe("Approved template code"),
      messages: z.array(z.object({
        to: telNoSchema.describe("Recipient number (digits only)"),
        content: z.string().describe("Message content (must match the template)"),
        countryCode: z.string().optional().describe("Country code (default 82)"),
        title: z.string().optional().describe("Emphasis title (emphasis-type templates only)"),
        headerContent: z.string().optional().describe("Header (item-list templates only, ≤16 bytes)"),
        itemHighlight: z.object({
          title: z.string().describe("Highlight title (≤30 chars / 15 per line; with image ≤21 / 10 per line)"),
          description: z.string().describe("Highlight description"),
        }).optional().describe("Item highlight (item-list templates)"),
        item: z.object({
          list: z.array(z.object({
            title: z.string().min(1).max(6).describe("Item name (1-6 chars)"),
            description: z.string().min(1).max(23).describe("Item value (1-23 chars)"),
          })).min(2).max(10).describe("Items (2-10)"),
          summary: z.object({
            title: z.string().min(1).max(6).describe("Summary label (1-6 chars)"),
            description: z.string().min(1).max(23).describe("Summary value (currency symbol/code, digits, comma, space, 2-decimal point)"),
          }).optional().describe("Item summary"),
        }).optional().describe("Item list (item-list templates)"),
        buttons: z.array(z.object({
          type: z.enum(BUTTON_TYPES).describe("DS delivery | WL web link | AL app link | BK bot keyword | MD message | AC add channel"),
          name: z.string().max(20).describe("Button label (≤20 chars; '채널 추가' for AC)"),
          linkMobile: z.string().optional().describe("Mobile URL (required for WL)"),
          linkPc: z.string().optional().describe("PC URL (required for WL)"),
          schemeIos: z.string().optional().describe("iOS scheme (required for AL)"),
          schemeAndroid: z.string().optional().describe("Android scheme (required for AL)"),
        })).optional().describe("Buttons (must match the template)"),
        useSmsFailover: z.boolean().optional().describe("Send SMS/LMS when the Alim Talk is not delivered (not for 'B'-prefixed result codes)"),
        failoverConfig: failoverConfigSchema,
      })).min(1).max(100).describe("Recipients (1-100)"),
      reserveTime: reserveTimeSchema,
      reserveTimeZone: reserveTimeZoneSchema,
      dryRun: z.boolean().optional().default(false).describe("If true, returns the request preview without sending"),
    },
    async (params) => {
      const svc = resolveServiceId("alimtalk", params.serviceId);
      if (!svc.ok) return svc.result;
      const problems: string[] = [];
      params.messages.forEach((m, i) => {
        for (const b of m.buttons ?? []) {
          if (b.type === "WL" && (!b.linkMobile || !b.linkPc)) problems.push(`messages[${i}] button '${b.name}': WL requires linkMobile and linkPc`);
          if (b.type === "AL" && (!b.schemeIos || !b.schemeAndroid)) problems.push(`messages[${i}] button '${b.name}': AL requires schemeIos and schemeAndroid`);
        }
      });
      if (problems.length > 0) return { content: [{ type: "text" as const, text: `❌ ${problems.join("\n❌ ")}` }], isError: true };
      const { serviceId: _s, dryRun, ...body } = params;
      stripUndefined(body);
      const endpoint = `${svc.base}/messages`;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: SENS Alim Talk Send", endpoint, method: "POST", requestParams: body,
          noun: { ko: "알림톡 메시지", en: "Alim Talk message" },
          notes: { recipientCount: params.messages.length, withFailover: params.messages.filter((m) => m.useSmsFailover).length },
        });
      }
      return client.requestRaw("POST", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_sens_list_alimtalk_requests",
    "List Alim Talk delivery requests (GET /alimtalk/v2/services/{serviceId}/messages). Requires requestId, or requestStartTime+requestEndTime (≤31 days), or completeStartTime+completeEndTime (≤24 h); plusFriendId is required unless requestId is given. An empty HTTP 404 reply means no matching records (observed live with an unknown requestId).",
    {
      serviceId: kkoService,
      plusFriendId: z.string().optional().describe("Channel ID (required when requestId is not given)"),
      ...listWindowParams,
      messageId: z.string().optional().describe("Filter by message ID"),
      requestStatusName: z.enum(["success", "fail"]).optional().describe("Filter by request result"),
      messageStatusName: z.enum(["success", "processing", "fail"]).optional().describe("Filter by delivery result"),
      templateCode: z.string().optional().describe("Filter by template code"),
      to: z.string().optional().describe("Filter by recipient number (digits only)"),
    },
    async (params) => {
      const svc = resolveServiceId("alimtalk", params.serviceId);
      if (!svc.ok) return svc.result;
      const problem = listWindowProblem(params, "plusFriendId");
      if (problem) return problem;
      const { serviceId: _s, ...query } = params;
      return client.requestRaw("GET", withQuery(`${svc.base}/messages`, query));
    }
  );

  defineTool(
    server,
    "ncloud_sens_get_alimtalk_status",
    "Get one Alim Talk delivery result (GET /alimtalk/v2/services/{serviceId}/messages/{messageId}): requestStatusCode (A000 = accepted), messageStatusCode (0000 = delivered; 3019 not a KakaoTalk user, 3020 blocked), failover details.",
    {
      serviceId: kkoService,
      messageId: z.string({ required_error: requiredError("messageId") }).describe("Message ID"),
    },
    async (params) => {
      const svc = resolveServiceId("alimtalk", params.serviceId);
      if (!svc.ok) return svc.result;
      return client.requestRaw("GET", `${svc.base}/messages/${encodeURIComponent(params.messageId)}`);
    }
  );

  defineTool(
    server,
    "ncloud_sens_get_alimtalk_reservation_status",
    "Get the status of a scheduled Alim Talk request (GET /alimtalk/v2/services/{serviceId}/reservations/{reserveId}/reserve-status): READY|PROCESSING|CANCELED|FAIL|DONE|STALE|SKIP.",
    {
      serviceId: kkoService,
      reserveId: z.string({ required_error: requiredError("reserveId") }).describe("Reservation ID = requestId of the scheduled send"),
    },
    async (params) => {
      const svc = resolveServiceId("alimtalk", params.serviceId);
      if (!svc.ok) return svc.result;
      return client.requestRaw("GET", `${svc.base}/reservations/${encodeURIComponent(params.reserveId)}/reserve-status`);
    }
  );

  defineTool(
    server,
    "ncloud_sens_cancel_alimtalk_reservation",
    "⚠️ Destructive: Cancel a scheduled Alim Talk request before it is sent (DELETE /alimtalk/v2/services/{serviceId}/reservations/{reserveId} → 204). Set confirm=true to execute.",
    {
      serviceId: kkoService,
      reserveId: z.string({ required_error: requiredError("reserveId") }).describe("Reservation ID (requestId of the scheduled send)"),
    },
    async (params) => {
      const svc = resolveServiceId("alimtalk", params.serviceId);
      if (!svc.ok) return svc.result;
      return client.requestRaw("DELETE", `${svc.base}/reservations/${encodeURIComponent(params.reserveId)}`);
    },
    { destructive: { action: "cancel", noun: "scheduled Alim Talk request", describe: (p) => p.reserveId } }
  );
}
