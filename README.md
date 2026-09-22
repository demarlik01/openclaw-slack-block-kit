# OpenClaw Slack Block Kit

**English** | [한국어](README.ko.md)

Turn structured OpenClaw answers into Slack-native dashboards, tables, image cards,
and other Block Kit layouts.

- Sends to the **current Slack channel, DM, or thread** automatically.
- Reuses the Slack connection already configured in OpenClaw—no token or channel ID
  is exposed to the model.
- Adds one Slack-only tool, `slack_send_blocks`, without turning every reply into a
  card.

## Before / After

The same fictional sales report rendered as a normal reply and with Block Kit.

| Plain text reply | With `slack_send_blocks` |
|:---:|:---:|
| ![A long fictional sales report rendered as plain Slack text](docs/images/before-en.png) | ![The same fictional sales report organized as a Slack dashboard with summary fields and a table](docs/images/after-en.png) |

## Install

Requirements:

- OpenClaw `2026.7.1-2` or later
- A working Slack connection in OpenClaw

Install from ClawHub:

```bash
openclaw plugins install clawhub:openclaw-slack-block-kit
```

Or install directly from npm:

```bash
openclaw plugins install npm:openclaw-slack-block-kit
```

After installation, no plugin-specific Slack credentials, destination, or other
configuration is required. The plugin reuses OpenClaw's existing Slack connection and
the current conversation route.

## Use it from Slack

Start in the Slack conversation where you want the result, then ask naturally:

```text
Show today's sales as a Slack dashboard with a concise summary and comparison table in this thread.
```

The agent can choose Block Kit when the answer benefits from a structured layout. To
request it explicitly, name the tool:

```text
Use slack_send_blocks to show these candidates as image cards in the current thread.
```

The message is always sent back to the Slack channel, DM, or thread where the request
started. The tool cannot redirect it to another destination. For a different channel
or thread, use OpenClaw's core `message` tool.

After every message is successfully sent, the Block Kit message is the final answer,
and the tool instructs the agent to finish with exactly `NO_REPLY`. Duplicate prevention
depends on the agent following that instruction. This plugin registers no hooks that
intercept progress or final delivery, so an additional plain-text reply is possible if
the agent ignores it. Each message includes fallback text for Slack notifications and
accessibility.

## What it supports

- Comparisons, ranked results, status summaries, multi-field records, tables, image
  cards, grouped sections, and data visualizations
- Known display blocks: `section` (including `fields` and an image accessory),
  `header`, `context`, `divider`, `image`, `rich_text`, `table`, and
  `data_visualization`; common structure, size, URL, and safety checks run locally,
  while Slack validates their detailed schema
- Warning-bearing passthrough for unknown message-surface blocks, with the same
  common local checks
- 1–10 messages per call, in order; 1–50 blocks per message
- Required fallback text of 1–4,000 characters per message
- OpenClaw's existing Slack authentication, outbound queue, hooks, and delivery receipts

This plugin is display-only. It does not support buttons, selects, inputs, or any other
element that requires an `action_id`; nor does it handle modals, App Home, or
`file`/`video`/`call` lifecycles.

For a portable layout across channels, use OpenClaw's core `message` tool with
`presentation`; use this plugin when you specifically need raw Slack Block Kit.

## Troubleshooting

### The tool does not appear

Plugin installation registers the tool automatically. The steps below grant access only
when the active tool policy or runtime hides it.

1. Start the request from Slack. The tool is intentionally hidden on other surfaces.
2. Plugin installs and updates require the Gateway to reload. A managed Gateway normally
   restarts automatically; otherwise run `openclaw gateway restart` once.
3. Inspect the loaded runtime and confirm that the Gateway RPC is healthy:

   ```bash
   openclaw plugins inspect slack-block-kit --runtime --json
   openclaw gateway status --deep --require-rpc
   ```

4. If the plugin reports `loaded` but the tool is missing, run `openclaw dashboard`, then
   open **OpenClaw Dashboard → Agents → select your agent → Tools**, enable
   `slack_send_blocks`, and select **Save**. This is commonly needed when local
   onboarding selected the `coding` tool profile, which excludes third-party plugin
   tools.
5. If the plugin is disabled, run `openclaw plugins enable slack-block-kit`.
6. If `plugins.allow` is configured, make sure it includes `slack-block-kit`. This is a
   plugin-loading gate, separate from the agent's tool policy.

<details>
<summary>Advanced tool policy setup</summary>

