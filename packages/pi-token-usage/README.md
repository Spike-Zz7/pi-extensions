# pi-token-usage

A lightweight Pi Coding Agent extension that reports the token usage and cost already recorded in local session JSONL files. It does not tokenize conversation text, estimate usage, query account quotas, or recalculate model pricing.

## Install

```bash
cd /home/spike/pi-token-usage
npm install
pi install /home/spike/pi-token-usage
```

Restart Pi after installation, or run `/reload` in an existing Pi TUI. For a one-off test without installing:

```bash
pi -e /home/spike/pi-token-usage/src/index.ts
```

## Use

```text
/usage
/usage today
/usage 7
/usage 30
/usage all
```

Without an argument, `/usage` opens at **Last 7 Days**. In the TUI:

- `←` / `→`: switch time window
- `1` / `2` / `3` / `4`: Today / 7 / 30 / All
- `r`: rescan session files
- `q` / `Esc`: close

`today` starts at local midnight. `7` includes today and the previous six local calendar days, with a daily column chart. `30` is a rolling window ending at the scan time.

## Data source

Sessions are read recursively from:

```text
~/.pi/agent/sessions/
```

When `PI_CODING_AGENT_DIR` is set, the extension uses:

```text
$PI_CODING_AGENT_DIR/sessions/
```

Only `message` entries with an assistant role and recorded `message.usage` are counted. Records are deduplicated globally by `entry.id`. `entry.timestamp`, rather than file modification time, controls time filtering.

## Development

```bash
npm test
npm run typecheck
npm run check
```
