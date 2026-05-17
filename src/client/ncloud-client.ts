import { generateSignature } from "../auth/signature.js";

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
    const headers = this.buildAuthHeaders("GET", urlPath);

    const response = await fetch(`${this.baseUrl}${urlPath}`, {
      method: "GET",
      headers,
    });

    const responseText = await response.text();
    if (!responseText || responseText.trim().length === 0) {
      if (response.ok) {
        return { returnCode: "0", returnMessage: "Success", totalCount: 0 };
      }
      throw new Error(`API 호출 실패: HTTP ${response.status} (빈 응답)`);
    }

    let body: any;
    try {
      body = JSON.parse(responseText);
    } catch {
      throw new Error(`API 응답 파싱 실패: HTTP ${response.status}\n\n응답: ${responseText.substring(0, 500)}`);
    }

    if (!response.ok) {
      this.handleErrorResponse(response.status, body);
    }

    if (body.error) {
      this.handleErrorResponse(response.status, body);
    }

    if (body.responseError) {
      this.handleErrorResponse(response.status, body);
    }

    return this.unwrapResponse(body);
  }

  async requestRaw(
    method: string,
    path: string,
    queryParams?: Record<string, string | number | boolean | undefined>,
    body?: unknown
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

    const headers = this.buildAuthHeaders(upperMethod, urlPath);
    headers["Accept"] = "application/json";
    // Certificate Manager 등 일부 서비스는 GET에도 Content-Type 헤더를 명시적으로 요구함
    headers["Content-Type"] = "application/json";

    const fetchOptions: RequestInit = {
      method: upperMethod,
      headers,
    };

    if (upperMethod === "POST" || upperMethod === "PUT" || upperMethod === "DELETE" || upperMethod === "PATCH") {
      if (body !== undefined) {
        fetchOptions.body = JSON.stringify(body);
      }
    }

    const response = await fetch(`${this.baseUrl}${urlPath}`, fetchOptions);

    // Debug logging (env: NCLOUD_DEBUG=1)
    if (process.env.NCLOUD_DEBUG === "1") {
      const respHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => { respHeaders[k] = v; });
      // eslint-disable-next-line no-console
      console.error(`[NCLOUD_DEBUG] ${upperMethod} ${this.baseUrl}${urlPath} -> ${response.status}\n  reqHeaderKeys: ${Object.keys(headers).join(",")}\n  respHeaders: ${JSON.stringify(respHeaders)}`);
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

    let responseBody: any;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      throw new Error(`API 응답 파싱 실패: HTTP ${response.status}\n\n응답: ${responseText.substring(0, 500)}`);
    }

    if (!response.ok) {
      this.handleErrorResponse(response.status, responseBody);
    }

    if (responseBody.error) {
      this.handleErrorResponse(response.status, responseBody);
    }

    if (responseBody.responseError) {
      this.handleErrorResponse(response.status, responseBody);
    }

    return this.unwrapResponse(responseBody);
  }

  async postRequest(path: string, body: unknown): Promise<any> {
    const headers = this.buildAuthHeaders("POST", path);
    headers["Content-type"] = "application/json";
    headers["x-ncp-region_code"] = this.regionCode;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const responseBody = await response.json();

    if (!response.ok) {
      this.handleErrorResponse(response.status, responseBody);
    }

    if (responseBody.error) {
      this.handleErrorResponse(response.status, responseBody);
    }

    if (responseBody.responseError) {
      this.handleErrorResponse(response.status, responseBody);
    }

    return this.unwrapResponse(responseBody);
  }

  async putRequest(path: string, body: unknown): Promise<any> {
    const headers = this.buildAuthHeaders("PUT", path);
    headers["Content-type"] = "application/json";
    headers["x-ncp-region_code"] = this.regionCode;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });

    const responseBody = await response.json();

    if (!response.ok) {
      this.handleErrorResponse(response.status, responseBody);
    }

    if (responseBody.error) {
      this.handleErrorResponse(response.status, responseBody);
    }

    if (responseBody.responseError) {
      this.handleErrorResponse(response.status, responseBody);
    }

    return this.unwrapResponse(responseBody);
  }

  async deleteRequest(path: string, body?: unknown): Promise<any> {
    const headers = this.buildAuthHeaders("DELETE", path);
    headers["Content-type"] = "application/json";
    headers["x-ncp-region_code"] = this.regionCode;

    const fetchOptions: RequestInit = {
      method: "DELETE",
      headers,
    };

    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${path}`, fetchOptions);

    // Handle 204 No Content
    if (response.status === 204) {
      return { success: true };
    }

    const responseBody = await response.json();

    if (!response.ok) {
      this.handleErrorResponse(response.status, responseBody);
    }

    if (responseBody.error) {
      this.handleErrorResponse(response.status, responseBody);
    }

    if (responseBody.responseError) {
      this.handleErrorResponse(response.status, responseBody);
    }

    return this.unwrapResponse(responseBody);
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
