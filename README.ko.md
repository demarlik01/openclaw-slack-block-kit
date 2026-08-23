# OpenClaw Slack Block Kit

[English](README.md) | **한국어**

OpenClaw의 구조화된 답변을 Slack 전용 대시보드, 표, 이미지 카드 등의 Block Kit
레이아웃으로 보여주는 플러그인입니다.

- **현재 Slack 채널·DM·스레드**로 자동 전송합니다.
- OpenClaw에 이미 설정된 Slack 연결을 재사용하므로 모델에 token이나 channel ID를
  노출하지 않습니다.
- 모든 답변을 카드로 바꾸지 않고, Slack 전용 도구 `slack_send_blocks` 하나만 추가합니다.

## Before / After

같은 유형의 가상 판매 리포트를 일반 답변과 Block Kit으로 표현한 비교입니다.

| 일반 텍스트 답변 | `slack_send_blocks` 사용 |
|:---:|:---:|
| ![긴 가상 판매 리포트를 일반 Slack 텍스트로 나열한 화면](docs/images/before-ko.png) | ![가상 판매 리포트를 핵심 요약과 비교표가 있는 Slack 대시보드로 구성한 화면](docs/images/after-ko.png) |

## 설치

요구사항:

- OpenClaw `2026.7.1-2` 이상
- OpenClaw에서 동작하는 Slack 연결

ClawHub에서 설치:

```bash
openclaw plugins install clawhub:openclaw-slack-block-kit
```

또는 npm에서 직접 설치:

```bash
openclaw plugins install npm:openclaw-slack-block-kit
```

설치 후 플러그인 전용 Slack 자격 증명·목적지·추가 설정은 필요 없습니다. OpenClaw에 이미
설정된 Slack 연결과 현재 대화 경로를 재사용합니다.

## Slack에서 사용하기

결과를 받을 Slack 대화에서 자연어로 요청하면 됩니다.

```text
오늘 판매 현황을 핵심 요약과 비교표가 있는 Slack 대시보드로 정리해서 이 스레드에 보여줘.
```

에이전트는 답변에 구조화된 레이아웃이 유용할 때 Block Kit을 선택할 수 있습니다. 직접
요청하려면 도구명을 명시하세요.

```text
slack_send_blocks를 사용해서 아래 후보들을 이미지 카드로 현재 스레드에 보여줘.
```

메시지는 요청을 시작한 Slack 채널·DM·스레드로만 전송됩니다. 이 도구로 다른 목적지를
지정할 수는 없습니다. 다른 채널이나 스레드로 보내려면 OpenClaw 기본 `message` 도구를
사용하세요.

전송에 성공하면 보통 Block Kit 메시지 자체가 최종 답변이며, 일반 텍스트 답변이 중복으로
붙지 않습니다. 각 메시지에는 Slack 알림과 접근성을 위한 fallback text가 포함됩니다.

## 지원 범위

- 비교, 순위, 상태 요약, 여러 필드로 된 레코드, 표, 이미지 카드, 그룹 섹션, 데이터 시각화
- 알려진 표시용 block: `section`(`fields`와 image accessory 포함), `header`, `context`,
  `divider`, `image`, `rich_text`, `table`, `data_visualization`. 공통 구조·크기·URL·안전
  검사는 로컬에서 수행하고 세부 schema는 Slack이 검증합니다.
- 알 수 없는 message-surface block은 같은 공통 로컬 검사를 거친 뒤 경고와 함께
  passthrough합니다.
- 호출당 메시지 1~10개를 입력 순서대로 전송, 메시지당 block 1~50개
- 메시지당 1~4,000자의 필수 fallback text
- OpenClaw의 기존 Slack 인증, outbound queue, hooks, delivery receipt 재사용

이 플러그인은 표시 전용입니다. 버튼, select, input 등 `action_id`가 필요한 요소와 modal,
App Home, `file`/`video`/`call` lifecycle은 지원하지 않습니다.

여러 채널에서 통하는 범용 레이아웃은 OpenClaw 기본 `message` 도구와 `presentation`을
사용하고, raw Slack Block Kit이 꼭 필요할 때 이 플러그인을 사용하세요.

## 문제 해결

### 도구가 보이지 않음

플러그인을 설치하면 도구는 자동으로 등록됩니다. 아래 단계는 활성 도구 정책이나 runtime이
도구를 숨기는 경우에만 접근을 허용하는 절차입니다.

1. Slack에서 요청을 시작하세요. 다른 surface에서는 도구가 의도적으로 숨겨집니다.
2. 플러그인을 설치하거나 업데이트하면 Gateway를 다시 로드해야 합니다. 관리형 Gateway는
   보통 자동으로 재시작되며, 그렇지 않다면 `openclaw gateway restart`를 한 번 실행하세요.
3. 로드된 runtime과 Gateway RPC 상태를 확인하세요.

   ```bash
   openclaw plugins inspect slack-block-kit --runtime --json
   openclaw gateway status --deep --require-rpc
   ```

4. 플러그인이 `loaded`로 표시되지만 도구가 없다면 `openclaw dashboard`를 실행한 뒤,
   **OpenClaw Dashboard → 에이전트(Agents) → 사용할 에이전트 → 도구(Tools)**에서
   `slack_send_blocks`를 활성화하고 **저장(Save)**을 누르세요. 새 로컬 onboarding에서 흔히
   선택되는 `coding` tool profile은 제3자 플러그인 도구를 제외하므로 이 단계가 필요할 수
   있습니다.
