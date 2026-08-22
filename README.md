# OpenClaw Slack Block Kit

OpenClaw 에이전트가 **현재 Slack 채널·DM·스레드**에 표, 이미지가 붙은 카드, 정밀한
필드 배치 같은 Slack 전용 Block Kit 메시지를 보내게 해주는 플러그인입니다.

기존 OpenClaw Slack 연결과 현재 대화 목적지를 그대로 사용하므로 별도 Slack token이나
channel ID를 모델에 넘길 필요가 없습니다.

설계 문서: [한국어(기준)](docs/ARCHITECTURE.md) · [English](docs/ARCHITECTURE.en.md)

## 언제 사용하나요?

| 원하는 결과 | 권장 경로 |
|---|---|
| 일반 텍스트, 구분선, 버튼/select가 있는 범용 카드 | OpenClaw 기본 `message` + `presentation` |
| image accessory, 정밀한 fields, `rich_text`, `table`, `data_visualization` | 이 플러그인의 `slack_send_blocks` |
| raw interaction handler, modal, App Home, 파일·비디오 workflow | 이 플러그인의 범위 밖 |

이 플러그인은 모든 답변을 Block Kit으로 바꾸지 않습니다. Slack 전용 레이아웃이 꼭 필요할
때만 호출하는 display-only escape hatch입니다.

## 요구사항

- OpenClaw `2026.7.1-2` 이상
- OpenClaw에서 이미 동작하는 Slack 연결
- Node.js와 `pnpm`
- 이 저장소의 로컬 checkout — 현재 package는 npm 공개 배포본이 아닙니다

## 3분 설치

### 1. 빌드하고 로컬 플러그인으로 연결

```bash
cd /path/to/openclaw-slack-block-kit
pnpm install --frozen-lockfile
pnpm build
openclaw plugins install --link "$PWD"
openclaw plugins enable slack-block-kit
```

### 2. 사용할 에이전트에 optional tool 허용

권장 방식은 해당 에이전트의 기존 설정에 `slack_send_blocks`만 추가하는 것입니다.

```json5
{
  agents: {
    list: [
      {
        id: "my-agent",
        tools: { alsoAllow: ["slack_send_blocks"] },
      },
    ],
  },
}
```

이미 같은 scope에 `tools.allow`가 있다면 `allow`와 `alsoAllow`를 함께 쓸 수 없습니다. 그 경우
기존 `allow` 배열에 `slack_send_blocks`를 추가하세요. `slack-block-kit` 또는
`group:plugins`도 허용 항목으로 사용할 수 있지만, 필요한 도구 하나만 허용하는 편이 안전합니다.

### 3. Gateway에 로드하고 확인

```bash
openclaw plugins inspect slack-block-kit --runtime --json
openclaw gateway status
```

runtime inspect 결과에 `slack_send_blocks`와 플러그인 hooks가 보이고 Gateway가 정상이면 준비가
끝났습니다. managed Gateway는 보통 설치·설정 변경을 감지해 재시작합니다. 자동 reload가 되지
않았거나 linked source를 수정했다면 `pnpm build` 후 `openclaw gateway restart`를 한 번만 실행해
새 `dist/`를 로드하세요.

## Slack에서 사용하기

Slack에서 에이전트에게 자연어로 요청하면 됩니다.

```text
아래 후보들을 이미지가 붙은 Slack 카드로 정리해서 현재 스레드에 보내줘.
slack_send_blocks를 마지막 도구로 한 번만 사용해.
```

성공하면 다음과 같이 동작합니다.

- 요청한 Block Kit 카드가 현재 채널 또는 현재 스레드에 표시됩니다.
- 각 메시지의 `text`는 알림과 접근성을 위한 fallback으로 사용됩니다.
- 도구 결과가 `ok=true`, `status=sent`, `complete=true`이면 전송이 끝난 것입니다.
- 카드 자체가 최종 응답이므로 모델은 성공 뒤 `NO_REPLY`를 반환하고 별도 일반 답변을 붙이지 않습니다.

