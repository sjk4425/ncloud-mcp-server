import { generateSignature } from "../auth/signature.js";
import { fetchWithTimeout } from "./_timeout.js";

export interface NcloudClientConfig {
  accessKey: string;
  secretKey: string;
  baseUrl: string;
  regionCode?: string;
}

export interface NcloudApiParams {
  [key: string]: string | number | boolean | string[] | undefined;
}

const ERROR_MESSAGES: Record<number, string> = {
  401: "인증 실패: Access Key 또는 Secret Key가 올바르지 않습니다. 환경 변수 NCLOUD_ACCESS_KEY, NCLOUD_SECRET_KEY를 확인하세요.",
  403: "접근 거부: 해당 서비스에 대한 접근 권한이 없습니다. 서비스 이용 신청 여부 및 Sub Account 권한을 확인하세요.",
  413: "요청 크기 초과: 요청 본문이 너무 큽니다.",
  429: "요청 제한 초과: 잠시 후 다시 시도해주세요.",
  503: "서비스 일시 불가: Ncloud API 엔드포인트에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.",
  504: "요청 시간 초과: Ncloud API 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.",
};

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
   * 타임아웃 + 보수적 재시도를 적용한 fetch.
   * - 타임아웃: `AbortSignal.timeout`. 초과 시 사용자 친화 메시지로 변환.
   * - 재시도: HTTP 429에만 (요청이 서버 도달 전 거절 — 멱등성 안전). 그 외 상태코드/네트워크 에러는 재시도하지 않는다.
   *   Ncloud는 생성/삭제도 GET이 많아 "GET이므로 안전" 가정이 성립하지 않으므로 보수적으로 시작한다(DESIGN §3).
   * @param buildOptions 시도마다 호출 — 재시도 시 timestamp가 달라지므로 인증 헤더를 매번 재생성해야 한다.
   */
  private async fetchWithRetry(
    urlPath: string,
    buildOptions: () => RequestInit
  ): Promise<Response> {
    const url = `${this.baseUrl}${urlPath}`;
    const maxRetries = 2;
    let attempt = 0;
    while (true) {
      const response = await fetchWithTimeout(url, buildOptions());

      if (response.status === 429 && attempt < maxRetries) {
        const delay = this.computeBackoff(attempt, response.headers?.get("retry-after") ?? null);
        if (process.env.NCLOUD_DEBUG === "1") {
          // eslint-disable-next-line no-console
          console.error(`[NCLOUD_DEBUG] HTTP 429 — 재시도 ${attempt + 1}/${maxRetries} (${Math.round(delay)}ms 대기): ${url}`);
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
      throw new Error(`API 응답 파싱 실패: HTTP ${status}\n\n응답: ${responseText.substring(0, 500)}`);
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
      throw new Error(`API 호출 실패: HTTP ${response.status} (빈 응답)`);
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
      const diagStr = diag.length > 0 ? `\n  진단 헤더: ${diag.join(" | ")}` : "";
      throw new Error(`API 호출 실패: HTTP ${response.status} (빈 응답)${diagStr}`);
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
    // Format 1: API Gateway error
    if (body.error) {
      const { errorCode, message } = body.error;
      throw new Error(
        `API 호출 실패\n\n에러 코드: ${errorCode}\n메시지: ${message}`
      );
    }

    // Format 2: Service-level error
    if (body.responseError) {
      const { returnCode, returnMessage } = body.responseError;
      throw new Error(
        `API 호출 실패\n\n에러 코드: ${returnCode}\n메시지: ${returnMessage}`
      );
    }

    // HTTP status code based error
    const knownMessage = ERROR_MESSAGES[status];
    if (knownMessage) {
      throw new Error(knownMessage);
    }

    throw new Error(
      `API 호출 실패: HTTP ${status}\n\n응답: ${JSON.stringify(body)}`
    );
  }
}
