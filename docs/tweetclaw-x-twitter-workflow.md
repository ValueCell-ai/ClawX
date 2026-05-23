# TweetClaw X/Twitter Workflow

This guide shows how ClawX users can add the separate
[TweetClaw](https://github.com/Xquik-dev/tweetclaw) OpenClaw plugin when an
agent needs structured X/Twitter work: scrape tweets, search tweets, search
tweet replies, post tweets, post tweet replies, export followers, look up users,
upload or download media, send direct messages, monitor tweets, deliver
webhooks, and run giveaway draws.

TweetClaw is not bundled with ClawX. Install it only for agents that need these
X/Twitter workflows.

## When To Use It

Use TweetClaw with ClawX when you need an OpenClaw agent to:

- Research public conversations before drafting a report.
- Track keywords, accounts, replies, quotes, or retweets.
- Export followers or run user lookup for audience research.
- Prepare post tweets or post tweet replies that require explicit review.
- Upload media, download authenticated media, or create media workflows.
- Send direct messages from an approved account-backed workflow.
- Trigger webhooks or giveaway draws from X/Twitter events.

For one-off reading, start with the free `explore` tool. It lists available
TweetClaw endpoints and response shapes without making live API calls.

## Install In The OpenClaw Runtime

Install the official npm package in the OpenClaw runtime that ClawX manages:

```bash
openclaw plugins install @xquik/tweetclaw
```

The npm package is the canonical install source. The
[ClawHub listing](https://clawhub.ai/plugins/@xquik/tweetclaw) is useful for
browsing, but npm may be newer.

TweetClaw can be installed before credentials are configured. Until credentials
are added, `explore` remains available and live calls return setup guidance.

## Configure Access

For account-backed X/Twitter automation, create an API key in the
[Xquik dashboard](https://dashboard.xquik.com/) and store it in an environment
variable:

```bash
export XQUIK_API_KEY="..."
openclaw config set plugins.entries.tweetclaw.config.apiKey "$XQUIK_API_KEY"
```

Keep API keys out of chats, README files, screenshots, and shell history. Let
OpenClaw write the value to local plugin config instead of pasting the key into
an agent prompt.

For read-only pay-per-use workflows without an account, TweetClaw can also use
an MPP signing key. See the TweetClaw README and current
[Xquik billing guide](https://docs.xquik.com/guides/billing) for endpoint
eligibility before enabling that path.

## Allow The Tools

OpenClaw local onboarding often uses a coding-focused tool profile. If an agent
can see the TweetClaw skill but cannot call its tools, allow the two tool names
explicitly:

```bash
openclaw config set tools.alsoAllow '["explore", "tweetclaw"]'
```

`explore` is a catalog search tool. `tweetclaw` invokes selected endpoints and
may perform account-backed reads, paid reads, or write actions.

## Verify From ClawX

After installing and configuring TweetClaw:

1. Restart the OpenClaw Gateway from ClawX, or restart ClawX.
2. Open **Settings -> Advanced -> Developer**.
3. Run **OpenClaw Doctor** and confirm the plugin runtime is healthy.
4. Open the **Skills** page and look for the TweetClaw skill entry.
5. Use the skill location link to inspect its installed `SKILL.md`.

You can also verify from a terminal:

```bash
openclaw plugins inspect tweetclaw --runtime
openclaw skills info tweetclaw
```

## Agent Recipes

Use concrete prompts so the agent starts with discovery before action.

```text
Use explore to find the endpoint for searching tweets about "open source AI
agents". Summarize the available parameters before making any live request.
```

```text
Search tweet replies for the linked launch tweet, group repeated questions, and
draft 3 replies. Do not post anything until I approve the final text.
```

```text
Create a monitor for mentions of our product name. Send a concise daily summary
to this chat and include links to high-priority tweets.
```

```text
Export followers for the connected account and summarize the most common profile
keywords. Do not store raw follower data outside the local workspace.
```

## Cron Workflows

ClawX Cron works well for recurring X/Twitter tasks after TweetClaw is allowed:

- Daily keyword monitoring: search tweets, summarize the top themes, and keep
  the raw links in the task output.
- Reply triage: search tweet replies, draft responses, and require manual
  approval before post tweet replies.
- Campaign tracking: monitor tweets, collect webhook events, and summarize
  reach or engagement signals.
- Giveaway draws: collect eligible replies or retweets, run the draw, and keep
  the result artifact for review.

Keep write tasks review-gated. Scheduled agents should draft posts and replies,
then ask a human to approve the exact action.

## Safety Checklist

- Review every `tweetclaw` request before approving post, reply, direct message,
  media upload, profile, follow, webhook, monitor, extraction, or giveaway
  actions.
- Keep credentials in environment variables or local OpenClaw config only.
- Use `explore` first when building new workflows.
- Confirm billing and endpoint eligibility in the Xquik docs before enabling
  paid reads.
- Keep private exports in the local workspace unless the user chooses another
  destination.

## Troubleshooting

If ClawX does not show TweetClaw:

1. Confirm the package is installed with `openclaw plugins inspect tweetclaw --runtime`.
2. Confirm `explore` and `tweetclaw` are in `tools.alsoAllow`.
3. Restart the ClawX-managed Gateway.
4. Run **OpenClaw Doctor** from ClawX and inspect the diagnostic output.
5. Check the TweetClaw README for the current install and configuration notes.

If live calls return setup guidance, credentials are missing or not visible to
the OpenClaw runtime. Re-run the `openclaw config set` command from the same
environment that launches ClawX.
