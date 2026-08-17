declare module "bun:test" {
  type Matchers = {
    not: Matchers
    toBe(expected: unknown): void
    toBeInstanceOf(expected: object): void
    toBeTruthy(): void
    toBeUndefined(): void
    toContain(expected: unknown): void
    toEqual(expected: unknown): void
    toHaveLength(expected: number): void
    toHaveProperty(path: string, value?: unknown): void
  }

  export function afterEach(run: () => unknown): void
  export function describe(name: string, run: () => unknown): void
  export function expect(actual: unknown): Matchers
  export const it: {
    (name: string, run: () => unknown): void
    each<T>(values: readonly T[]): (name: string, run: (value: T) => unknown) => void
  }
}
