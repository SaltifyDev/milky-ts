import type { MilkyFetch, MilkyFetchCreateOptions, MilkyFetchOptions } from 'src/client/fetch'
import type { MilkyClientEndpointNames, MilkyRawEndpoints } from '@/gen/types'
import { createMilkyFetch } from 'src/client/fetch'
import { clientEndpointNames } from '@/gen/types'

function createProxy(fetch: MilkyFetch): any {
  const cachedEndpoints = new Map<keyof MilkyClientEndpointNames, any>()
  return new Proxy(fetch, {
    get(target, prop) {
      if (!Object.hasOwn(clientEndpointNames, prop)) {
        return Reflect.get(target, prop)
      }

      if (cachedEndpoints.has(prop as keyof MilkyClientEndpointNames)) {
        return cachedEndpoints.get(prop as keyof MilkyClientEndpointNames)
      }

      const methodNames = (clientEndpointNames as any)[prop as any]
      const cachedMethods = new Map()
      const methods = new Proxy(Object.create(null), {
        get(_target, key) {
          if (key === 'name') {
            return prop
          }

          if (!Object.hasOwn(methodNames, key)) {
            return void 0
          }

          if (cachedMethods.has(key)) {
            return cachedMethods.get(key)
          }

          const methodName = methodNames[key as any]
          const methodFn = (param: any, options: any) => fetch(methodName, param, options)
          cachedMethods.set(key, methodFn)
          return methodFn
        },
        set() {
          return false
        },
      })

      cachedEndpoints.set(prop as keyof MilkyClientEndpointNames, methods)
      return methods
    },
  })
}

export type MilkyClient = MilkyFetch & {
  [K in keyof MilkyClientEndpointNames]: {
    [M in keyof MilkyClientEndpointNames[K]]:
    MilkyClientEndpointNames[K][M] extends infer K extends keyof MilkyRawEndpoints
      ? (param: Parameters<MilkyRawEndpoints[K]>[0], options?: MilkyFetchOptions) => Promise<ReturnType<MilkyRawEndpoints[K]>> : never
  } & {
    readonly name: K
  } & {}
} & {}

export function createMilkyClient(options: MilkyFetchCreateOptions): MilkyClient {
  const fetch = createMilkyFetch(options)

  return createProxy(fetch)
}
