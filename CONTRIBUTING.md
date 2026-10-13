# Contributing

Each WorkerWhisper deployment is a private workspace owned by the person who
deploys it. Use your own Cloudflare account and a separate KV namespace when
testing. Local development still sends audio to Workers AI and consumes your
account's allowance.

Use Node.js 22.18+ and install FFmpeg for the CLI integration test. See the
[README](README.md#run) for configuration and local setup.

Before submitting a pull request, run:

```sh
npm ci
npm run check
npm test
```

Tests use fake AI and storage bindings; they do not require Cloudflare credentials.
FFmpeg is required to run the CLI integration test rather than skip it.

Describe the problem, the resulting behavior, and how you checked it. Update all
three READMEs when changing setup or documented behavior. Include a regression
test for changes to authentication, audio validation, budget enforcement, or resume.

Do not commit credentials, personal recordings, transcripts, `wrangler.jsonc`, or
CLI output directories. Review files before adding them, especially when using a
custom CLI output directory. Keep personal deployment history on private branches.
