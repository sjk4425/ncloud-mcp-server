import { generateSignature } from "../auth/signature.js";
import { fetchWithTimeout } from "./_timeout.js";
import { getRetryContext } from "./_retry-context.js";
import { messages } from "./messages.js";

export interface NcloudClientConfig {
  accessKey: string;
  secretKey: string;
  baseUrl: string;
  regionCode?: string;
}

export interface NcloudApiParams {
  [key: string]: string | number | boolean | string[] | undefined;
}

export class NcloudClient {
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private regionCode: string;

  constructor(config: NcloudClientConfig) {
    this.accessKey = config.accessKey;
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl;
    this.regionCode = config.regionCode ?? "KR";
  }

  setRegionCode(regionCode: string): void {
    this.regionCode = regionCode;
  }

  getRegionCode(): string {
    return this.regionCode;
  }

  serializeListParams(params: NcloudApiParams): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          result[`${key}.${i + 1}`] = value[i];
        }
      } else {
        result[key] = String(value);
      }
    }
    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 429 재시도 백오프(ms). Retry-After 헤더가 있으면 우선, 없으면 지수(1s→2s) + jitter. */
  private computeBackoff(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
    }
    const base = 1000 * Math.pow(2, attempt); // attempt 0 → 1s, attempt 1 → 2s
    return base + Math.random() * 250;
  }

  /**
   * 타임아웃 + 재시도를 적용한 fetch.
   * - 타임아웃: `AbortSignal.timeout`. 초과 시 사용자 친화 메시지로 변환.
   * - 재시도(기본): HTTP 429에만 (요청이 서버 도달 전 거절 — 멱등성 안전). 그 외 상태코드/네트워크 에러는
   *   재시도하지 않는다. Ncloud는 생성/삭제도 GET이 많아 "GET이므로 안전" 가정이 성립하지 않으므로 보수적이다.
   * - 재시도(읽기 전용): 활성 `RetryContext.retryOn5xx`(= `defineTool`이 readOnly 핸들러를 감쌈)이면
   *   조회 호출은 멱등하므로 503·504·네트워크 오류도 429와 동일 백오프로 재시도한다(DESIGN_post-1.4.0 §4).
   * @param buildOptions 시도마다 호출 — 재시도 시 timestamp가 달라지므로 인증 헤더를 매번 재생성해야 한다.
   */
  private async fetchWithRetry(
    urlPath: string,
    buildOptions: () => RequestInit
  ): Promise<Response> {
    const url = `${this.baseUrl}${urlPath}`;
    const maxRetries = 2;
    const retryOn5xx = getRetryContext()?.retryOn5xx === true;
    const debug = process.env.NCLOUD_DEBUG === "1";
    let attempt = 0;
    while (true) {
      let response: Response;
      try {
        response = await fetchWithTimeout(url, buildOptions());
      } catch (err) {
        // 네트워크/타임아웃 오류 — 읽기 전용 호출일 때만 재시도(쓰기는 비멱등 위험 보존).
        if (retryOn5xx && attempt < maxRetries) {
          const delay = this.computeBackoff(attempt, null);
          if (debug) {
            // eslint-disable-next-line no-console
            console.error(`[NCLOUD_DEBUG] 네트워크 오류 — 재시도 ${attempt + 1}/${maxRetries} (${Math.round(delay)}ms 대기): ${url}`);
          }
          await this.sleep(delay);
          attempt++;
          continue;
        }
        throw err;
      }

      // 429는 항상 재시도. 503·504는 읽기 전용 컨텍스트에서만.
      const retryable =
        response.status === 429 ||
        (retryOn5xx && (response.status === 503 || response.status === 504));
      if (retryable && attempt < maxRetries) {
        const delay = this.computeBackoff(attempt, response.headers?.get("retry-after") ?? null);
        if (debug) {
          // eslint-disable-next-line no-console
          console.error(`[NCLOUD_DEBUG] HTTP ${response.status} — 재시도 ${attempt + 1}/${maxRetries} (${Math.round(delay)}ms 대기): ${url}`);
        }
        await this.sleep(delay);
        attempt++;
        continue;
      }
      return response;
    }
  }

  /**
   * 비어있지 않은 응답 본문을 파싱하고 에러를 처리한 뒤 래퍼를 해제한다.
   * request / requestRaw 공통. (빈 본문/204 처리는 성공 응답 형태가 달라 호출부에 남긴다.)
   */
  private parseBodyAndHandle(responseText: string, status: number, ok: boolean): any {
    let body: any;
    try {
      body = JSON.parse(responseText);
    } catch {
      throw new Error(messages().parseFailure(status, responseText.substring(0, 500)));
    }
    if (!ok || body.error || body.responseError) {
      this.handleErrorResponse(status, body);
    }
    return this.unwrapResponse(body);
  }

  private buildAuthHeaders(method: string, url: string): Record<string, string> {
    const timestamp = Date.now().toString();
    const signature = generateSignature({
      method,
      url,
      timestamp,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
    });
    return {
      "x-ncp-apigw-timestamp": timestamp,
      "x-ncp-iam-access-key": this.accessKey,
      "x-ncp-apigw-signature-v2": signature,
    };
  }

  async request(action: string, params?: NcloudApiParams): Promise<any> {
    const serialized = params ? this.serializeListParams(params) : {};
    serialized["responseFormatType"] = "json";
    if (!serialized["regionCode"]) {
      serialized["regionCode"] = this.regionCode;
    }

    const queryString = new URLSearchParams(serialized).toString();
    const urlPath = `${action}?${queryString}`;

    const response = await this.fetchWithRetry(urlPath, () => ({
      method: "GET",
      headers: this.buildAuthHeaders("GET", urlPath),
    }));

    const responseText = await response.text();
    if (!responseText || responseText.trim().length === 0) {
      if (response.ok) {
        return { returnCode: "0", returnMessage: "Success", totalCount: 0 };
      }
      throw new Error(messages().emptyBody(response.status));
    }

    return this.parseBodyAndHandle(responseText, response.status, response.ok);
  }

  async requestRaw(
    method: string,
    path: string,
    queryParams?: Record<string, string | number | boolean | undefined>,
    body?: unknown,
    opts?: { regionHeader?: boolean }
  ): Promise<any> {
    const upperMethod = method.toUpperCase();
    let urlPath = path;
    if (queryParams && Object.keys(queryParams).length > 0) {
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(queryParams)) {
        if (v === undefined) continue;
        normalized[k] = String(v);
      }
      if (Object.keys(normalized).length > 0) {
        const queryString = new URLSearchParams(normalized).toString();
        urlPath = `${path}?${queryString}`;
      }
    }

    const serializedBody =
      (upperMethod === "POST" || upperMethod === "PUT" || upperMethod === "DELETE" || upperMethod === "PATCH") &&
      body !== undefined
        ? JSON.stringify(body)
        : undefined;

    const response = await this.fetchWithRetry(urlPath, () => {
      const headers = this.buildAuthHeaders(upperMethod, urlPath);
      headers["Accept"] = "application/json";
      // Certificate Manager 등 일부 서비스는 GET에도 Content-Type 헤더를 명시적으로 요구함
      headers["Content-Type"] = "application/json";
      // Cloud Insight 계열은 x-ncp-region_code 헤더에 의존 (post/put/delete 래퍼에서 사용)
      if (opts?.regionHeader) {
        headers["x-ncp-region_code"] = this.regionCode;
      }
      const fetchOptions: RequestInit = { method: upperMethod, headers };
      if (serializedBody !== undefined) {
        fetchOptions.body = serializedBody;
      }
      return fetchOptions;
    });

    // Debug logging (env: NCLOUD_DEBUG=1)
    if (process.env.NCLOUD_DEBUG === "1") {
      const respHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => { respHeaders[k] = v; });
      // eslint-disable-next-line no-console
      console.error(`[NCLOUD_DEBUG] ${upperMethod} ${this.baseUrl}${urlPath} -> ${response.status}\n  respHeaders: ${JSON.stringify(respHeaders)}`);
    }

    // Handle 204 No Content or empty body
    if (response.status === 204) {
      return { success: true };
    }

    const responseText = await response.text();
    if (!responseText || responseText.trim().length === 0) {
      if (response.ok) {
        return { success: true };
      }
      // 응답 헤더에서 게이트웨이가 남기는 진단 정보를 함께 노출
      const diag: string[] = [];
      const interestingKeys = [
        "x-ncp-trace-id", "x-amzn-trace-id", "x-ncp-apigw-error-code",
        "x-ncp-apigw-error-message", "x-ratelimit-remaining", "server",
        "x-ncp-apigw-deny-source", "www-authenticate", "x-ncp-apigw-status-code",
      ];
      for (const k of interestingKeys) {
        const v = response.headers.get(k);
        if (v) diag.push(`${k}: ${v}`);
      }
      throw new Error(messages().emptyBody(response.status, diag.length > 0 ? diag.join(" | ") : undefined));
    }

    return this.parseBodyAndHandle(responseText, response.status, response.ok);
  }

  // post/put/delete 는 requestRaw 위의 얇은 래퍼.
  // 기존 동작 보존: Cloud Insight 계열이 의존하는 x-ncp-region_code 헤더를 유지(regionHeader: true).
  // 200/201 + 빈 본문도 requestRaw 가 { success: true } 로 안전 처리한다(과거 .json() 직접 호출 버그 수정).
  async postRequest(path: string, body: unknown): Promise<any> {
    return this.requestRaw("POST", path, undefined, body, { regionHeader: true });
  }

  async putRequest(path: string, body: unknown): Promise<any> {
    return this.requestRaw("PUT", path, undefined, body, { regionHeader: true });
  }

  async deleteRequest(path: string, body?: unknown): Promise<any> {
    return this.requestRaw("DELETE", path, undefined, body, { regionHeader: true });
  }

  private unwrapResponse(body: any): any {
    const keys = Object.keys(body);
    if (keys.length === 1 && keys[0].endsWith("Response")) {
      return body[keys[0]];
    }
    return body;
  }

  private handleErrorResponse(status: number, body: any): never {
    const msg = messages();

    // Format 1: API Gateway error
    if (body.error) {
      const { errorCode, message } = body.error;
      throw new Error(msg.apiFailure(errorCode, message));
    }

    // Format 2: Service-level error
    if (body.responseError) {
      const { returnCode, returnMessage } = body.responseError;
      throw new Error(msg.apiFailure(returnCode, returnMessage));
    }

    // HTTP status code based error
    const knownMessage = msg.httpStatus[status];
    if (knownMessage) {
      throw new Error(knownMessage);
    }

    throw new Error(msg.unknownStatus(status, JSON.stringify(body)));
  }
}