Profiles such as `coding`, `messaging`, and `minimal` exclude third-party plugin tools.
The Dashboard toggle normally writes `agents.list[].tools.alsoAllow` for the selected
agent. If the Dashboard reports that the agent uses an explicit allowlist, update that
agent's `tools.allow` in the Dashboard **Config** tab instead.

To grant the tool globally, edit the active OpenClaw configuration file—normally
`~/.openclaw/openclaw.json`. A CLI `--profile <name>` (state isolation, unrelated to tool
profiles) or `OPENCLAW_CONFIG_PATH` can change this location; run `openclaw config file`
to print the active path. Add the following top-level `tools` entry to that file:

```json5
{
  tools: {
    alsoAllow: ["slack_send_blocks"],
  },
}
```

To limit the grant to one agent, put the same `alsoAllow` entry under that agent's
`agents.list[].tools` instead. If the chosen scope already has `tools.allow`, add the
tool to that array; `allow` and `alsoAllow` cannot coexist in one scope.

Sandbox tool policy is a separate gate. Sandboxed agents also need the plugin id
`slack-block-kit` in `tools.sandbox.tools.alsoAllow` (or the existing sandbox `allow`
array). Use `group:plugins` instead only to allow every plugin tool. For agent-,
provider-, or sandbox-specific policies, see
[OpenClaw tool profiles and policies](https://docs.openclaw.ai/gateway/config-tools).

</details>

### A send fails

- `INVALID_ARGUMENT`: check that each item in `messages[]` contains both `text` and
  `blocks`.
- `INVALID_BLOCK_KIT`: follow `error.issues[].path` and fix the reported block, URL,
  nesting, duplicate ID, or interactive element.
- `INVALID_ROUTE`: start the request from a real Slack channel, DM, or thread.
- `RUNTIME_CONFIG_UNAVAILABLE`: check that the Gateway and plugin runtime are loaded,
  then retry.
- `SLACK_API_ERROR` (for example, `message: "invalid_blocks"`): compare the payload
  with Slack's current block reference or test it in
  [Block Kit Builder](https://app.slack.com/block-kit-builder).
- `SLACK_RATE_LIMITED`: wait `retryAfter` seconds when provided; otherwise back off
  briefly before retrying.

## Advanced usage

<details>
<summary>Exact tool input and validation</summary>

The agent normally builds this payload for you. The public input envelope is:

```json
{
  "messages": [
    {
      "text": "Fallback for accessibility and notifications",
      "blocks": [
        {
          "type": "section",
          "text": { "type": "mrkdwn", "text": "*Candidate 1*" },
          "accessory": {
            "type": "image",
            "image_url": "https://example.com/item.png",
            "alt_text": "Candidate image"
          }
        }
      ]
    }
  ],
  "validateOnly": false
}
```

`text` and `blocks` belong inside every `messages[]` item. Flat top-level fields,
missing fields, extra fields, and wrong types are rejected.

`validateOnly: true` runs local structure, size, and safety checks without sending to
Slack. It does not guarantee that Slack will accept every block combination.

Multi-message sends are not atomic. After a `partial_failed` result, retry only the
failed indexes to avoid duplicating messages that already succeeded.

</details>

## Security

- The plugin neither accepts nor stores a separate Slack token.
- The destination comes only from the trusted current Slack route.
- URL-bearing fields require valid `https:` URLs, and model-facing errors omit tokens,
  full payloads, and internal stacks.

Do not put secrets or sensitive signed URLs in fallback text, blocks, or image URLs.

## Develop from source

Node.js and `pnpm` are required only for source development.

```bash
git clone https://github.com/demarlik01/openclaw-slack-block-kit.git
cd openclaw-slack-block-kit
pnpm install --frozen-lockfile
pnpm build
openclaw plugins install --link "$PWD"
openclaw plugins enable slack-block-kit
```

Run the release checks with:

```bash
pnpm typecheck
pnpm test
pnpm plugin:metadata-check
pnpm plugin:validate
npm pack --dry-run
```

## References

- Architecture: [English](docs/ARCHITECTURE.en.md) · [한국어](docs/ARCHITECTURE.md)
- Slack: [Block Kit overview](https://docs.slack.dev/block-kit/) · [Block reference](https://docs.slack.dev/reference/block-kit/blocks/) · [Block Kit Builder](https://app.slack.com/block-kit-builder)
- OpenClaw: [Plugin installation](https://docs.openclaw.ai/cli/plugins) · [Tool profiles and policies](https://docs.openclaw.ai/gateway/config-tools) · [Building plugins](https://docs.openclaw.ai/plugins/building-plugins)

## License

[MIT](LICENSE)
