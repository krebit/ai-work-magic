declare module "vitest" {
  export { afterEach, describe, expect } from "bun:test"

  export const it: {
    (name: string, run: () => unknown): void
    each<T extends readonly unknown[]>(cases: readonly T[]): (name: string, run: (...values: T) => unknown) => void
    each<T>(cases: readonly T[]): (name: string, run: (value: T) => unknown) => void
  }
}
