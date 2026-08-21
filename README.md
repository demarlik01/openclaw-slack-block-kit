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
- button/select, modal, App Home, external select, file/video lifecycle은 제외

설계와 정확한 지원 경계는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)를 참고하세요.

## 개발 검증

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm plugin:metadata-check
pnpm plugin:validate
```

`plugin:metadata-check`와 `plugin:validate`는 먼저 `dist/`를 빌드합니다. generated
`openclaw.plugin.json`에는 `contracts.tools`와 optional tool metadata가 포함되어야 합니다.

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

설치 후 Gateway를 재시작하고 `openclaw plugins inspect slack-block-kit --runtime`에서
`slack_blocks_send`가 등록되는지 확인합니다.
