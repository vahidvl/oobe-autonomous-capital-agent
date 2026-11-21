export const AMM_BPS_DENOMINATOR = 10_000n;

export interface AmmPool {
  readonly id: string;
  readonly dex: string;
  readonly tokenA: string;
  readonly tokenB: string;
  readonly reserveA: bigint;
  readonly reserveB: bigint;
  readonly feeBps: number;
}

export interface AmmSwapResult {
  readonly amountOut: bigint;
  readonly feeAmount: bigint;
  readonly priceImpactBps: number;
}

/**
 * Deterministic constant-product (x * y = k) swap math with exact bigint arithmetic.
 */
export function computeConstantProductSwap(
  pool: AmmPool,
  inputMint: string,
  amountIn: bigint
): AmmSwapResult {
  if (amountIn <= 0n) {
    throw new Error('amountIn must be greater than 0');
  }
  if (pool.feeBps < 0 || pool.feeBps >= 10_000) {
    throw new Error(`Invalid pool feeBps: ${pool.feeBps}`);
  }

  let reserveIn: bigint;
  let reserveOut: bigint;
  if (inputMint === pool.tokenA) {
    reserveIn = pool.reserveA;
    reserveOut = pool.reserveB;
  } else if (inputMint === pool.tokenB) {
    reserveIn = pool.reserveB;
    reserveOut = pool.reserveA;
  } else {
    throw new Error(`Mint ${inputMint} is not part of pool ${pool.id}`);
  }

  if (reserveIn <= 0n || reserveOut <= 0n) {
    throw new Error(`Pool ${pool.id} has insufficient liquidity`);
  }

  const feeAmount = (amountIn * BigInt(pool.feeBps)) / AMM_BPS_DENOMINATOR;
  const amountInAfterFee = amountIn - feeAmount;
  const amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);
  if (amountOut <= 0n) {
    throw new Error(`Swap output is zero for pool ${pool.id}`);
  }

  const spotOut = (amountInAfterFee * reserveOut) / reserveIn;
  let priceImpactBps = 0;
  if (spotOut > 0n && spotOut > amountOut) {
    priceImpactBps = Number(((spotOut - amountOut) * AMM_BPS_DENOMINATOR) / spotOut);
  }

  return { amountOut, feeAmount, priceImpactBps };
}

export function computeMultiHopperFeeShare(
  grossAmountOut: bigint,
  protocolFeeBps = 50
): { protocolFeeAmount: bigint; integratorShareAmount: bigint; netAmountOut: bigint } {
  const protocolFeeAmount = (grossAmountOut * BigInt(protocolFeeBps)) / AMM_BPS_DENOMINATOR;
  const integratorShareAmount = protocolFeeAmount / 2n;
  return {
    protocolFeeAmount,
    integratorShareAmount,
    netAmountOut: grossAmountOut - protocolFeeAmount,
  };
}
