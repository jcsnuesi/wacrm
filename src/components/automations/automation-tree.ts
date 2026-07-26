import type { AutomationStepType } from "@/types"

export interface BuilderStep {
  /** Stable client id. The API assigns database UUIDs when saving. */
  cid: string
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branches?: { yes: BuilderStep[]; no: BuilderStep[] }
}

export type BranchTarget =
  { kind: "root" } | { kind: "branch"; parentCid: string; branch: "yes" | "no" }

export interface TreeMutation {
  steps: BuilderStep[]
  changed: boolean
}

export function findStepByCid(
  steps: BuilderStep[],
  cid: string
): BuilderStep | null {
  for (const step of steps) {
    if (step.cid === cid) return step
    if (!step.branches) continue
    const nested =
      findStepByCid(step.branches.yes, cid) ??
      findStepByCid(step.branches.no, cid)
    if (nested) return nested
  }
  return null
}

export interface StepContext {
  step: BuilderStep
  index: number
  total: number
}

export function findStepContextByCid(
  steps: BuilderStep[],
  cid: string
): StepContext | null {
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]
    if (step.cid === cid) return { step, index, total: steps.length }
    if (!step.branches) continue
    const nested =
      findStepContextByCid(step.branches.yes, cid) ??
      findStepContextByCid(step.branches.no, cid)
    if (nested) return nested
  }
  return null
}

export function updateStepByCid(
  steps: BuilderStep[],
  cid: string,
  updater: (step: BuilderStep) => BuilderStep
): TreeMutation {
  let changed = false
  const next = steps.map((step) => {
    if (step.cid === cid) {
      changed = true
      return updater(step)
    }
    if (!step.branches) return step

    const yes = updateStepByCid(step.branches.yes, cid, updater)
    if (yes.changed) {
      changed = true
      return { ...step, branches: { ...step.branches, yes: yes.steps } }
    }
    const no = updateStepByCid(step.branches.no, cid, updater)
    if (!no.changed) return step
    changed = true
    return { ...step, branches: { ...step.branches, no: no.steps } }
  })
  return { steps: changed ? next : steps, changed }
}

export function insertStep(
  steps: BuilderStep[],
  target: BranchTarget,
  index: number,
  node: BuilderStep
): TreeMutation {
  if (target.kind === "root") {
    const next = [...steps]
    next.splice(Math.max(0, Math.min(index, next.length)), 0, node)
    return { steps: next, changed: true }
  }

  const parent = findStepByCid(steps, target.parentCid)
  if (!parent?.branches) return { steps, changed: false }

  return updateStepByCid(steps, target.parentCid, (parent) => {
    if (!parent.branches) return parent
    const bucket = [...parent.branches[target.branch]]
    bucket.splice(Math.max(0, Math.min(index, bucket.length)), 0, node)
    return {
      ...parent,
      branches: { ...parent.branches, [target.branch]: bucket },
    }
  })
}

export function removeStepByCid(
  steps: BuilderStep[],
  cid: string
): TreeMutation {
  const rootIndex = steps.findIndex((step) => step.cid === cid)
  if (rootIndex >= 0) {
    return {
      steps: steps.filter((_, index) => index !== rootIndex),
      changed: true,
    }
  }

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]
    if (!step.branches) continue
    const yes = removeStepByCid(step.branches.yes, cid)
    if (yes.changed) {
      const next = [...steps]
      next[index] = {
        ...step,
        branches: { ...step.branches, yes: yes.steps },
      }
      return { steps: next, changed: true }
    }
    const no = removeStepByCid(step.branches.no, cid)
    if (no.changed) {
      const next = [...steps]
      next[index] = {
        ...step,
        branches: { ...step.branches, no: no.steps },
      }
      return { steps: next, changed: true }
    }
  }
  return { steps, changed: false }
}

export function moveStepByCid(
  steps: BuilderStep[],
  cid: string,
  direction: -1 | 1
): TreeMutation {
  const index = steps.findIndex((step) => step.cid === cid)
  if (index >= 0) {
    const destination = index + direction
    if (destination < 0 || destination >= steps.length) {
      return { steps, changed: false }
    }
    const next = [...steps]
    ;[next[index], next[destination]] = [next[destination], next[index]]
    return { steps: next, changed: true }
  }

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    const step = steps[stepIndex]
    if (!step.branches) continue
    const yes = moveStepByCid(step.branches.yes, cid, direction)
    if (yes.changed) {
      const next = [...steps]
      next[stepIndex] = {
        ...step,
        branches: { ...step.branches, yes: yes.steps },
      }
      return { steps: next, changed: true }
    }
    const no = moveStepByCid(step.branches.no, cid, direction)
    if (no.changed) {
      const next = [...steps]
      next[stepIndex] = {
        ...step,
        branches: { ...step.branches, no: no.steps },
      }
      return { steps: next, changed: true }
    }
  }
  return { steps, changed: false }
}

interface ApiStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: ApiStep[]; no?: ApiStep[] }
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  return steps.map((step) => ({
    step_type: step.step_type,
    step_config: step.step_config,
    branches: step.branches
      ? {
          yes: toApiSteps(step.branches.yes),
          no: toApiSteps(step.branches.no),
        }
      : undefined,
  }))
}

export interface ServerStepNode {
  id: string
  step_type: string
  step_config: Record<string, unknown>
  branches: { yes: ServerStepNode[]; no: ServerStepNode[] }
}

export function fromServerSteps(
  nodes: ServerStepNode[],
  createCid: () => string
): BuilderStep[] {
  return nodes.map((node) => ({
    cid: createCid(),
    step_type: node.step_type as AutomationStepType,
    step_config: node.step_config ?? {},
    branches:
      node.step_type === "condition"
        ? {
            yes: fromServerSteps(node.branches?.yes ?? [], createCid),
            no: fromServerSteps(node.branches?.no ?? [], createCid),
          }
        : undefined,
  }))
}
