import { type AmmPool, computeConstantProductSwap, computeMultiHopperFeeShare } from '../math/amm.js';

export interface MultiHopStep {
  readonly poolId: string;
  readonly dex: string;
  readonly inputMint: string;
  readonly outputMint: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly priceImpactBps: number;
}

export interface MultiHopRouteQuote {
  readonly inputMint: string;
  readonly outputMint: string;
  readonly amountIn: bigint;
  readonly grossAmountOut: bigint;
  readonly protocolFeeAmount: bigint;
  readonly integratorShareAmount: bigint;
  readonly netAmountOut: bigint;
  readonly hops: readonly MultiHopStep[];
}

export function findBestMultiHopRoute(
  pools: readonly AmmPool[],
  inputMint: string,
  outputMint: string,
  amountIn: bigint,
  maxHops = 3,
  protocolFeeBps = 50
): MultiHopRouteQuote | null {
  if (inputMint === outputMint) {
    throw new Error('inputMint and outputMint must differ');
  }
  if (amountIn <= 0n) {
    throw new Error('amountIn must be greater than 0');
  }

  const adjacency = new Map<string, AmmPool[]>();
  const sortedPools = [...pools].sort((a, b) => a.id.localeCompare(b.id));
  for (const pool of sortedPools) {
    if (pool.reserveA <= 0n || pool.reserveB <= 0n) continue;
    const listA = adjacency.get(pool.tokenA) ?? [];
    listA.push(pool);
    adjacency.set(pool.tokenA, listA);

    const listB = adjacency.get(pool.tokenB) ?? [];
    listB.push(pool);
    adjacency.set(pool.tokenB, listB);
  }

  let bestHops: MultiHopStep[] | null = null;
  let bestGrossOut = 0n;

  function dfs(currentMint: string, currentAmount: bigint, visited: Set<string>, hops: MultiHopStep[]): void {
    if (currentMint === outputMint) {
      if (
        bestHops === null ||
        currentAmount > bestGrossOut ||
        (currentAmount === bestGrossOut && hops.length < bestHops.length)
      ) {
        bestGrossOut = currentAmount;
        bestHops = [...hops];
      }
      return;
    }
    if (hops.length >= maxHops) return;

    for (const pool of adjacency.get(currentMint) ?? []) {
      const nextMint = pool.tokenA === currentMint ? pool.tokenB : pool.tokenA;
      if (visited.has(nextMint)) continue;
      let step;
      try {
        step = computeConstantProductSwap(pool, currentMint, currentAmount);
      } catch {
        continue;
      }
      visited.add(nextMint);
      hops.push({
        poolId: pool.id,
        dex: pool.dex,
        inputMint: currentMint,
        outputMint: nextMint,
        amountIn: currentAmount,
        amountOut: step.amountOut,
        priceImpactBps: step.priceImpactBps,
      });
      dfs(nextMint, step.amountOut, visited, hops);
      hops.pop();
      visited.delete(nextMint);
    }
  }

  dfs(inputMint, amountIn, new Set([inputMint]), []);
  if (!bestHops || bestGrossOut <= 0n) return null;

  const { protocolFeeAmount, integratorShareAmount, netAmountOut } = computeMultiHopperFeeShare(
    bestGrossOut,
    protocolFeeBps
  );

  return {
    inputMint,
    outputMint,
    amountIn,
    grossAmountOut: bestGrossOut,
    protocolFeeAmount,
    integratorShareAmount,
    netAmountOut,
    hops: bestHops,
  };
}
