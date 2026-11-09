/**
 * <puzzle-prototype>: the original puzzle prototype (public/puzzle-prototype/, a design-tool export with its own
 * React-based runtime), shown exactly as designed. It runs in a frame, so nothing of this site's styling reaches it.
 */
export class PuzzlePrototype extends HTMLElement {
  constructor() {
    super()
    // the prototype's artboard is a fixed 1440 × 900
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>:host { display: block; overflow: auto } iframe { display: block; width: 1440px; height: 900px; border: 0 }</style>
      <iframe src="./puzzle-prototype/PuzzlePrototype.dc.html" title="Puzzle prototype"></iframe>`
  }
}
if (!customElements.get('puzzle-prototype')) customElements.define('puzzle-prototype', PuzzlePrototype)
