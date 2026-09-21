import { z } from "zod";
import { L } from "./_messages.js";

/**
 * SENS(Simple & Easy Notification Service) 채널 도구 공통 헬퍼.
 *
 * - serviceId는 채널별 NRN(`ncp:sms:kr:{계정}:{서비스}`, `ncp:kkobizmsg:kr:…`, `ncp:mail:kr:…`).
 *   `GET /common/v2/projects`(ncloud_sens_list_projects)로 조회한다. 콜론이 들어가므로 경로에는 인코딩해 넣는다
 *   (2026-09-21 라이브: 인코딩/비인코딩 모두 같은 응답).
 * - 시간 형식이 채널·용도별로 다르다(2026-09 문서): 발송 예약 `YYYY-MM-DD HH:mm`(초 없음, 현재+10분 이후),
 *   발송 목록 조회 `YYYY-MM-DD HH:mm:ss`, 수신거부 조회는 밀리초 epoch, 메일은 ISO 8601+타임존.
 * - 목록 조회는 `requestId` | `requestStartTime+requestEndTime` | `completeStartTime+completeEndTime` 중 하나가 필수.
 */

export type SensChannel = "sms" | "alimtalk" | "brandmessage" | "mail";

const CHANNEL_PATH: Record<SensChannel, string> = {
  sms: "/sms/v2/services",
  alimtalk: "/alimtalk/v2/services",
  brandmessage: "/brandmessage/v2/services",
  mail: "/mail/v2/services",
};

/** 채널별 serviceId env 우선순위. 알림톡·브랜드 메시지는 같은 kkobizmsg 서비스를 쓴다. */
export function envServiceId(channel: SensChannel): string {
  const e = process.env;
  const common = e.NCLOUD_SENS_SERVICE_ID;
  switch (channel) {
    case "sms": return e.NCLOUD_SENS_SMS_SERVICE_ID ?? common ?? "";
    case "alimtalk": return e.NCLOUD_SENS_ALIMTALK_SERVICE_ID ?? common ?? "";
    case "brandmessage": return e.NCLOUD_SENS_BRANDMESSAGE_SERVICE_ID ?? e.NCLOUD_SENS_ALIMTALK_SERVICE_ID ?? common ?? "";
    case "mail": return e.NCLOUD_SENS_MAIL_SERVICE_ID ?? common ?? "";
  }
}

const ENV_NAME: Record<SensChannel, string> = {
  sms: "NCLOUD_SENS_SMS_SERVICE_ID",
  alimtalk: "NCLOUD_SENS_ALIMTALK_SERVICE_ID",
  brandmessage: "NCLOUD_SENS_BRANDMESSAGE_SERVICE_ID (or NCLOUD_SENS_ALIMTALK_SERVICE_ID)",
  mail: "NCLOUD_SENS_MAIL_SERVICE_ID",
};

const NRN_EXAMPLE: Record<SensChannel, string> = {
  sms: "ncp:sms:kr:1********2:myproject",
  alimtalk: "ncp:kkobizmsg:kr:1********2:myproject",
  brandmessage: "ncp:kkobizmsg:kr:1********2:myproject",
  mail: "ncp:mail:kr:1********2:myproject",
};

const PROJECT_FIELD: Record<SensChannel, string> = {
  sms: "smsService.serviceId",
  alimtalk: "kkoBizMsgService.serviceId",
  brandmessage: "kkoBizMsgService.serviceId",
  mail: "mailService.serviceId",
};

export function serviceIdParam(channel: SensChannel) {
  return z.string().optional().describe(
    `${channel === "brandmessage" ? "Biz Message" : channel.toUpperCase()} service ID in NRN form (e.g. ${NRN_EXAMPLE[channel]}). ` +
    `Defaults to ${ENV_NAME[channel]} / NCLOUD_SENS_SERVICE_ID. Find it with ncloud_sens_list_projects (${PROJECT_FIELD[channel]}). ` +
    `A 'Forbidden' reply means the project does not have this channel enabled.`
  );
}

export type ResolvedService = { ok: true; base: string; serviceId: string } | { ok: false; result: any };

/** serviceId 해석: 파라미터 > env. 없으면 isError 결과를 돌려준다(API 호출 없음). */
export function resolveServiceId(channel: SensChannel, param?: string): ResolvedService {
  const id = (param ?? "").trim() || envServiceId(channel);
  if (!id) {
    return {
      ok: false,
      result: {
        content: [{ type: "text" as const, text: L({
          ko: `Error: ${channel} serviceId가 없습니다. serviceId 파라미터를 주거나 ${ENV_NAME[channel]}(또는 NCLOUD_SENS_SERVICE_ID) 환경 변수를 설정하세요. serviceId(NRN)는 ncloud_sens_list_projects 의 ${PROJECT_FIELD[channel]} 에서 확인할 수 있습니다.`,
          en: `Error: no ${channel} serviceId. Pass the serviceId parameter or set ${ENV_NAME[channel]} (or NCLOUD_SENS_SERVICE_ID). Look up the NRN with ncloud_sens_list_projects (${PROJECT_FIELD[channel]}).`,
        }) }],
        isError: true,
      },
    };
  }
  return { ok: true, base: `${CHANNEL_PATH[channel]}/${encodeURIComponent(id)}`, serviceId: id };
}

