# @pritzlaff/nano-app

`nano-app <nano.json> [--out dist] [--build "bun run build"]` serves the nano app and the file's project folder (then `--out`) on
`127.0.0.1`, opens the page, saves File › Save back to that one file, and rebuilds when `src/` changes (the page reloads or asks).
`PORT` picks the port, `NO_OPEN=1` skips the browser. Bun only. A project's script: `"test-nano": "nano-app nano.json"`.
