# Ncloud MCP Server

[English](./README_EN.md)

[![npm version](https://img.shields.io/npm/v/ncloud-mcp-server.svg)](https://www.npmjs.com/package/ncloud-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

Naver Cloud Platform(Ncloud) 인프라를 AI 어시스턴트에서 직접 관리할 수 있는 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 서버입니다.

## 주요 기능

Ncloud의 **60개 이상 서비스**, **1,000개 이상 API 도구**를 MCP 프로토콜로 제공합니다.

| 카테고리 | 서비스 |
|---------|--------|
| **Compute** | Server, Block Storage, Snapshot, Public IP, Init Script, Login Key, Placement Group, Fabric Cluster, Auto Scaling, Cloud Functions |
| **Networking** | VPC, Subnet, ACG, Network ACL, NAT Gateway, Route Table, VPC Peering, Network Interface, Load Balancer, Target Group, Global DNS, Global Traffic Manager |
| **Database** | Cloud DB for MySQL, PostgreSQL, MSSQL, MongoDB, Cache (Redis/Valkey) |
| **Storage** | Object Storage (S3 호환), Ncloud Storage (S3 호환), NAS, Archive Storage (Swift 호환) |
| **Containers** | Ncloud Kubernetes Service (NKS), Container Registry |
| **Security** | Certificate Manager, Private CA, KMS, Security Monitoring |
| **Monitoring** | Cloud Insight, Log Analytics |
| **Management & Governance** | Activity Tracer, Cloud Advisor, Resource Manager, Sub Account |
| **DevTools** | SourceCommit, SourceBuild, SourceDeploy, SourcePipeline |
| **Analytics** | Search Engine Service, Cloud Hadoop, Cloud Data Streaming Service, Data Stream, Data Catalog, Data Forest, Data Flow, Data Query |
| **Media** | VOD Station, Live Station, Image Optimizer |
| **Content Delivery (CDN)** | Global Edge |
| **Application** | API Gateway, SENS (SMS/Push) |
| **Billing** | Billing (요금/가격 조회, 비용·사용량, 할인) |

> ℹ️ 각 카테고리는 `NCLOUD_TOOL_GROUPS`의 그룹 key와 1:1로 대응합니다. 도구 일부만 로딩하려면 아래 [도구 그룹 선택](#도구-그룹-선택-선택) 표를 참고하세요.

## 사전 요구사항

- Node.js 20 이상
- Ncloud API 인증키 ([포털에서 발급](https://www.ncloud.com/mypage/manage/authkey))

## 참고 사항

- 이 MCP 서버는 **Ncloud 민간존(Public)** 기준으로 구현되었습니다. 금융존/공공존 환경에서는 API 엔드포인트가 다를 수 있습니다.
- API 스펙은 [Ncloud API 공식 문서](https://api.ncloud-docs.com/docs/home)를 기반으로 작성되었습니다.
- 한국(KR) 리전 위주로 테스트되었습니다. 다른 리전에서는 일부 API의 동작이 다를 수 있습니다.

## 설치

### npx (권장 — 설치 불필요)

별도 설치 없이 `npx`로 바로 실행할 수 있습니다:

```bash
npx -y ncloud-mcp-server
```

MCP 클라이언트 설정 방법은 아래 [MCP 클라이언트 설정](#mcp-클라이언트-설정) 섹션을 참고하세요.

### 소스에서 빌드

```bash
# 저장소 클론
git clone https://github.com/sjk4425/ncloud-mcp-server.git
cd ncloud-mcp-server

# 의존성 설치 및 빌드
npm install
npm run build
```

## 환경 변수

| 변수 | 필수 | 설명 | 기본값 |
|------|------|------|--------|
| `NCLOUD_ACCESS_KEY` | ✅ | Ncloud API Access Key | - |
| `NCLOUD_SECRET_KEY` | ✅ | Ncloud API Secret Key | - |
| `NCLOUD_REGION` | - | 리전 코드 | `KR` |
| `NCLOUD_API_URL` | - | API 기본 URL | `https://ncloud.apigw.ntruss.com` |
| `NCLOUD_ARCHIVE_PROJECT_ID` | - | Archive Storage 프로젝트 ID | - |
| `NCLOUD_ARCHIVE_DOMAIN_ID` | - | Archive Storage 도메인 ID | - |
| `NCLOUD_TOOL_GROUPS` | - | 로딩할 도구 그룹 선택. 미설정 시 전체 ON (자세히는 아래 [도구 그룹 선택](#도구-그룹-선택-선택) 참조) | 전체 |
| `NCLOUD_RESPONSE_PRUNE` | - | `1`이면 응답에서 빈 값(`null`/`""`/`[]`/`{}`)을 전역 제거 | `0` |

## MCP 클라이언트 설정

### npx 사용 (권장)

`mcp.json` (또는 해당 클라이언트의 MCP 설정 파일)에 추가:

```json
{
  "mcpServers": {
    "ncloud": {
      "command": "npx",
      "args": ["-y", "ncloud-mcp-server"],
      "env": {
        "NCLOUD_ACCESS_KEY": "your-access-key",
        "NCLOUD_SECRET_KEY": "your-secret-key",
        "NCLOUD_REGION": "KR"
      }
    }
  }
}
```

### 소스 빌드 사용

```json
{
  "mcpServers": {
    "ncloud": {
      "command": "node",
      "args": ["path/to/ncloud-mcp-server/dist/index.js"],
      "env": {
        "NCLOUD_ACCESS_KEY": "your-access-key",
        "NCLOUD_SECRET_KEY": "your-secret-key",
        "NCLOUD_REGION": "KR"
      }
    }
  }
}
```

## 도구 그룹 선택 (선택)

> 기본 설정만으로 전체 도구(약 1,000개)가 모두 동작합니다. 이 섹션은 **도구 수를 줄이고 싶을 때만** 보면 됩니다.

**무엇인가요?** 이 서버에는 도구가 약 1,000개 있습니다. `NCLOUD_TOOL_GROUPS`로 **필요한 서비스 그룹만 켜면**, AI가 한 번에 보는 도구 수가 줄어 토큰 비용이 절감되고 도구 선택 정확도가 올라갑니다.

> 💡 **그냥 다 쓰고 싶다면 이 변수를 설정하지 마세요.** 미설정이 곧 "전체 사용"이며 기존과 동일하게 동작합니다. 아래는 *일부만 켜고 싶을 때*만 필요합니다.

**어떻게 쓰나요?** 위 `mcp.json`의 `env`에 `NCLOUD_TOOL_GROUPS` 한 줄을 추가하고, 켜고 싶은 그룹 key를 쉼표로 나열합니다. (`common`은 Region/Zone 공통 도구라 항상 자동 포함됩니다.)

| 쓰고 싶은 값 | 결과 |
|---|---|
| (미설정) | **전체 그룹 ON** — 기본값, 기존 동작과 동일 |
| `compute,network` | compute + network 그룹만 (+ 자동 common) |
| `compute,network,billing` | 세 그룹만 |
| `all,-billing` | 전체에서 billing만 빼고 (`-`는 "제외") |

**그룹 key → 포함 서비스**

| 그룹 key | 포함 서비스 |
|---|---|
| `compute` | Server, Block Storage, Snapshot, Public IP, Login Key, Init Script, Placement Group, Fabric Cluster, Auto Scaling, Cloud Functions |
| `network` | VPC, Subnet, ACG, Network ACL, NAT Gateway, Route Table, VPC Peering, Network Interface, Load Balancer, Target Group, Global DNS, Global Traffic Manager |
| `database` | Cloud DB for MySQL / PostgreSQL / MSSQL / MongoDB / Cache (Redis/Valkey) |
| `storage` | Object Storage, Ncloud Storage, NAS, Archive Storage |
| `containers` | Ncloud Kubernetes Service(NKS), Container Registry |
| `monitoring` | Cloud Insight, Cloud Log Analytics |
| `governance` | Activity Tracer, Cloud Advisor, Resource Manager, Sub Account |
| `devtools` | SourceCommit, SourceBuild, SourceDeploy, SourcePipeline |
| `analytics` | Search Engine Service, Cloud Hadoop, Cloud Data Streaming Service, Data Stream/Catalog/Forest/Flow/Query |
| `media` | VOD Station, Live Station, Image Optimizer |
| `cdn` | Global Edge |
| `security` | Certificate Manager, Private CA, KMS, Security Monitoring |
| `application` | API Gateway, SENS |
| `billing` | Billing (요금/가격 조회, 비용·사용량, 할인) |
| `common` *(항상 ON)* | Region / Zone 공통 |

> ℹ️ **그룹 key 변경 안내 (v1.2.0):** `integration` → `application`으로 이름이 바뀌었고, `global`은 `cdn`(Global Edge)과 `network`(Global DNS/Traffic Manager)로 나뉘었습니다. 옛 key는 자동 호환되지 않으니 새 key로 변경하세요(옛 key를 지정하면 서버가 안내 메시지를 출력하고 무시합니다).

**설정 예시** (`mcp.json` — 예: compute·network·billing만 사용):

```json
{
  "mcpServers": {
    "ncloud": {
      "command": "npx",
      "args": ["-y", "ncloud-mcp-server"],
      "env": {
        "NCLOUD_ACCESS_KEY": "your-access-key",
        "NCLOUD_SECRET_KEY": "your-secret-key",
        "NCLOUD_REGION": "KR",
        "NCLOUD_TOOL_GROUPS": "compute,network,billing"
      }
    }
  }
}
```

> 서버 시작 시 어떤 그룹이 로딩됐는지 로그로 확인할 수 있습니다:
> `ncloud-mcp-server: 4개 그룹 등록 (common, compute, network, billing)`
> 잘못된 key는 무시되고 경고만 출력됩니다.

## 사용 예시

MCP 클라이언트에서 자연어로 Ncloud 인프라를 관리할 수 있습니다:

```
"현재 서버 목록을 보여줘"
"KR-2 존에 Ubuntu 서버를 하나 만들어줘"
"my-vpc의 서브넷 목록을 조회해줘"
"Cloud DB for MySQL 인스턴스 상태를 확인해줘"
"Object Storage에 새 버킷을 만들어줘"
"로드밸런서에 연결된 타겟 그룹을 확인해줘"
"Cloud Insight에서 CPU 사용률 상위 서버를 조회해줘"
```

## 지원 리전

| 리전 | 코드 |
|------|------|
| 한국 | `KR` |
| 일본 | `JPN` |
| 싱가포르 | `SGN` |

> **참고:** 미국 서부(`USWN`), 독일(`DEN`) 리전은 Classic 환경만 지원되어 VPC 기반인 본 MCP 서버에서는 사용이 제한됩니다.

## 문제 해결

| 증상 | 원인 | 해결 방법 |
|------|------|-----------|
| 서버 시작 시 즉시 종료 | 환경 변수 미설정 | `NCLOUD_ACCESS_KEY`, `NCLOUD_SECRET_KEY` 환경 변수가 설정되어 있는지 확인 |
| `인증 실패` (HTTP 401) | API 인증키 오류 | [포털](https://www.ncloud.com/mypage/manage/authkey)에서 키 상태가 **활성**인지 확인. 키 값에 공백이나 줄바꿈이 포함되지 않았는지 확인 |
| `접근 거부` (HTTP 403) | 서비스 권한 부족 | 서비스 이용 신청 여부 확인. Sub Account 사용 시 해당 서비스에 대한 API 권한 부여 필요 |
| `유효하지 않은 리전입니다` | 잘못된 리전 코드 | 지원 리전(KR, JPN, SGN) 확인. `ncloud_set_region` 도구로 변경 가능 |
| `서비스 일시 불가` (HTTP 503) | API 엔드포인트 연결 불가 | 네트워크 상태 확인. 방화벽/프록시 환경에서는 `ncloud.apigw.ntruss.com` 아웃바운드 허용 필요 |
| `요청 시간 초과` (HTTP 504) | API 응답 지연 | 잠시 후 재시도. 지속 시 Ncloud 상태 페이지 확인 |
| `요청 제한 초과` (HTTP 429) | API Rate Limit 도달 | 요청 간격을 두고 재시도 |

## 프로젝트 구조

```
ncloud-mcp-server/
├── src/
│   ├── index.ts              # MCP 서버 엔트리포인트 (stdio transport)
│   ├── auth/
│   │   └── signature.ts      # HMAC-SHA256 서명 생성
│   ├── client/
│   │   ├── ncloud-client.ts  # Ncloud API HTTP 클라이언트
│   │   ├── s3-compatible-client.ts   # Object Storage (S3 호환)
│   │   └── swift-compatible-client.ts # Archive Storage (Swift 호환)
│   └── tools/                # 서비스별 MCP 도구 (63개 파일)
│       ├── compute-server.ts
│       ├── vpc.ts
│       ├── cloud-insight.ts
│       └── ...
├── package.json
├── tsconfig.json
├── LICENSE
└── README.md
```

## 개발

```bash
# 빌드
npm run build

# 테스트
npm test

# 타입 체크
npx tsc --noEmit
```

## 기여

이슈와 PR을 환영합니다. 기여 시 다음을 참고해주세요:

1. Fork 후 feature 브랜치에서 작업
2. `npm run build`로 빌드 확인
3. `npm test`로 테스트 통과 확인
4. PR 제출

## 라이선스

[MIT](./LICENSE)
