# openclaw-slack-block-kit

OpenClaw 에이전트가 현재 Slack 대화와 스레드에 display-only raw Block Kit 메시지를 보내도록
하는 optional tool plugin입니다.

일반 카드에는 OpenClaw의 core `message.presentation`을 사용하세요. 이 플러그인은 image
accessory, 정밀한 fields 배치, `rich_text`, `table`, `data_visualization`처럼 portable
presentation으로 표현하기 어려운 Slack message-surface UI를 위한 escape hatch입니다.

## v1 범위

- 도구: `slack_blocks_send`
- 현재 `deliveryContext`의 Slack 채널·계정·스레드만 사용
- 메시지 1~10개 batch
- OpenClaw durable outbound queue와 receipt 재사용
- display-only raw blocks
- 완전 성공 시 `NO_REPLY`와 Slack-only exact-run safety hook으로 중복 plain-text final 억제
- button/select, modal, App Home, external select, file/video lifecycle은 제외

설계와 정확한 지원 경계는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)를 참고하세요.

## 개발 검증

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm verify:completion
pnpm plugin:metadata-check
pnpm plugin:validate
```

`plugin:metadata-check`와 `plugin:validate`는 먼저 `dist/`를 빌드합니다. generated
`openclaw.plugin.json`에는 `contracts.tools`와 optional tool metadata가 포함되어야 합니다.

코드 변경 중에는 실행 중인 Gateway를 반복 재시작하지 않습니다. 다음 명령은 각각 새 Node
프로세스에서 현재 `dist/`를 읽으므로 등록, 실제 embedded turn, completion delivery hook을 빠르게
확인할 수 있습니다.

```bash
openclaw plugins inspect slack-block-kit --runtime
pnpm verify:completion
openclaw agent --local \
  --agent claw \
  --session-key sbk-local-validate-UNIQUE \
  --channel slack \
  --message 'Call slack_blocks_send once with validateOnly=true, then reply PROBE_OK.' \
  --json
```

`verify:completion`은 production 로그에서 확인한 relay shape를 synthetic fixture로 재구성합니다.
`after_tool_call` 등록 handler로 store를 채운 뒤, 정규화된 plain-text final은 실제 OpenClaw global
hook runner와 outbound delivery pipeline을 통과시킵니다. bootstrap은 빈 payload라 send loop가 0회고,
본 검증은 public `deps.slack` test double을 tripwire로 둔 채 hook 호출·취소 각 1회와 platform adapter
호출 0회를 단언합니다. `skipQueue`도 사용하므로 durable queue를 쓰지 않습니다.

`agent --local` 검증은 고유 session key를 사용하고 `--deliver`를 붙이지 않아 외부 메시지를 보내지
않습니다. 현재 OpenClaw agent-command delivery는 `replyPayloadSendingHook` metadata를 전달하지 않기
때문에, `agent --local --deliver`는 실제 Slack tool 전송·렌더링은 검증할 수 있어도 duplicate-final
suppression의 E2E 증거로 사용할 수 없습니다. 해당 gate는 마지막 Gateway 재시작 뒤 실제 Slack
inbound turn에서 수행합니다.

`plugins.entries.slack-block-kit.enabled` off/on은 설정 hot reload만 일으키며 이미 import된 plugin
코드 캐시는 갱신하지 않으므로 코드 reload 수단으로 사용하지 않습니다. 정적 검증과 fresh-process
검증이 모두 통과한 뒤 최종 Gateway live smoke 직전에만 한 번 재시작합니다.

## 도구 입력

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
  ]
}
```

`target`, `accountId`, `threadTs`, Slack token은 입력받지 않습니다. 목적지는 현재 Slack
conversation의 trusted runtime context에서만 가져옵니다.

도구는 optional이므로 사용할 에이전트의 `tools.allow`에 다음 중 하나가 있어야 합니다.

- `slack_blocks_send`
- `slack-block-kit`
- `group:plugins`
- `*`

로컬 개발 설치 예시:

```bash
pnpm build
openclaw plugins install --link /absolute/path/to/openclaw-slack-block-kit
```

최초 설치 또는 최종 live smoke 전에는 Gateway를 재시작합니다. 개발 중 등록 확인은 fresh-process
`openclaw plugins inspect slack-block-kit --runtime`로 수행하고, Gateway 재시작은 마지막 한 번으로
제한합니다.

실제 전송이 완전히 성공하면 도구는 이미 사용자에게 보이는 결과가 전달됐음을 모델에 알리고
`NO_REPLY`를 요구합니다. 플러그인은 같은 exact `runId`에서 성공한 `slack_blocks_send`만
사용된 경우에 한해 plain-text final을 추가로 억제합니다. 다른 도구를 함께 쓴 run, 검증·부분
실패·전송 실패, host notice, rich payload, provider/runtime 오류 final은 숨기지 않으므로 모델이나
운영자가 복구할 수 있습니다.
