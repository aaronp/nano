import './dom.ts'
import { defineCircuit, type Circuit, type Placement } from '../../src/circuit'
import { setup } from '../wires/setup'

defineCircuit()
const tick = () => new Promise(r => setTimeout(r, 0))

// a host with r → d → l (and m unpiped), a page /a showing r, d (tabbed behind r) and l, and a page /b showing l
export async function mount() {
  const { host, app } = await setup()
  const tab = (instance: string, active: boolean): Placement => ({ screen: '/a', instance, box: { x: 0.05, y: 0.2, w: 0.4, h: 0.6 }, tab: { group: 'g', active } })
  const el = document.createElement('c-circuit') as Circuit
  el.screens = () => [{ id: '/a', title: 'Alpha' }, { id: '/b', title: 'Beta' }]
  el.placements = () => [tab('r', true), tab('d', false), { screen: '/a', instance: 'l', box: { x: 0.55, y: 0.2, w: 0.4, h: 0.6 } }, { screen: '/b', instance: 'l' }]
  el.host = host
  document.body.append(el)
  await tick(); await el.updateComplete
  const settle = async () => { await tick(); await tick(); await el.updateComplete }
  return { host, app, el, root: el.shadowRoot!, settle }
}
