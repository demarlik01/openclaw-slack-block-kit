# openclaw-slack-block-kit 아키텍처

> OpenClaw 에이전트가 필요할 때 Slack Block Kit 메시지를 안전하게 전송하도록 하는 네이티브 플러그인.

## 1. 목적

OpenClaw의 공통 `presentation` 계약은 텍스트, 컨텍스트, 구분선, 버튼, 선택 메뉴를 Slack Block Kit으로 렌더링한다. 하지만 Slack 고유의 `fields`, `accessory`, `image`, `rich_text`, `overflow`, `datepicker` 같은 전체 Block Kit 표현력은 노출하지 않는다.

이 프로젝트는 기존 공통 계약을 대체하지 않는다. 공통 계약으로 표현할 수 없는 Slack 전용 UI가 필요할 때만 사용하는 선택형 도구를 추가한다.

### 목표

- 에이전트 도구 `slack_block_send` 제공
- Slack의 원시 `blocks` 배열 지원
- 기존 OpenClaw Slack 계정, 토큰, 대상 해석 및 전송 경로 재사용
- 전송 전에 구조와 Slack 제한 검증
- 채널, DM, 스레드 전송 지원
- 실패 시 에이전트가 수정 가능한 구조화 오류 반환

### 비목표

- 모든 OpenClaw 최종 응답을 자동으로 Block Kit으로 변환
- 기존 Slack 채널 플러그인 대체 또는 포크
- 별도 Slack 토큰 저장
- Block Kit 시각 편집기 제공
- 파일 업로드와 Block Kit을 한 요청으로 결합
- MVP에서 버튼 클릭 콜백이나 모달 처리

## 2. 핵심 결정

### ADR-001: 자동 변환 훅 대신 명시적 도구

플러그인은 `message_sending` 훅으로 모든 Slack 응답을 가로채지 않고, 에이전트가 필요할 때 `slack_block_send`를 명시적으로 호출하게 한다.

이유:

- 일반 텍스트 응답의 스트리밍을 유지한다.
- 파일, 스레드, 자동 답장과의 충돌을 피한다.
- 카드가 필요한 응답과 그렇지 않은 응답을 에이전트가 구분할 수 있다.
- 원시 Block Kit은 Slack 전용이므로 이식 가능한 기본 응답 경로에 섞지 않는다.

### ADR-002: OpenClaw Slack 런타임 재사용

외부 플러그인에 공개된 `api.runtime.channel.outbound.loadAdapter("slack")`로 Slack outbound adapter를 얻고 `sendPayload(...)`를 호출한다. 검증된 블록은 OpenClaw이 호환성 목적으로 보존하는 `payload.channelData.slack.blocks`에 담는다.

이 경로를 사용하면 다음을 그대로 재사용한다.

- `channels.slack` 및 `channels.slack.accounts.*` 계정 설정
- SecretRef를 포함한 기존 인증 해석
- `channel:`, `user:` 및 Slack ID 대상 해석
- DM 채널 열기
- Slack Web API 클라이언트와 재시도 동작
- 공통 outbound delivery 결과와 `messageId`, `channelId`

플러그인은 Slack 토큰을 입력으로 받거나 자체 설정 파일에 저장하지 않는다.

### ADR-003: 공통 presentation 우선, raw blocks는 escape hatch

도구 설명은 다음 선택 기준을 모델에 명시한다.

1. `text`, `context`, `divider`, `buttons`, `select`만 필요하면 코어 `message` 도구의 `presentation`을 사용한다.
2. Slack 고유 블록 또는 요소가 필요할 때만 `slack_block_send`를 사용한다.

중복 기능처럼 보이더라도 원시 Block Kit 전송을 별도 도구로 분리하면 공통 메시지 스키마를 오염시키지 않고 기능의 위험 범위를 Slack으로 제한할 수 있다.

### ADR-004: 도구는 optional로 등록

`slack_block_send`는 외부 메시지를 전송하는 부수효과 도구이므로 `api.registerTool(..., { optional: true })`로 등록한다. 사용하려는 에이전트의 도구 allowlist에 다음 중 하나를 명시해야 한다.

- `slack_block_send`
- `slack-block-kit`
- `group:plugins`

## 3. 데이터 흐름

```text
Agent
  │
  │ slack_block_send({ target, text, blocks, ... })
  ▼
Tool input schema
  │  필수 필드와 기본 타입 검증
  ▼
Block Kit validator
  │  허용 블록/요소, 개수, 텍스트 길이, action_id 중복 검증
  ▼
OpenClaw public outbound runtime
  │  계정/SecretRef/대상/DM/스레드 처리
  ▼
loadAdapter("slack").sendPayload({ payload.channelData.slack.blocks, ... })
  │
  ▼
Slack chat.postMessage
  │
  ▼
{ ok, messageId, channelId, warnings? }
```

## 4. 공개 도구 계약

### `slack_block_send`

```typescript
type SlackBlockSendInput = {
  target: string;
  text: string;
  blocks: SlackBlock[];
  accountId?: string;
  threadTs?: string;
  replyBroadcast?: boolean;
  validateOnly?: boolean;
};
```

