export type FlowRoute = 'unset' | 'handover' | 'rack' | 'order' | 'fabrication' | 'mixed'
export type FlowTasks = Record<string, boolean>

export function flowStage(kind: string, route: FlowRoute, tasks: FlowTasks): string {
  if (kind === 'payment') return 'complete'
  if (kind === 'grn') return tasks.purchaseLinked ? 'complete' : 'bill-to-come'
  if (kind === 'purchase') return tasks.goodsReceived ? 'complete' : tasks.goodsOrdered ? 'goods-due' : 'ordering'
  if (kind === 'receipt' && route === 'unset') return 'routing'
  if (route === 'unset') return 'routing'
  if (tasks.delivered) return 'complete'
  if (tasks.outForDelivery) return 'delivery'
  if (route === 'handover') return 'ready-delivery'
  if (route === 'order' && !tasks.ordered) return 'ordering'
  if ((route === 'fabrication' || route === 'mixed') && !tasks.mechanicSent) return 'mechanic'
  if ((route === 'fabrication' || route === 'mixed') && !tasks.measurementsReturned) return 'mechanic'
  if ((route === 'fabrication' || route === 'mixed') && !tasks.materialsHanded) return 'materials'
  if ((route === 'fabrication' || route === 'mixed') && !tasks.made) return 'workshop'
  if ((route === 'rack' || route === 'order' || route === 'mixed') && !tasks.picked) return 'picking'
  return 'ready-delivery'
}

export function requiredTasksDone(route: FlowRoute, tasks: FlowTasks): boolean {
  if (route === 'unset') return false
  if (route === 'order' && !tasks.ordered) return false
  if ((route === 'rack' || route === 'order' || route === 'mixed') && !tasks.picked) return false
  if ((route === 'fabrication' || route === 'mixed') &&
      (!tasks.mechanicSent || !tasks.measurementsReturned || !tasks.materialsHanded || !tasks.made)) return false
  return true
}
