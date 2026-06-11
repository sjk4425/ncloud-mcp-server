/**
 * OpenStack Swift-compatible client for Ncloud Archive Storage.
 * Uses Keystone v3 token-based authentication.
 *
 * Authentication:
 *   - Endpoint: https://kr.archive.ncloudstorage.com:5000/v3/auth/tokens
 *   - Access Key → username, Secret Key → password
 *   - Requires project_id and domain_id from Archive Storage console
 *
 * API:
 *   - Endpoint: https://kr.archive.ncloudstorage.com/v1/AUTH_{project_id}
 *   - Header: X-Auth-Token
 */

import { fetchWithTimeout } from "./_timeout.js";

export interface SwiftCompatibleClientConfig {
  accessKey: string;
  secretKey: string;
  projectId: string;
  domainId: string;
  regionCode?: string;
}

interface SwiftRequestOptions {
  method: string;
  container?: string;
  object?: string;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}

interface SwiftResponse {
  status: number;
  headers: Headers;
  body: string;
}

const AUTH_ENDPOINT_MAP: Record<string, string> = {
  KR: "https://kr.archive.ncloudstorage.com:5000",
};

const API_ENDPOINT_MAP: Record<string, string> = {
  KR: "https://kr.archive.ncloudstorage.com",
};

/**
 * Swift-compatible client for Ncloud Archive Storage.
 * Implements OpenStack Keystone v3 token authentication.
 */
export class SwiftCompatibleClient {
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly projectId: string;
  private readonly domainId: string;
  private regionCode: string;

  private token: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(config: SwiftCompatibleClientConfig) {
    this.accessKey = config.accessKey;
    this.secretKey = config.secretKey;
    this.projectId = config.projectId;
    this.domainId = config.domainId;
    this.regionCode = config.regionCode ?? "KR";
  }

  setRegionCode(regionCode: string): void {
    this.regionCode = regionCode;
    // Invalidate token when region changes
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  getRegionCode(): string {
    return this.regionCode;
  }

  getProjectId(): string {
    return this.projectId;
  }

  private getAuthEndpoint(): string {
    return AUTH_ENDPOINT_MAP[this.regionCode] ?? AUTH_ENDPOINT_MAP["KR"];
  }

  private getApiEndpoint(): string {
    return API_ENDPOINT_MAP[this.regionCode] ?? API_ENDPOINT_MAP["KR"];
  }

  /**
   * Authenticate with Keystone v3 and obtain a token.
   * Token is cached and reused until expiration.
   */
  private async authenticate(): Promise<string> {
    // Return cached token if still valid (with 5 min buffer)
    if (this.token && Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.token;
    }

    const authUrl = `${this.getAuthEndpoint()}/v3/auth/tokens`;

    const authBody = {
      auth: {
        identity: {
          methods: ["password"],
          password: {
            user: {
              name: this.accessKey,
              password: this.secretKey,
              domain: {
                id: this.domainId,
              },
            },
          },
        },
        scope: {
          project: {
            id: this.projectId,
          },
        },
      },
    };

    const response = await fetchWithTimeout(authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(authBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Archive Storage 인증 실패: HTTP ${response.status}\n\n응답: ${errorBody}`
      );
    }

    const token = response.headers.get("x-subject-token");
    if (!token) {
      throw new Error("Archive Storage 인증 실패: 응답에 X-Subject-Token 헤더가 없습니다.");
    }

    // Parse expiration from response body
    const body = await response.json() as { token?: { expires_at?: string } };
    if (body.token?.expires_at) {
      this.tokenExpiresAt = new Date(body.token.expires_at).getTime();
    } else {
      // Default: 1 hour from now
      this.tokenExpiresAt = Date.now() + 60 * 60 * 1000;
    }

    this.token = token;
    return token;
  }

  /**
   * Build the storage URL for API requests.
   * Format: {apiEndpoint}/v1/AUTH_{projectId}[/{container}[/{object}]]
   */
  private buildUrl(container?: string, object?: string, queryParams?: Record<string, string>): string {
    let path = `${this.getApiEndpoint()}/v1/AUTH_${this.projectId}`;

    if (container) {
      path += `/${encodeURIComponent(container)}`;
    }
    if (object) {
      // Encode each path segment separately to preserve slashes
      const encodedObject = object
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
      path += `/${encodedObject}`;
    }

    if (queryParams && Object.keys(queryParams).length > 0) {
      const qs = Object.entries(queryParams)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
      path += `?${qs}`;
    }

    return path;
  }

  /**
   * Execute a Swift API request with automatic token management.
   */
  async request(options: SwiftRequestOptions): Promise<SwiftResponse> {
    const { method, container, object, queryParams, headers: extraHeaders, body } = options;

    const token = await this.authenticate();
    const url = this.buildUrl(container, object, queryParams);

    const requestHeaders: Record<string, string> = {
      "X-Auth-Token": token,
      ...extraHeaders,
    };

    const response = await fetchWithTimeout(url, {
      method,
      headers: requestHeaders,
      body: body ?? undefined,
    });

    const responseBody = await response.text();

    if (!response.ok) {
      this.handleErrorResponse(response.status, responseBody, response.headers);
    }

    return { status: response.status, headers: response.headers, body: responseBody };
  }

  private handleErrorResponse(status: number, body: string, headers: Headers): never {
    // If 401, invalidate token for next retry
    if (status === 401) {
      this.token = null;
      this.tokenExpiresAt = 0;
    }

    const transId = headers.get("x-trans-id") ?? "";
    const detail = body.trim() || `HTTP ${status}`;

    throw new Error(
      `Archive Storage 호출 실패: ${detail}${transId ? `\nTransaction-ID: ${transId}` : ""}`
    );
  }
}