다른 채널로 보낼 `target`, `accountId`, `threadTs`는 받지 않습니다. Slack 스레드에서 호출하면
그 스레드를 자동으로 상속합니다. 다른 목적지로 명시적으로 보내려면 OpenClaw의 기본 `message`
도구를 사용하세요.

## 정확한 도구 입력

직접 tool call을 만들거나 에이전트 prompt에 형식을 명시할 때는 다음 envelope를 사용합니다.

```json
{
  "messages": [
    {
      "text": "접근성·알림용 fallback",
      "blocks": [
        {
          "type": "section",
          "text": { "type": "mrkdwn", "text": "*후보 1*" },
          "accessory": {
            "type": "image",
            "image_url": "https://example.com/item.png",
            "alt_text": "후보 이미지"
          }
        }
      ]
    }
  ],
  "validateOnly": false
}
```

`text`와 `blocks`는 반드시 `messages[]`의 각 항목 안에 있어야 합니다. 최상위에 두면
`INVALID_ARGUMENT`으로 거절됩니다.

`validateOnly: true`는 로컬 구조·크기·보안 검증만 수행하고 Slack에는 아무것도 보내지 않습니다.
Slack API가 최신 block 조합을 실제로 받아준다는 것까지 보장하지는 않습니다.

## 지원 범위

- 호출당 메시지 1~10개를 입력 순서대로 전송
- 메시지당 fallback `text` 1~4,000자
- 메시지당 block 1~50개
- `section`, `fields`, image accessory, `context`, `header`, `divider`, `image`
- `rich_text`, `table`, `data_visualization`과 알 수 없는 신규 message block passthrough
- OpenClaw의 기존 Slack 인증, durable outbound queue, hook, receipt 재사용

다음은 v1에서 지원하지 않습니다.

- button, checkbox, select 등 `action_id`가 필요한 interaction
- `actions`와 `input` block
- modal과 App Home
- external select Options Load
- `file`, `video`, `call` block과 관련 lifecycle
- 여러 메시지의 원자적 전송

알 수 없는 block은 Slack에 그대로 전달되므로 최종 수락 여부는 Slack API가 판단합니다.

## 결과 해석

| 결과 | 의미 | 다음 행동 |
|---|---|---|
| `validated` | 로컬 검증만 통과, 전송 없음 | 필요하면 `validateOnly=false`로 호출 |
| `sent`, `complete=true` | 모든 payload의 플랫폼 receipt 확인 | 완료, 재시도하지 않음 |
| `partial_failed` | 일부 메시지는 전송되고 일부 실패 | `failed[].index`만 재구성해 재시도 |
| `partial_suppressed` / `incomplete_sent` | 전체 완료를 증명하지 못함 | 결과의 index와 receipt 확인 후 복구 |
| `suppressed` | outbound hook 또는 정책이 전송을 막음 | reason과 OpenClaw 정책 확인 |
| `failed` | 플랫폼 receipt 없이 실패 | 구조화된 error code와 message 확인 |

배치는 원자적이지 않습니다. `partial_failed` 뒤 전체 `messages`를 그대로 재시도하면 이미 성공한
카드가 중복될 수 있습니다.

## 문제 해결

### 도구가 보이지 않음

1. 현재 요청이 Slack에서 시작됐는지 확인합니다. 도구는 Slack surface에서만 노출됩니다.
2. `openclaw plugins inspect slack-block-kit --runtime --json`으로 등록 상태를 확인합니다.
3. `plugins.allow`가 설정되어 있다면 `slack-block-kit`이 포함됐는지 확인합니다.
4. 에이전트의 `tools.allow` 또는 `tools.alsoAllow`에 `slack_send_blocks`가 있는지 확인합니다.
5. sandboxed agent라면 sandbox tool policy에도 이 plugin tool이 허용됐는지 확인합니다.

