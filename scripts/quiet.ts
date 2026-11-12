/** Runs a command, dropping `bun build`'s success summary (the "Bundled N modules" line and the file-size table) but
 * passing everything else through, errors included: `bun scripts/quiet.ts <command…>`. Exits with the command's code. */
const SUMMARY = /^(Bundled \d+ modules? in |\s*$|\s+\S+\s+[\d.]+ (KB|MB|bytes)\s+\()/

const child = Bun.spawn(process.argv.slice(2), { stdout: 'pipe', stderr: 'pipe', stdin: 'inherit' })
const relay = async (from: ReadableStream<Uint8Array>, to: { write(s: string): unknown }) => {
  let rest = ''
  const dec = new TextDecoder()
  for await (const bytes of from) {
    const chunk = dec.decode(bytes, { stream: true })
    const lines = (rest + chunk).split('\n')
    rest = lines.pop()!
    for (const l of lines) if (!SUMMARY.test(l)) to.write(l + '\n')
  }
  if (rest && !SUMMARY.test(rest)) to.write(rest + '\n')
}
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => child.kill())
await Promise.all([relay(child.stdout, process.stdout), relay(child.stderr, process.stderr)])
process.exit(await child.exited)

export {}
