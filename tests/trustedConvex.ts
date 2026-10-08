/**
 * convex-test, called as a trusted device.
 *
 * Every public function refuses a caller that is not on the trusted-device
 * list (convex/lib/guarded.ts). The tests are about what the functions do once
 * they are reached, so each test deployment gets one trusted device and calls
 * as it. The device check itself is tested in tests/devices.test.ts.
 */
import { convexTest as untrusted } from 'convex-test'

const CALLS = new Set(['query', 'mutation', 'action', 'fetch'])

export function convexTest(...args: Parameters<typeof untrusted>): ReturnType<typeof untrusted> {
  const t = untrusted(...args)
  let as: ReturnType<typeof t.withIdentity> | null = null
  const trusted = async () => {
    if (!as) {
      const id = await t.run((ctx) => ctx.db.insert('trustedDevices', {
        name: 'Test counter', app: 'tests', kind: 'device', createdAt: 1, lastSeenAt: 1,
      }))
      as = t.withIdentity({ subject: String(id) })
    }
    return as
  }
  return new Proxy(t, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && CALLS.has(prop)) {
        return async (...a: unknown[]) => ((await trusted()) as any)[prop](...a)
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}