| 필드 | 필수 | 설명 |
|---|---:|---|
| `target` | 예 | `channel:C123`, `user:U123`, 또는 OpenClaw이 허용하는 Slack 대상 |
| `text` | 예 | 알림, 접근성, 검색 결과에 쓰이는 fallback 텍스트 |
| `blocks` | 예 | Slack Block Kit 블록 배열 |
| `accountId` | 아니오 | 다중 Slack 계정 선택. 없으면 현재 에이전트 계정 또는 기본 계정 |
| `threadTs` | 아니오 | Slack 스레드 timestamp |
| `replyBroadcast` | 아니오 | 스레드 답글을 상위 채널에도 노출. 런타임 지원 여부를 구현 단계에서 확인 |
| `validateOnly` | 아니오 | 실제 전송 없이 검증 결과만 반환 |

`text`는 blocks에서 자동 생성하지 않고 항상 요구한다. Slack 알림과 접근성에서 최상위 `text`가 중요하고, 모델이 메시지 의도를 가장 정확하게 요약할 수 있기 때문이다.

### 성공 결과

```json
{
  "ok": true,
  "messageId": "1755771000.123456",
  "channelId": "C12345678",
  "blockCount": 4,
  "warnings": []
}
```

### 검증 실패 결과

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_BLOCK_KIT",
    "message": "Block Kit validation failed",
    "issues": [
      {
        "path": "blocks[2].elements[0].action_id",
        "message": "action_id must be unique within a message"
      }
    ]
  }
}
```

## 5. 검증 설계

검증은 두 단계로 나눈다.

### 5.1 도구 입력 스키마

TypeBox 스키마가 최상위 계약을 검증한다.

- 빈 `target`과 `text` 거부
- `blocks`는 비어 있지 않은 배열
- `accountId`, `threadTs`는 선택 문자열
- `validateOnly`, `replyBroadcast`는 선택 boolean

### 5.2 Block Kit 의미 검증

MVP는 Slack SDK 타입만 신뢰하지 않고 런타임 검증을 수행한다.

- Slack이 허용하는 블록 type인지 확인
- 메시지당 block 개수 제한 확인
- 각 text 객체의 type과 길이 확인
- elements/fields 개수 제한 확인
- 버튼, select 등 action 요소의 `action_id` 존재 및 중복 확인
- URL 형식 확인
- 알려지지 않은 필드는 경고 또는 오류로 처리

정확한 수치 제한은 구현 시 사용하는 Slack Block Kit 공식 규격 버전에 맞춰 상수와 테스트로 고정한다. SDK 타입과 Slack 서버 검증이 달라질 수 있으므로 서버 오류도 별도 코드로 정규화한다.

### 검증 모드

- `strict` 기본값: 알려지지 않은 블록/요소/필드를 거부
- `passthrough` 향후 옵션: 새 Slack 기능을 즉시 써야 할 때 알 수 없는 필드를 보존

MVP는 안전한 `strict`만 구현한다.

## 6. 계정과 대상 해석

계정 우선순위:

```text
input.accountId
  → tool context의 agentAccountId
  → OpenClaw 기본 Slack account