5. 플러그인이 disabled라면 `openclaw plugins enable slack-block-kit`을 실행하세요.
6. `plugins.allow`를 사용한다면 `slack-block-kit`이 포함되어 있는지 확인하세요. 이는 agent
   tool policy와 별개인 plugin loading gate입니다.

<details>
<summary>고급 도구 정책 설정</summary>

`coding`, `messaging`, `minimal` 같은 profile은 제3자 플러그인 도구를 제외합니다. Dashboard
toggle은 보통 선택한 agent의 `agents.list[].tools.alsoAllow`에 override를 기록합니다.
Dashboard에 agent가 명시적 allowlist를 사용한다는 안내가 나오면 **Config** tab에서 해당
agent의 `tools.allow`를 수정하세요.

전역에서 허용하려면 활성 OpenClaw 설정 파일을 수정하세요. 기본 경로는
`~/.openclaw/openclaw.json`입니다. CLI `--profile <name>`(tool profile과 무관한 상태 격리
옵션)이나 `OPENCLAW_CONFIG_PATH`에 따라 달라질 수 있으므로 `openclaw config file`로 실제
활성 경로를 확인하세요. 해당 파일의 최상위에 다음 `tools` 항목을 추가하세요.

```json5
{
  tools: {
    alsoAllow: ["slack_send_blocks"],
  },
}
```

한 agent에만 허용하려면 같은 `alsoAllow` 항목을 해당 agent의 `agents.list[].tools` 아래에
추가하세요. 선택한 scope에 이미 `tools.allow`가 있다면 그 배열에 도구를 추가해야 합니다.
한 scope에서 `allow`와 `alsoAllow`를 함께 사용할 수는 없습니다.

Sandbox tool policy는 별도 gate입니다. Sandbox를 사용하는 agent는 plugin id
`slack-block-kit`을 `tools.sandbox.tools.alsoAllow` 또는 기존 sandbox `allow` 배열에서 따로
허용해야 합니다. 모든 plugin tool을 허용할 때만 `group:plugins`를 사용하세요.
Agent·provider·sandbox별 policy는 [OpenClaw tool profile과
policy](https://docs.openclaw.ai/gateway/config-tools)를 참고하세요.

</details>

### 전송 실패

- `INVALID_ARGUMENT`: 각 `messages[]` 항목에 `text`와 `blocks`가 모두 있는지 확인하세요.
- `INVALID_BLOCK_KIT`: `error.issues[].path`를 따라 block, URL, 중첩, 중복 ID 또는
  interactive element를 수정하세요.
- `INVALID_ROUTE`: 실제 Slack 채널·DM·스레드에서 요청을 시작하세요.
- `RUNTIME_CONFIG_UNAVAILABLE`: Gateway와 plugin runtime이 로드됐는지 확인한 뒤 다시
  시도하세요.
- `SLACK_API_ERROR`(예: `message: "invalid_blocks"`): Slack의 최신 block reference와
  비교하거나 [Block Kit Builder](https://app.slack.com/block-kit-builder)에서 테스트하세요.
- `SLACK_RATE_LIMITED`: `retryAfter`가 있으면 그만큼 기다리고, 없으면 잠시 backoff한 뒤
  다시 시도하세요.

## 고급 사용법

<details>
<summary>정확한 도구 입력과 검증</summary>

보통은 에이전트가 다음 payload를 대신 구성합니다. 공개 입력 envelope는 다음과 같습니다.

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

`text`와 `blocks`는 각 `messages[]` 항목 안에 있어야 합니다. 최상위 flat field, 누락
field, 추가 field, 잘못된 type은 거절됩니다.

`validateOnly: true`는 Slack에 보내지 않고 로컬 구조·크기·보안 검증만 수행합니다.
Slack이 모든 block 조합을 수락한다고 보장하지는 않습니다.

여러 메시지 전송은 원자적이지 않습니다. `partial_failed` 뒤에는 실패한 index만 다시
보내야 이미 성공한 메시지의 중복을 피할 수 있습니다.

</details>

## 보안

- 별도 Slack token을 입력받거나 저장하지 않습니다.
- 목적지는 trusted current Slack route에서만 가져옵니다.
- URL-bearing field에는 유효한 `https:` URL만 허용하며, model-facing 오류에는 token,
  전체 payload, 내부 stack을 넣지 않습니다.

Fallback text, block, 이미지 URL에 secret이나 민감한 signed URL을 넣지 마세요.

## 소스에서 개발하기

Node.js와 `pnpm`은 소스 개발 시에만 필요합니다.

```bash
git clone https://github.com/demarlik01/openclaw-slack-block-kit.git
cd openclaw-slack-block-kit
pnpm install --frozen-lockfile
pnpm build
openclaw plugins install --link "$PWD"
openclaw plugins enable slack-block-kit
```

릴리스 검증 명령:

```bash
pnpm typecheck
pnpm test
pnpm verify:completion
pnpm plugin:metadata-check
pnpm plugin:validate
npm pack --dry-run
```

## 참고 문서

- 아키텍처: [한국어](docs/ARCHITECTURE.md) · [English](docs/ARCHITECTURE.en.md)
- Slack: [Block Kit 개요](https://docs.slack.dev/block-kit/) · [Block reference](https://docs.slack.dev/reference/block-kit/blocks/) · [Block Kit Builder](https://app.slack.com/block-kit-builder)
- OpenClaw: [플러그인 설치](https://docs.openclaw.ai/cli/plugins) · [Tool profile과 policy](https://docs.openclaw.ai/gateway/config-tools) · [플러그인 개발](https://docs.openclaw.ai/plugins/building-plugins)

## 라이선스

[MIT](LICENSE)
