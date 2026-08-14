import { prisma } from '../client';
import type { Ctx } from '../capabilities';
import { assertOwnsStore } from './store';

/**
 * The merchant's own profit picture — distinct from
 * getStoreAnalyticsForStaff/getEstoreOverview in dal/store.ts, which are
 * the platform admin's view of a store from the outside. This is what
 * the merchant themselves opens: not just "I sold KES 4,000 today" but
 * "and it cost me KES 2,600 to have that to sell", which is the number
 * that actually answers "am I making money".
 *
 * Cost comes from the costKes snapshotted on each sale/order line at the
 * moment it sold — see PosSaleItem.costKes and StoreOrderItem.costKes —
 * which itself comes from Product.costKes, kept current by
 * recordStockPurchase's moving average (dal/supplier.ts). A line with no
 * cost snapshot (the merchant never recorded what this item cost them)
 * contributes zero to COGS, which would understate cost and overstate
 * profit — so `costTrackedPct` is returned alongside every profit figure
 * to say plainly how much of the picture is actually known.
 */

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export interface ProductProfitLine {
  productId: string;
  name: string;
  unitsSold: number;
  revenueKes: number;
  costKes: number;
  profitKes: number;
  /** Null when nothing sold of this product had a cost on file. */
  marginPct: number | null;
}

export async function getMerchantProfitReport(ctx: Ctx, storeId: string, days = 30) {
  await assertOwnsStore(ctx, storeId, 'store.read');

  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const [orderItems, posItems] = await Promise.all([
    prisma.storeOrderItem.findMany({
      where: {
        order: { storeId, status: { in: ['PAID', 'FULFILLED'] }, createdAt: { gte: since } },
      },
      select: {
        quantity: true, unitPriceKes: true, costKes: true,
        product: { select: { id: true, name: true } },
        order: { select: { paidAt: true, createdAt: true } },
      },
    }),
    prisma.posSaleItem.findMany({
      where: {
        sale: { storeId, status: 'COMPLETED', soldAt: { gte: since } },
      },
      select: {
        quantity: true, unitPriceKes: true, costKes: true, discountKes: true,
        product: { select: { id: true, name: true } },
        sale: { select: { soldAt: true } },
      },
    }),
  ]);

  type Line = {
    date: Date; productId: string; name: string;
    unitsSold: number; revenueKes: number; costKes: number | null;
  };
  const lines: Line[] = [
    ...orderItems.map((i) => ({
      date: i.order.paidAt ?? i.order.createdAt,
      productId: i.product.id, name: i.product.name,
      unitsSold: i.quantity,
      revenueKes: i.quantity * Number(i.unitPriceKes),
      costKes: i.costKes !== null ? i.quantity * Number(i.costKes) : null,
    })),
    ...posItems.map((i) => ({
      date: i.sale.soldAt,
      productId: i.product.id, name: i.product.name,
      unitsSold: i.quantity,
      revenueKes: i.quantity * Number(i.unitPriceKes) - Number(i.discountKes ?? 0),
      costKes: i.costKes !== null ? i.quantity * Number(i.costKes) : null,
    })),
  ];

  const totalLines = lines.length;
  const costedLines = lines.filter((l) => l.costKes !== null).length;
  const costTrackedPct = totalLines > 0 ? Math.round((costedLines / totalLines) * 100) : 0;

  // Daily trend — revenue, cost and profit side by side, one bucket per
  // day even for days with nothing in them so a chart's x-axis holds still.
  const byDay = new Map<string, { revenueKes: number; costKes: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    byDay.set(dayKey(d), { revenueKes: 0, costKes: 0 });
  }
  for (const l of lines) {
    const key = dayKey(l.date);
    const bucket = byDay.get(key);
    if (!bucket) continue;
    bucket.revenueKes += l.revenueKes;
    bucket.costKes += l.costKes ?? 0;
  }
  const dailyProfit = [...byDay.entries()].map(([date, b]) => ({
    date, revenueKes: b.revenueKes, costKes: b.costKes, profitKes: b.revenueKes - b.costKes,
  }));

  const totalRevenueKes = dailyProfit.reduce((n, d) => n + d.revenueKes, 0);
  const totalCostKes = dailyProfit.reduce((n, d) => n + d.costKes, 0);
  const totalProfitKes = totalRevenueKes - totalCostKes;
  const grossMarginPct = totalRevenueKes > 0 ? Math.round((totalProfitKes / totalRevenueKes) * 1000) / 10 : null;

  // Per-product rollup — best and least profitable, not just best-selling.
  const byProduct = new Map<string, ProductProfitLine>();
  for (const l of lines) {
    const cur = byProduct.get(l.productId) ?? {
      productId: l.productId, name: l.name, unitsSold: 0, revenueKes: 0, costKes: 0, profitKes: 0, marginPct: null,
    };
    cur.unitsSold += l.unitsSold;
    cur.revenueKes += l.revenueKes;
    cur.costKes += l.costKes ?? 0;
    byProduct.set(l.productId, cur);
  }
  const products = [...byProduct.values()].map((p) => ({
    ...p,
    profitKes: p.revenueKes - p.costKes,
    marginPct: p.revenueKes > 0 ? Math.round(((p.revenueKes - p.costKes) / p.revenueKes) * 1000) / 10 : null,
  }));

  const bestSellers = [...products].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 10);
  const mostProfitable = [...products].sort((a, b) => b.profitKes - a.profitKes).slice(0, 10);
  const leastProfitable = [...products]
    .filter((p) => p.unitsSold > 0)
    .sort((a, b) => a.profitKes - b.profitKes)
    .slice(0, 5);

  return {
    windowDays: days,
    totalRevenueKes, totalCostKes, totalProfitKes, grossMarginPct, costTrackedPct,
    dailyProfit, bestSellers, mostProfitable, leastProfitable,
  };
}