```

대상은 OpenClaw Slack 런타임에 그대로 전달한다. 플러그인이 채널 이름을 임의로 ID로 변환하지 않는다. 안정적인 운영을 위해 문서와 도구 설명에서는 `channel:C...`와 `user:U...` 형식을 권장한다.

현재 세션에서 Slack target과 thread timestamp를 완전히 신뢰할 수 있는 형태로 도구 컨텍스트가 제공하지 않으므로 MVP에서는 `target`을 필수로 둔다. 향후 OpenClaw 공개 컨텍스트가 확장되면 동일 채널 기본값을 추가할 수 있다.

## 7. 상호작용 범위

MVP는 Block Kit을 **표시하고 전송하는 것**까지만 담당한다.

- URL 버튼: 동작
- Slack 클라이언트 내부 선택/입력 UI: 렌더링 가능
- `action_id` 기반 클릭 이벤트 처리: 아직 하지 않음
- 모달 열기, `views.open`: 아직 하지 않음

클릭 이벤트까지 처리하려면 Slack 채널 플러그인의 interactivity ingress와 안전하게 결합해야 한다. 이는 Phase 2에서 별도 공개 콜백 등록 API 존재 여부를 확인한 뒤 설계한다. 임의 HTTP 엔드포인트나 별도 Slack 앱을 추가하지 않는다.

## 8. 프로젝트 구조

```text
openclaw-slack-block-kit/
├── docs/
│   └── ARCHITECTURE.md
├── src/
│   ├── index.ts              # 플러그인 등록
│   ├── tool.ts               # slack_block_send 도구
│   ├── schema.ts             # TypeBox 입력 스키마
│   ├── validator.ts          # Block Kit 의미 검증
│   ├── errors.ts             # 오류 정규화
│   └── types.ts              # 내부 타입
├── test/
│   ├── validator.test.ts
│   └── tool.test.ts
├── openclaw.plugin.json      # 플러그인 발견/설정 스키마
├── package.json
├── tsconfig.json
└── README.md
```

## 9. 플러그인 매니페스트와 설정

예상 매니페스트:

```json
{
  "id": "slack-block-kit",
  "name": "Slack Block Kit",
  "description": "Send validated Slack Block Kit messages through OpenClaw",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "validationMode": {
        "type": "string",
        "enum": ["strict"],
        "default": "strict"
      }
    }
  }
}
```

토큰이나 Slack 앱 설정은 이 플러그인의 config에 두지 않는다. 기존 `channels.slack` 설정이 유일한 인증 원천이다.

## 10. 오류 모델

| 코드 | 의미 | 재시도 |
|---|---|---:|
| `INVALID_INPUT` | 최상위 입력 계약 위반 | 수정 후 |
| `INVALID_BLOCK_KIT` | 블록 의미/제한 위반 | 수정 후 |
| `SLACK_NOT_CONFIGURED` | 선택 계정의 Slack 인증 없음 | 설정 후 |
| `TARGET_NOT_FOUND` | 대상 해석 또는 접근 실패 | 대상 수정 후 |
| `SLACK_RATE_LIMITED` | Slack API rate limit | `retryAfter` 이후 |
| `SLACK_API_ERROR` | 기타 Slack API 오류 | 오류별 판단 |
| `UNSUPPORTED_OPTION` | 현재 런타임이 요청 옵션을 지원하지 않음 | 옵션 제거 |

오류 문자열에 토큰, SecretRef 값, 전체 설정 객체를 포함하지 않는다.

## 11. 보안 원칙

- 도구 입력으로 Slack 토큰을 받지 않는다.
- 로그와 도구 결과에 인증정보를 출력하지 않는다.
- 부수효과 도구이므로 optional 등록한다.
- OpenClaw의 기존 도구 allowlist와 Slack 채널 권한을 우회하지 않는다.
- `target`과 `accountId`를 명시적으로 기록하되 메시지 본문 전체 로깅은 기본 비활성화한다.
- 검증 실패 payload는 크기를 제한해 컨텍스트 폭주를 막는다.

## 12. 테스트 전략

### 단위 테스트

- 지원 블록별 정상 payload
- 중첩 요소와 길이/개수 제한
- 중복 `action_id`
- 잘못된 URL과 text 객체
- 오류 경로가 정확한 배열 인덱스를 가리키는지 확인
- Secret이 오류에 포함되지 않는지 확인

### 도구 테스트

- Slack outbound adapter `sendPayload` mock 호출 인자 확인
- accountId 우선순위
- target/threadTs 전달
- `validateOnly`에서 전송하지 않음
- Slack 오류 코드 정규화

### 통합 테스트

- OpenClaw가 플러그인 매니페스트와 엔트리포인트 발견
- optional tool allowlist 적용
- 테스트 Slack 채널에 section/image/actions 조합 전송
- 스레드 전송 및 반환 message ID 확인

## 13. 구현 단계

### Phase 1 — 전송 MVP

1. 플러그인/TypeScript 스캐폴드
2. `slack_block_send` optional 도구 등록
3. section, divider, context, image, actions 중심 검증
4. OpenClaw Slack 런타임을 통한 전송
5. 단위 테스트와 로컬 플러그인 설치 문서

### Phase 2 — Block Kit 전체 범위와 상호작용

1. 지원 block/element 확대
2. 버튼/선택 이벤트 수신 경로 조사 및 콜백 API 설계
3. 모달 지원 여부 결정
4. Slack Block Kit Builder payload 호환 테스트

### Phase 3 — 편의 기능

1. 재사용 가능한 템플릿
2. 안전한 텍스트→Block Kit 변환 helper
3. 기존 메시지 update 지원
4. Block Kit payload lint CLI

## 14. MVP 완료 기준

- OpenClaw에서 플러그인이 오류 없이 발견되고 활성화된다.
- allowlist에 넣은 에이전트에서만 `slack_block_send`가 보인다.
- 별도 토큰 설정 없이 기존 Slack 계정으로 전송한다.
- section, fields, image, actions가 포함된 메시지를 실제 Slack에 게시한다.
- 잘못된 payload는 Slack API 호출 전에 거부한다.
- 채널과 스레드 전송 결과로 `messageId`, `channelId`를 반환한다.
- 테스트, 설치법, 최소 사용 예제가 문서화된다.

## 15. 구현 전 확인 항목

- 설치된 OpenClaw `2026.7.1-2`의 plugin SDK export에서 Slack runtime 타입을 외부 플러그인이 안정적으로 import할 수 있는지 확인
- `replyBroadcast`를 공개 outbound adapter 계약으로 전달할 수 있는지 확인하고, 없으면 MVP에서 제외
- Slack SDK의 Block/element 런타임 스키마 제공 여부 확인; 없으면 자체 validator 범위를 확정
- 외부 플러그인 패키지에서 `@slack/web-api` 타입을 직접 dependency로 둘지 peer/dev dependency로 둘지 결정
