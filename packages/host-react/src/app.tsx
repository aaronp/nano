/**
 * The React host: a tab bar of the Platform's pages (titles from `title`), the shown page as a CSS grid of its
 * slots in slot order (its column count in `layout.react`), and a picker that deploys a lazy pod into a runtime and
 * applies its slot. Only the shown page is opened (`platform.open`), again when it or its resolution changes.
 */
import { useEffect, useState } from 'react'
import type { Host } from './boot.ts'
import { catalog } from './catalog.ts'
import { SlotCell, type Opened } from './slot.tsx'
import { addPage, addSlot, columnsOf, removeSlot, setColumns, titleOf } from './slots.ts'

/** Re-renders on every Platform change; the pages it names. */
function useChanges(h: Host): [number, string[]] {
  const [seen, set] = useState<[number, string[]]>([0, []])
  useEffect(() => h.platform.listen(c => set(([n]) => [n + 1, [...c.added, ...c.changed, ...c.resolved]])), [h])
  return seen
}

function Picker({ h, page, say }: { h: Host; page: string; say(s: string): void }) {
  const items = catalog(h), runtimes = [...new Set(['main', ...Object.keys(h.app.deployment().runtimes)])]
  const [impl, setImpl] = useState(items[0]?.implementation ?? ''), [runtime, setRuntime] = useState('main')
  const add = async () => { const r = await addSlot(h, page, impl, runtime); say(r.ok ? `added ${r.value}` : r.fail.reason) }
  return (
    <form className="picker" onSubmit={e => { e.preventDefault(); void add() }}>
      <label>Implementation <select value={impl} onChange={e => setImpl(e.target.value)}>
        {items.map(i => <option key={i.implementation} value={i.implementation}>{i.implementation}{i.tag ? '' : ' (no view)'}</option>)}
      </select></label>
      <label>Runtime <input list="runtimes" value={runtime} onChange={e => setRuntime(e.target.value)} required /></label>
      <datalist id="runtimes">{runtimes.map(r => <option key={r} value={r} />)}</datalist>
      <button type="submit" disabled={!impl}>Add slot</button>
    </form>
  )
}

export function App({ h }: { h: Host }) {
  const [n, touched] = useChanges(h), doc = h.platform.document().doc, ids = Object.keys(doc.pages)
  const [chosen, setChosen] = useState(ids[0] ?? ''), page = doc.pages[chosen] ? chosen : (ids[0] ?? '')
  const [opened, setOpened] = useState<Record<string, Opened>>({}), [note, say] = useState('')
  const [opens, setOpens] = useState(0)
  useEffect(() => { if (touched.includes(page)) setOpens(o => o + 1) }, [n])
  useEffect(() => {
    let live = true
    setOpened({})
    if (page) void h.platform.open(page).then(r => { if (live) setOpened(r) })
    return () => { live = false }
  }, [h, page, opens])
  const shown = doc.pages[page], columns = columnsOf(shown)
  const newPage = () => {
    const title = prompt('Page title')?.trim()
    if (!title) return
    const r = addPage(h, title)
    if (r.ok) setChosen(r.value); else say(r.fail.reason)
  }
  return (
    <>
      <nav role="tablist" aria-label="Pages">
        {ids.map(id => <button key={id} role="tab" aria-selected={id === page} onClick={() => setChosen(id)}>{titleOf(id, doc.pages[id])}</button>)}
        <button type="button" onClick={newPage} aria-label="New page">+</button>
      </nav>
      {shown ? <main role="tabpanel" aria-label={titleOf(page, shown)}>
        <div className="bar">
          <Picker key={page} h={h} page={page} say={say} />
          <label>Columns <select value={columns} onChange={e => { const r = setColumns(h, page, Number(e.target.value)); if (!r.ok) say(r.fail.reason) }}>
            {[1, 2, 3, 4].map(c => <option key={c} value={c}>{c}</option>)}
          </select></label>
        </div>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Object.keys(shown.slots).map(s => <SlotCell key={s} h={h} id={s} opened={opened[s]} remove={() => { const r = removeSlot(h, page, s); if (!r.ok) say(r.fail.reason) }} />)}
        </div>
        {!Object.keys(shown.slots).length && <p className="note">No slots yet: add one above.</p>}
      </main> : <p className="note">No pages yet: + makes one.</p>}
      <p className="status" role="status">{h.stopped() ?? note}</p>
    </>
  )
}
