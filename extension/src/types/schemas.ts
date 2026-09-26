import { z } from 'zod';

const shortText = z.string().trim().min(1).max(500);
const rewardsSchema = z.record(shortText, shortText).refine(
  (value) => Object.keys(value).length > 0 && Object.keys(value).length <= 30,
  'Expected between one and 30 reward categories',
);

export const cartItemsSchema = z.array(z.object({
  name: shortText,
  price: z.string().max(100).optional(),
  quantity: z.number().int().positive().max(10_000).optional(),
  description: z.string().max(2000).optional(),
})).max(200);

export const creditCardSchema = z.object({
  id: shortText.optional(),
  name: shortText,
  annualFee: z.number().finite().nonnegative(),
  rewards: rewardsSchema,
  description: z.string().max(10_000),
  isActive: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const creditCardsSchema = z.array(creditCardSchema).max(1000);

export const databaseCardSchema = z.object({
  id: shortText,
  name: shortText,
  annual_fee: z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)])
    .transform(Number).pipe(z.number().finite().nonnegative()),
  rewards: rewardsSchema,
  description: z.string().max(10_000).nullable(),
  is_active: z.boolean(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
}).transform((card) => ({
  id: card.id,
  name: card.name,
  annualFee: card.annual_fee,
  rewards: card.rewards,
  description: card.description ?? '',
  isActive: card.is_active,
  createdAt: card.created_at ?? undefined,
  updatedAt: card.updated_at ?? undefined,
}));

export const recommendationSchema = z.object({
  card: shortText,
  rewards: rewardsSchema,
  merchant: z.string().min(1).max(253),
  category: shortText,
  reasoning: z.string().max(4000).optional(),
});
