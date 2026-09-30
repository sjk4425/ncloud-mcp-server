# Ncloud MCP Server

[English](./README_EN.md)

[![CI](https://github.com/sjk4425/ncloud-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/sjk4425/ncloud-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ncloud-mcp-server.svg)](https://www.npmjs.com/package/ncloud-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

Naver Cloud Platform(Ncloud) 인프라를 AI 어시스턴트에서 직접 관리할 수 있는 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 서버입니다.

**민간존(Public)과 공공존(Government)을 하나의 서버로 지원**합니다. `NCLOUD_ZONE=gov` 한 줄로 공공존 API 게이트웨이·리전·서비스 카탈로그로 전환되며, 미설정 시 민간존입니다 → [존 선택](#존-선택-민간존--공공존).

## 주요 기능

Ncloud의 **60개 이상 서비스**, **1,000개 이상 API 도구**를 MCP 프로토콜로 제공합니다.

| 카테고리 | 서비스 |
|---------|--------|
| **Compute** | Server, Block Storage, Snapshot, Public IP, Init Script, Login Key, Placement Group, Fabric Cluster, Auto Scaling, Cloud Functions |
| **Networking** | VPC, Subnet, ACG, Network ACL, NAT Gateway, Route Table, VPC Peering, Network Interface, Load Balancer, Target Group, Global DNS, Global Traffic Manager |
| **Database** | Cloud DB for MySQL, PostgreSQL, MSSQL, MongoDB, Cache (Redis/Valkey), **Cloud DB Serverless (MySQL)** 🅿 |
| **Storage** | Object Storage (S3 호환), Ncloud Storage (S3 호환), NAS, Archive Storage (Swift 호환) |
| **Containers** | Ncloud Kubernetes Service (NKS), Container Registry |
| **Security** | Certificate Manager, Private CA, KMS, Security Monitoring |
| **Monitoring** | Cloud Insight, Log Analytics |
| **Management & Governance** | Activity Tracer, Cloud Advisor 🅿, Resource Manager, Sub Account, Web service Monitoring System (WMS) |
| **DevTools** | SourceCommit, SourceBuild, SourceDeploy, SourcePipeline |
| **Analytics** | Search Engine Service, Cloud Hadoop, Cloud Data Streaming Service, Data Stream 🅿, Data Catalog 🅿, Data Forest 🅿, Data Flow 🅿, Data Query 🅿 |
| **Media** | VOD Station, Live Station 🅿, Image Optimizer 🅿, One Click Multi DRM |
| **Content Delivery (CDN)** | Global Edge |
| **Application** | API Gateway, SENS (SMS/알림톡/브랜드메시지/**Mail** 🅿, 프로젝트), Cloud Outbound Mailer(민간존: 레거시 '27-12까지 / 공공존: 정식) |
| **Billing** | Billing (요금/가격 조회, 비용·사용량, 할인) |

> ℹ️ 각 카테고리는 `NCLOUD_TOOL_GROUPS`의 그룹 key와 1:1로 대응합니다. 도구 일부만 로딩하려면 아래 [도구 그룹 선택](#도구-그룹-선택-선택) 표를 참고하세요.
> 🅿 = 민간존 전용(공공존 API 가이드에 없음). 존별 세부 차이는 [존 선택](#존-선택-민간존--공공존)의 표를 참고하세요.

모든 도구에 MCP 표준 **tool annotations**(`readOnlyHint`/`destructiveHint`/`idempotentHint`)이 부여되어, 지원 클라이언트에서 조회 도구 자동 승인·파괴적 도구 확인 UX를 적용할 수 있습니다. 파괴적 도구의 `confirm` 파라미터 게이트는 그대로 유지됩니다(이중 방어).

## 사전 요구사항

- Node.js 20 이상
- Ncloud API 인증키 ([포털에서 발급](https://www.ncloud.com/mypage/manage/authkey))

## 참고 사항

- **민간존(Public)과 공공존(Government)** 을 지원합니다. `NCLOUD_ZONE`으로 선택하며, 인증키는 반드시 해당 존 콘솔에서 발급한 것을 써야 합니다. 금융존은 지원하지 않습니다.
- API 스펙은 [민간존 API 가이드](https://api.ncloud-docs.com/docs/home)와 [공공존 API 가이드](https://api-gov.ncloud-docs.com/docs)를 기반으로 작성되었으며, 존별 엔드포인트·리전·오퍼레이션 차이는 두 가이드를 대조해 반영했습니다.
- 민간존 한국(KR) 리전 위주로 실계정 테스트되었습니다. **공공존 지원은 공공존 공식 API 가이드 대조와 단위 테스트로 검증되었으며 아직 실계정으로 확인되지 않았습니다** — 공공존에서 문제가 있으면 이슈로 알려 주세요. 다른 리전·존에서는 일부 API의 동작이 다를 수 있습니다.

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
| `NCLOUD_ZONE` | - | 존 선택. `public`(민간존) 또는 `gov`(공공존). 잘못된 값이면 시작을 중단 (자세히는 아래 [존 선택](#존-선택-민간존--공공존)) | `public` |
| `NCLOUD_REGION` | - | 리전 코드. 민간존 `KR`/`JPN`/`SGN`/`USWN`/`DEN`, 공공존 `KR`(수도권)/`KRS`(남부권) | `KR` |
| `NCLOUD_API_URL` | - | 기본 API 게이트웨이 override(존 기본값을 덮어씀) | 민간존 `https://ncloud.apigw.ntruss.com` / 공공존 `https://ncloud.apigw.gov-ntruss.com` |
| `NCLOUD_ARCHIVE_PROJECT_ID` | - | Archive Storage 프로젝트 ID | - |
| `NCLOUD_ARCHIVE_DOMAIN_ID` | - | Archive Storage 도메인 ID | - |
| `NCLOUD_SENS_SERVICE_ID` | - | SENS 채널 공통 기본 serviceId(NRN, 예 `ncp:sms:kr:…`). 채널별 변수 `NCLOUD_SENS_SMS_SERVICE_ID` / `NCLOUD_SENS_ALIMTALK_SERVICE_ID` / `NCLOUD_SENS_BRANDMESSAGE_SERVICE_ID`(미설정 시 알림톡 값 사용) / `NCLOUD_SENS_MAIL_SERVICE_ID`가 우선. 모든 SENS 도구는 `serviceId` 파라미터로 호출별 override 가능하며, NRN은 `ncloud_sens_list_projects`로 조회 | - |
| `NCLOUD_STORAGE_ADDRESSING` | - | Ncloud Storage(`ncloud_ncs_*`) 버킷 주소 방식. 기본은 공식 문서의 virtual-hosted(`https://{bucket}.kr.ncloudstorage.com/`), `path`면 이전 방식(`https://kr.ncloudstorage.com/{bucket}/`)으로 되돌림. Ncloud Storage는 KR 단일 리전이라 `NCLOUD_REGION`과 무관 | virtual-hosted |
| `NCLOUD_TOOL_GROUPS` | - | 시작 시 로딩할 도구 그룹 선택. 미설정 시 전체 ON. `dynamic`을 포함하면 핵심 그룹만 켜고 세션 중 확장 허용(그 외 값은 잠금) (자세히는 아래 [도구 그룹 선택](#도구-그룹-선택-선택) 참조) | 전체 |
| `NCLOUD_RESPONSE_PRUNE` | - | `1`이면 응답에서 빈 값(`null`/`""`/`[]`/`{}`)을 전역 제거 | `0` |
| `NCLOUD_TIMEOUT_MS` | - | API 요청 타임아웃(밀리초). 초과 시 호출이 중단되고 안내 메시지를 반환 (HTTP 429는 항상 최대 2회 자동 재시도, 조회 도구는 503/504·네트워크 오류도 재시도) | `30000` |
| `NCLOUD_LANG` | - | 클라이언트 에러 메시지 언어. `en`이면 영문, 그 외/미설정이면 한국어 | `ko` |
| `NCLOUD_RESPONSE_MAXBYTES` | - | 옵트인 응답 크기 가드(바이트). 양수면 조회 도구의 대형 응답을 항목 단위로 잘라 임계 이하로 만들고 `truncated`/`suggestedPageSize` 힌트를 덧붙임. 미설정/0이면 가드 OFF(응답 무변경) | - |

## 존 선택 (민간존 / 공공존)

하나의 패키지로 두 존을 지원합니다. `NCLOUD_ZONE`만 바꾸면 API 게이트웨이 도메인, 리전 카탈로그, 존별 서비스 카탈로그, 일부 서비스의 API 버전·필드 차이까지 서버가 알아서 맞춥니다. 도구 이름과 파라미터는 두 존에서 동일하므로 프롬프트를 바꿀 필요가 없습니다.

| | 민간존 (`public`, 기본값) | 공공존 (`gov`) |
|---|---|---|
| 인증키 발급 | [민간존 콘솔](https://console.ncloud.com) | [공공존 콘솔](https://console.gov-ncloud.com) |
| 기본 게이트웨이 | `ncloud.apigw.ntruss.com` | `ncloud.apigw.gov-ntruss.com` |
| 리전 (`NCLOUD_REGION`) | `KR`, `JPN`, `SGN`, `USWN`, `DEN` | `KR`(수도권), `KRS`(남부권) |
| API 가이드 | https://api.ncloud-docs.com/docs/home | https://api-gov.ncloud-docs.com/docs |

> ⚠️ 인증키는 존별로 별개입니다. 민간존 키로 공공존을 호출하면(또는 그 반대) 인증 오류가 납니다. `NCLOUD_ZONE`에 `public`/`gov` 외의 값을 주면 다른 존으로 조용히 가지 않도록 서버가 시작 시 종료합니다.

**공공존 설정 예시**

```json
{
  "mcpServers": {
    "ncloud-gov": {
      "command": "npx",
      "args": ["-y", "ncloud-mcp-server"],
      "env": {
        "NCLOUD_ZONE": "gov",
        "NCLOUD_ACCESS_KEY": "your-gov-access-key",
        "NCLOUD_SECRET_KEY": "your-gov-secret-key",
        "NCLOUD_REGION": "KR"
      }
    }
  }
}
```

두 존을 동시에 쓰려면 위처럼 이름이 다른 서버 항목을 두 개(`ncloud`, `ncloud-gov`) 등록하면 됩니다.

**존별 차이 (공식 가이드 대조, 2026-09-30 기준)**

| 구분 | 내용 |
|---|---|
| 민간존 전용 서비스 | Cloud DB Serverless, Cloud Advisor, Live Station, Image Optimizer, Data Stream/Catalog/Forest/Flow/Query, SENS Mail 채널 |
| 민간존 전용 오퍼레이션 | LB 리스너 인증서(SNI) 3종, NKS kubeconfig 재발급, VOD Station 채널 수정, DRM 정책 복제, SES/CDSS의 KVM(G3) 생성·스펙 조회 계열, KMS 키 생성의 `protectionType` |
| 공공존 전용 오퍼레이션 | Cloud DB for Cache 사용자(ACL) 관리 4종, Certificate Manager 사설 인증서 발급(`issuePrivate`), Cloud Outbound Mailer 발송·조회 5종(민간존은 SENS Mail로 대체) |
| 같은 서비스, 다른 API | **Cloud Functions**: 민간존 API v2.1(`/ncf/api/v2`, 리전별 호스트) / 공공존 API v2.0(`/api/v2`, Classic 전용, cron·github 트리거만). **Object Storage**: 공공존 `kr`/`krs.object.gov-ncloudstorage.com`, 서명 리전 `gov-standard`/`gov2-standard`. **NKS·NCR·SES·CDSS·Log Analytics**: 리전이 경로에 들어가며(민간존 `sgn`/`jpn`, 공공존 `krs`) 서버가 활성 리전으로 조립 |
| 호스트가 규칙(`*.apigw.gov-ntruss.com`)과 다른 서비스 | Container Registry `gov-ncr`, Private CA `privateca`, VOD Station `vod-station`, KMS `ocapi.gov-ncloud.com`, Ncloud Storage/Object Storage/Archive `*.gov-ncloudstorage.com` |
| 이식하지 않은 서비스 | CDN+, Global CDN (2026-12-31 종료 예정, 신규 생성 불가 — 두 존 모두 Global Edge 사용) |

공공존에서 제공되지 않는 도구는 등록 자체가 되지 않으므로 도구 목록에 나타나지 않습니다. `ncloud_get_current_region`으로 현재 서버가 묶인 존과 사용 가능한 리전을 확인할 수 있습니다.

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

> 기본 설정만으로 전체 도구(약 1,000개)가 모두 동작합니다. **그냥 다 쓰고 싶다면 이 변수를 설정하지 마세요** — 미설정이 곧 "전체 ON"이며 기존과 동일하게 동작합니다. 아래는 *시작 컨텍스트를 가볍게 하거나(권장: `dynamic`), 도구를 일부만 켜고 싶을 때*만 보면 됩니다.

**왜 필요한가요?** 전체 ON이면 도구 정의만으로 세션 컨텍스트를 크게 점유합니다(`tools/list` ≈ 694KB / 약 177k 토큰). `NCLOUD_TOOL_GROUPS`로 필요한 그룹만 켜면 AI가 한 번에 보는 도구 수가 줄어 토큰 비용이 절감되고 도구 선택 정확도가 올라갑니다. 설정은 `mcp.json`의 `env`에 `NCLOUD_TOOL_GROUPS` 한 줄을 추가하면 됩니다. (`common`은 Region/Zone 공통 도구라 항상 자동 포함)

### 한눈에 — 어떤 값을 쓸까

| 원하는 것 | 설정값 | 동작 |
|---|---|---|
| **(권장)** 가볍게 시작하고 필요할 때 자동 확장 | `dynamic` | 핵심 세트로 시작, 나머지는 세션 중 자동으로 켜짐 |
| 특정 그룹을 매일 사용 | `dynamic,analytics` | 핵심 세트 **+ analytics를 시작부터** ON, 나머지는 확장 가능 |
| 처음부터 전부 켜두기 | (미설정) 또는 `all` | 14개 그룹 전부 ON (기존 동작) |
| 정해준 그룹만, 런타임 확장 금지 | `compute,network` | 그 그룹만 — 런타임 확장 **잠금** |
| 전체에서 일부만 제외 | `all,-billing` | billing 빼고 전부 (`-`로 뺀 그룹은 enable도 차단) |

> **핵심 규칙:** **`dynamic` 키워드가 있을 때만** 세션 중 그룹 확장이 켜집니다. `dynamic` 없이 그룹을 나열하면(예: `compute,network`) "딱 이것만"을 의미하는 **잠금**이 되고, `all`/미설정은 이미 전부 켜져 있어 확장이 무의미합니다(더 켤 그룹 없음). 사용 가능한 전체 그룹 key 목록은 아래 **세부 제어**의 표를 참조하세요.

### 권장: `dynamic` (동적 그룹)

전체를 다 켜는 대신 **핵심 그룹만 켠 채 가볍게 시작**하고, AI가 다른 서비스를 요청받으면 **서버 재시작 없이 세션 중에 해당 그룹을 자동으로 켭니다.**

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
        "NCLOUD_TOOL_GROUPS": "dynamic"
      }
    }
  }
}
```

> **한 줄 요약:** `dynamic` = "**확장 모드 ON** + 핵심 세트로 가볍게 시작". 안 쓰는 그룹은 처음에 안 올려 토큰을 아끼고, 필요할 때만 자동으로 켭니다.

- 시작 ON: `common` + `compute` + `network` + `database` (약 367개 도구 / 약 65k 토큰 — 전체 대비 63% 절감)
- AI는 항상 켜져 있는 메타 도구로 나머지 그룹에 도달합니다:
  - `ncloud_list_tool_groups` — 14개 그룹의 서비스·도구 수·현재 ON/OFF 조회
  - `ncloud_enable_tool_group` — 그룹을 런타임에 활성화 (멱등)

**`dynamic` vs `all` — 무엇이 다른가**

| | 시작 시 로딩 | 안 쓰는 그룹 | 토큰(시작) |
|---|---|---|---|
| `all` / (미설정) | 14개 그룹 **전부** | 이미 다 켜져 있음 | ~177k |
| `dynamic` | 핵심 세트만 | **필요할 때** 자동으로 켜짐 | ~65k |

둘 다 결국 모든 그룹을 쓸 수 있지만, `dynamic`은 "처음엔 핵심만, 나머지는 쓸 때" 방식이라 시작 컨텍스트가 가볍습니다. 이 절감이 `dynamic`의 존재 이유입니다.

**동작 흐름** (예: Live Station 요청)

```
1. 서버 시작: 핵심 그룹 + 메타 도구만 ON
2. 사용자: "Live Station 채널 목록 보여줘"
3. AI: 카탈로그에서 media 그룹 확인 → ncloud_enable_tool_group("media")
4. 서버: media 도구 등록 + tools/list_changed 통지 → 클라이언트 도구 목록 갱신
5. AI: 새로 나타난 Live Station 도구 호출 → 작업 계속
```

- 켜진 상태는 **세션 동안만** 유지됩니다(다음 세션은 기본값으로 리셋).
- **`dynamic`에 그룹 키를 더하면 그 그룹은 "시작 즉시 ON"입니다**(나중에 동적으로 붙는 게 아님). 예: `dynamic,analytics`는 핵심 세트 **+ analytics를 처음부터** 켜고 나머지만 확장 대상으로 둡니다. 매일 쓰는 그룹은 이렇게 적어두면 enable 호출 없이 바로 씁니다.

**클라이언트 호환성** — 동적 추가된 도구가 즉시 나타나려면 클라이언트가 `tools/list_changed` 통지를 지원해야 합니다.

| 클라이언트 | `tools/list_changed` | 비고 |
|---|---|---|
| Claude Code | ✅ 지원 (검증) | enable 즉시 같은 세션에서 새 도구 호출 가능 |
| Claude Desktop | ✅ 지원 (MCP 표준) | 미검증 |
| Kiro | ❌ 미반영 (검증) | enable 해도 재시작 전까지 새 도구가 안 보임 — 아래 안내 참고 |
| Cursor | ⚠️ 미검증 | 도구 목록 변경에 수동 새로고침이 필요할 수 있음 — 자가 검증 권장 |
| Codex | ⚠️ 미검증 | 자가 검증 권장 |

> 💡 **표에 없거나 "미검증"인 클라이언트는 30초만에 직접 확인할 수 있습니다.** `NCLOUD_TOOL_GROUPS=dynamic`으로 설정 후 AI에게 *"media 그룹 켜고 Live Station 채널 목록 보여줘"*라고 요청 → **새 도구가 그 세션에서 호출되면 지원**, AI가 도구를 못 찾으면 **미지원**이니 그룹을 미리 나열하는 방식으로 쓰면 됩니다.

> **list_changed 미지원 클라이언트(예: Kiro)에서는 `dynamic`의 세션 중 자동 확장이 동작하지 않습니다.** enable은 되지만 새 도구가 도구 목록에 안 떠 호출할 수 없습니다. 이 경우 자주 쓰는 그룹을 **미리 나열**하세요 — 예: `dynamic,governance,media`처럼 시작부터 켜거나, 명시 리스트(`compute,network,...`)·`all`로 설정. (enable 응답도 같은 폴백을 안내합니다: `NCLOUD_TOOL_GROUPS`에 그룹을 추가하고 재시작.) 폴백 시 기존과 동일한 경험으로 회귀하므로 악화는 없습니다.

> ℹ️ **권한 경계:** MCP 도구가 노출된다고 권한이 부여되는 것은 아닙니다. Ncloud 측 실제 권한은 Access Key의 Sub Account 권한이 최종 경계입니다. 동적 로딩은 confirm 게이트·destructive 경고 등 기존 안전장치를 우회하지 않습니다.

### 세부 제어 — 특정 그룹만 켜기 / 잠금

`dynamic` 없이 그룹 key를 쉼표로 나열하면 **그 그룹만** 켜지고 런타임 확장이 잠깁니다(엄격 운영·최소 권한 환경용). 예: `"NCLOUD_TOOL_GROUPS": "compute,network,billing"`. `all,-billing`처럼 `-`로 특정 그룹을 제외할 수도 있으며, 제외된 그룹은 동적 enable도 거부됩니다(운영자 보안 경계).

> 서버 시작 시 어떤 그룹이 로딩됐는지 로그로 확인할 수 있습니다:
> `ncloud-mcp-server: 4개 그룹 등록 (common, compute, network, billing)`
> 잘못된 key는 무시되고 경고만 출력됩니다.

**그룹 key → 포함 서비스**

| 그룹 key | 포함 서비스 |
|---|---|
| `compute` | Server, Block Storage, Snapshot, Public IP, Login Key, Init Script, Placement Group, Fabric Cluster, Auto Scaling, Cloud Functions |
| `network` | VPC, Subnet, ACG, Network ACL, NAT Gateway, Route Table, VPC Peering, Network Interface, Load Balancer, Target Group, Global DNS, Global Traffic Manager |
| `database` | Cloud DB for MySQL / PostgreSQL / MSSQL / MongoDB / Cache (Redis/Valkey; 공공존은 사용자(ACL) 관리 포함) / Cloud DB Serverless (MySQL, 민간존·메인 계정 키 전용) |
| `storage` | Object Storage, Ncloud Storage, NAS, Archive Storage |
| `containers` | Ncloud Kubernetes Service(NKS), Container Registry |
| `monitoring` | Cloud Insight, Cloud Log Analytics |
| `governance` | Activity Tracer, Cloud Advisor(민간존), Resource Manager, Sub Account, Web service Monitoring System |
| `devtools` | SourceCommit, SourceBuild, SourceDeploy, SourcePipeline |
| `analytics` | Search Engine Service, Cloud Hadoop, Cloud Data Streaming Service, Data Stream/Catalog/Forest/Flow/Query(민간존) |
| `media` | VOD Station, Live Station(민간존), Image Optimizer(민간존), One Click Multi DRM |
| `cdn` | Global Edge |
| `security` | Certificate Manager(공공존은 사설 인증서 발급 포함), Private CA, KMS, Security Monitoring |
| `application` | API Gateway, SENS (SMS/알림톡/브랜드메시지/Mail(민간존), 프로젝트), Cloud Outbound Mailer(민간존 레거시 / 공공존 정식) |
| `billing` | Billing (요금/가격 조회, 비용·사용량, 할인) |
| `common` *(항상 ON)* | Region / Zone 공통 |

> ℹ️ **그룹 key 변경 안내 (v1.2.0):** `integration` → `application`으로 이름이 바뀌었고, `global`은 `cdn`(Global Edge)과 `network`(Global DNS/Traffic Manager)로 나뉘었습니다. 옛 key는 자동 호환되지 않으니 새 key로 변경하세요(옛 key를 지정하면 서버가 안내 메시지를 출력하고 무시합니다).

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

**민간존** (`NCLOUD_ZONE=public`)

| 리전 | 코드 |
|------|------|
| 한국 | `KR` |
| 일본 | `JPN` |
| 싱가포르 | `SGN` |

> **참고:** 미국 서부(`USWN`), 독일(`DEN`) 리전은 Classic 환경만 지원되어 VPC 기반인 본 MCP 서버에서는 사용이 제한됩니다.

**공공존** (`NCLOUD_ZONE=gov`)

| 리전 | 코드 |
|------|------|
| 한국 수도권 (KR-CENTRAL) | `KR` |
| 한국 남부권 (KR-SOUTH) | `KRS` |

> **참고:** 공공존 Ncloud Storage·Archive Storage는 `KR` 단일 리전이며, Object Storage는 `KR`(`gov-standard`)·`KRS`(`gov2-standard`) 두 리전을 제공합니다. `ncloud_set_region`은 존의 리전 목록만 허용합니다.

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
