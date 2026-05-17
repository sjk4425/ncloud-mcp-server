# Ncloud MCP Server

[English](./README_EN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

Naver Cloud Platform(Ncloud) 인프라를 AI 어시스턴트에서 직접 관리할 수 있는 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 서버입니다.

## 주요 기능

Ncloud의 **60개 이상 서비스**, **1,000개 이상 API 도구**를 MCP 프로토콜로 제공합니다.

| 카테고리 | 서비스 |
|---------|--------|
| **Compute** | Server, Block Storage, Snapshot, Public IP, Init Script, Login Key, Placement Group, Fabric Cluster |
| **Networking** | VPC, Subnet, ACG, Network ACL, NAT Gateway, Route Table, VPC Peering, Network Interface, Load Balancer, Target Group, Global DNS, Global Traffic Manager |
| **Database** | Cloud DB for MySQL, PostgreSQL, MSSQL, MongoDB, Redis |
| **Storage** | Object Storage (S3 호환), NAS, Archive Storage (Swift 호환) |
| **Containers** | Ncloud Kubernetes Service (NKS), Container Registry |
| **Monitoring** | Cloud Insight (Dashboard, Event, Rule, Plugin, Schema, Data, Integration) |
| **DevTools** | SourceCommit, SourceBuild, SourceDeploy, SourcePipeline |
| **Media** | VOD Station, Live Station, Image Optimizer |
| **Security** | Certificate Manager, Private CA, KMS, Security Monitoring |
| **Application** | Cloud Functions, API Gateway, SENS (SMS/Push) |
| **Analytics** | Search Engine Service, Cloud Hadoop, Cloud Data Streaming Service, Data Catalog, Data Forest, Data Flow, Data Query |
| **Management** | Sub Account, Activity Tracer, Resource Manager, Log Analytics, Cloud Advisor, Billing |
| **Content Delivery** | Global Edge |
| **Auto Scaling** | Launch Configuration, Auto Scaling Group, Scaling Policy |

## 참고 사항

- 이 MCP 서버는 **Ncloud 민간존(Public)** 기준으로 구현되었습니다. 금융존/공공존 환경에서는 API 엔드포인트가 다를 수 있습니다.
- API 스펙은 [Ncloud API 공식 문서](https://api.ncloud-docs.com/docs/home)를 기반으로 작성되었습니다.
- 한국(KR) 리전 위주로 테스트되었습니다. 다른 리전에서는 일부 API의 동작이 다를 수 있습니다.

## 사전 요구사항

- Node.js 20 이상
- Ncloud API 인증키 ([포털에서 발급](https://www.ncloud.com/mypage/manage/authkey))

## 설치

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

## MCP 클라이언트 설정

### Kiro / Claude Desktop / Cursor

`mcp.json` (또는 해당 클라이언트의 MCP 설정 파일)에 추가:

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
| 미국 서부 | `USWN` |
| 독일 | `DEN` |

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
