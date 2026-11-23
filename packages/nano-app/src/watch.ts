import { existsSync, watch as fsWatch } from 'node:fs';
import { join } from 'node:path';

/**
 * Run `build` now, then again after each change under `<project>/src` (recursive, 200 ms of quiet; one build at a time, one more if a
 * change landed meanwhile), telling `rebuilt` or `build-failed <first stderr line>`. Without a `src/` it only builds once.
 */
export function watch(project: string, build: string[], tell: (event: string) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined, running = false, again = false;
  const run = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      const p = Bun.spawn(build, { cwd: project, stdout: 'ignore', stderr: 'pipe' });
      const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
      tell(code === 0 ? 'rebuilt' : `build-failed ${err.trim().split('\n')[0] ?? ''}`.trimEnd());
    } catch (e) { tell(`build-failed ${e instanceof Error ? e.message : String(e)}`); }
    running = false;
    if (again) { again = false; void run(); }
  };
  void run();
  const src = join(project, 'src');
  if (!existsSync(src)) { console.log(`nano-app: no ${src}, not watching for changes`); return () => {}; }
  const w = fsWatch(src, { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(run, 200); });
  return () => { clearTimeout(timer); w.close(); };
}
