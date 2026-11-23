// Step 1: a calculator in plain TypeScript, no nano yet.
// #region plain
type Operator = '+' | '-' | '*' | '/'

export function calculate(a: number, op: Operator, b: number): number {
  if (op === '/' && b === 0) throw new Error('cannot divide by zero')
  return op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
}
// #endregion plain

export async function main(log: (line: string) => void) {
  // #region use
  log(`2 + 3 = ${calculate(2, '+', 3)}`)
  try { calculate(1, '/', 0) } catch (e) { log(`1 / 0: ${(e as Error).message}`) }
  // #endregion use
}