### `INVALID_ARGUMENT`

입력이 정확히 `{"messages":[{"text":"...","blocks":[...]}],"validateOnly":false}` 형태인지
확인하세요. 누락 필드, 추가 필드, 잘못된 타입도 이 오류로 반환됩니다.

### `INVALID_BLOCK_KIT`

`error.issues[]`의 path를 따라 block 수, URL, 중첩 깊이, 중복 ID 또는 지원하지 않는 interactive
element를 수정하세요.

### `INVALID_ROUTE`

도구가 현재 Slack 채널·DM·스레드의 delivery context를 받지 못한 경우입니다. Telegram, CLI 등
다른 surface가 아니라 실제 Slack 대화에서 요청을 시작했는지 확인하세요.

### Slack의 `invalid_blocks`

로컬 안전 검증은 통과했지만 Slack의 최신 message-surface schema가 payload를 거절한 경우입니다.
Slack Block Kit 규격에 맞게 해당 block을 수정하세요.

### 성공했는데 일반 답변이 없음

정상 동작입니다. 이미 보이는 Block Kit 카드가 최종 응답입니다.

## 보안과 라우팅

- 별도 Slack token을 입력하거나 저장하지 않습니다.
- 목적지는 trusted runtime의 현재 Slack route에서만 가져옵니다.
- URL-bearing field에는 유효한 `https:` URL만 허용합니다.
- model-facing 오류에 token, 전체 payload, 내부 stack을 넣지 않습니다.
- fallback text, blocks, 이미지 URL에 secret이나 민감한 signed URL을 넣지 마세요.

## 개발과 검증

```bash
pnpm typecheck
pnpm test
pnpm verify:completion
pnpm plugin:metadata-check
pnpm plugin:validate
```

`plugin:metadata-check`와 `plugin:validate`는 먼저 `dist/`를 빌드합니다. generated
`openclaw.plugin.json`에는 `contracts.tools`와 optional tool metadata가 포함되어야 합니다.

`pnpm verify:completion`은 실제 Slack으로 보내지 않고 fresh process에서 production-observed relay
shape를 재현합니다. 실제 OpenClaw global hook runner와 outbound pipeline을 사용해 plain-text final이
hook에서 한 번 취소되고 Slack adapter가 호출되지 않는지 검증합니다.

실제 Slack smoke와 completion hook 증거는 구분해야 합니다.

- `message_tool_only` source의 live smoke는 카드 전송, route/thread 상속, 렌더링, 정상 run 종료를
  검증합니다. ordinary model final이 원래 외부 전달 대상이 아니므로 hook 취소를 증명하지는 않습니다.
- ordinary final이 자동 전달되고 exact run metadata가 제공되는 source에서만 live hook E2E를
  검증할 수 있습니다.
- metadata가 없거나 충돌하면 hook은 진단 메시지를 숨기지 않도록 fail-open합니다.

코드 변경 중 production Gateway를 반복 재시작할 필요는 없습니다. 다음 검증은 각각 현재 `dist/`를
읽는 새 프로세스에서 수행할 수 있습니다.

```bash
openclaw plugins inspect slack-block-kit --runtime
pnpm verify:completion
openclaw agent --local \
  --agent my-agent \
  --session-key sbk-local-validate-UNIQUE \
  --channel slack \
  --message 'Call slack_send_blocks once with validateOnly=true, then reply PROBE_OK.' \
  --json
```

`agent --local` 검증에는 `--deliver`를 붙이지 않아 외부 메시지를 보내지 않습니다. 정적 검증과
fresh-process 검증이 끝난 뒤 최종 live smoke 직전에만 Gateway를 재시작하세요.

정확한 설계 계약, 검증 한도, completion fail-open 규칙과 오류 모델은
[한국어 아키텍처(기준)](docs/ARCHITECTURE.md) 또는
[English architecture](docs/ARCHITECTURE.en.md)를 참고하세요.
