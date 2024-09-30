import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  index,
  vector,
} from 'drizzle-orm/pg-core';
import { InferModel } from 'drizzle-orm';

export const websites = pgTable('Website', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').notNull(),
  keywords: text('keywords').notNull(),
});

export const webpageEmbeddings = pgTable(
  'WebpageEmbedding',
  {
    id: serial('id').primaryKey(),
    websiteId: integer('websiteId')
      .notNull()
      .references(() => websites.id),
    url: text('url').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(), // Custom vector type
    createdAt: timestamp('createdAt', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    websiteIdIndex: index('WebpageEmbedding_websiteId_idx').on(table.websiteId),
  })
);

export type Website = InferModel<typeof websites>;
export type NewWebsite = InferModel<typeof websites, 'insert'>;

export type WebpageEmbedding = InferModel<typeof webpageEmbeddings>;
export type NewWebpageEmbedding = InferModel<
  typeof webpageEmbeddings,
  'insert'
>;
