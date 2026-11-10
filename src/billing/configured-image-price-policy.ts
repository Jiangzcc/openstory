import { microsToUsd, usdToMicros, ZERO_MICROS } from './money';

export function imageUnitPriceFitsWallet(unitPriceUsd: number): boolean {
  const unitMicros = usdToMicros(unitPriceUsd);
  return (
    Number.isSafeInteger(unitMicros) &&
    unitMicros >= ZERO_MICROS &&
    microsToUsd(unitMicros) === unitPriceUsd
  );
}