export { withQuery } from "./_query.js";
export type { QueryValue } from "./_query.js";

/** 발송 예약 시각 `YYYY-MM-DD HH:mm` (초 없음). */
export const reserveTimeSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, "reserveTime must be 'YYYY-MM-DD HH:mm' (no seconds)")
  .optional()
  .describe("Scheduled send time 'YYYY-MM-DD HH:mm' (no seconds; must be at least 10 minutes from now)");

export const reserveTimeZoneSchema = z.string().optional().describe("tz database name for reserveTime (default Asia/Seoul)");

/** 발송 목록 조회 시각 `YYYY-MM-DD HH:mm:ss`. */
export const listTimeSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, "must be 'YYYY-MM-DD HH:mm:ss'");

/** 발송 목록 조회 공통 쿼리(requestId / request* / complete* / 페이지). */
export const listWindowParams = {
  requestId: z.string().optional().describe("Request ID from the send response. One of requestId, requestStartTime+requestEndTime, completeStartTime+completeEndTime is required"),
  requestStartTime: listTimeSchema.optional().describe("Window start by request time 'YYYY-MM-DD HH:mm:ss'"),
  requestEndTime: listTimeSchema.optional().describe("Window end by request time (SMS: within 30 days, Alimtalk/Brand: within 31 days of start)"),
  completeStartTime: listTimeSchema.optional().describe("Window start by completion time 'YYYY-MM-DD HH:mm:ss'"),
  completeEndTime: listTimeSchema.optional().describe("Window end by completion time (within 24 hours of start)"),
  nextToken: z.string().optional().describe("Page token from the previous response"),
  pageSize: z.number().int().min(1).max(100).optional().describe("Items per page (1-100, default 20)"),
};

/**
 * 목록 조회 필수 조합 검증. 통과 시 undefined, 실패 시 isError 결과.
 * @param channelField 알림톡·브랜드 메시지처럼 requestId가 없을 때 채널 아이디가 필수인 경우 그 필드명.
 */
export function listWindowProblem(
  p: { requestId?: string; requestStartTime?: string; requestEndTime?: string; completeStartTime?: string; completeEndTime?: string; [k: string]: unknown },
  channelField?: string
): any | undefined {
  const problems: string[] = [];
  const hasReq = p.requestStartTime !== undefined || p.requestEndTime !== undefined;
  const hasCom = p.completeStartTime !== undefined || p.completeEndTime !== undefined;
  if (!p.requestId && !hasReq && !hasCom) problems.push(L({
    ko: "requestId, requestStartTime+requestEndTime, completeStartTime+completeEndTime 중 하나는 필수입니다.",
    en: "One of requestId, requestStartTime+requestEndTime, completeStartTime+completeEndTime is required.",
  }));
  if (hasReq && (p.requestStartTime === undefined || p.requestEndTime === undefined)) problems.push(L({
    ko: "requestStartTime과 requestEndTime은 함께 지정해야 합니다.",
    en: "requestStartTime and requestEndTime must be given together.",
  }));
  if (hasCom && (p.completeStartTime === undefined || p.completeEndTime === undefined)) problems.push(L({
    ko: "completeStartTime과 completeEndTime은 함께 지정해야 합니다.",
    en: "completeStartTime and completeEndTime must be given together.",
  }));
  if (channelField && !p.requestId && !p[channelField]) problems.push(L({
    ko: `requestId가 없으면 ${channelField}(채널 아이디)가 필수입니다.`,
    en: `${channelField} (channel ID) is required when requestId is not given.`,
  }));
  if (problems.length === 0) return undefined;
  return { content: [{ type: "text" as const, text: `❌ ${problems.join("\n❌ ")}` }], isError: true };
}

/** 대체 발송(SMS failover) 설정 — 알림톡·브랜드 메시지 공용. */
export const failoverConfigSchema = z.object({
  type: z.enum(["SMS", "LMS"]).optional().describe("Failover type; omitted = SMS when ≤90 bytes, else LMS"),
  from: z.string().optional().describe("Failover sender number (registered in the console)"),
  subject: z.string().optional().describe("Failover subject (LMS only; default = channel name)"),
  content: z.string().optional().describe("Failover content (default = the message content without buttons)"),
}).optional().describe("SMS failover settings (used with useSmsFailover=true)");

/** 숫자만 허용하는 전화번호. */
export const telNoSchema = z.string().regex(/^\d+$/, "digits only, no hyphens or '+'");
