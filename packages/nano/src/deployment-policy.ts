/**
 * DeploymentPolicy: the yes/no check the application makes before `apply` changes its deployment, like `Policy` for a message.
 *
 *   const p = DeploymentPolicies.allowAll()
 *   await p.isAllowed({ caller: 'host', deployment })   // { approved: true }
 */
import type { AppDeployment } from './deployment.ts'
import type { Verdict } from './policy.ts'

/** What it is asked: who applies (`'host'` or a pod name) and the deployment they want. */
export type DeploymentAsk = { caller: string; deployment: AppDeployment }
export type DeploymentPolicy = { isAllowed(ask: DeploymentAsk): Verdict | Promise<Verdict> }

const ALLOW_ALL: DeploymentPolicy = Object.freeze({ isAllowed: () => ({ approved: true as const }) })

export const DeploymentPolicies = {
  allowAll: (): DeploymentPolicy => ALLOW_ALL,
}
