export const CURRENCY = 'USD' as const;

export function isMoney(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
}

export function sumMoney(values: number[]): number {
  return values.reduce((cents, value) => cents + Math.round(value * 100), 0) / 100;
}
