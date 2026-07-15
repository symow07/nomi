import type { ProductId } from '../core/types/ids.js';

/**
 * Retrieval port. Implementation lands in Week 2; the contract is fixed now
 * because the prompt builder depends on it.
 *
 * THE RULE THIS EXISTS TO ENFORCE (ADR-0001 §5.3): the model never sees the
 * whole catalog. It sees the top ~20 candidates for THIS message. The n8n
 * design inlined the entire catalog into every prompt, which hard-caps a
 * tenant at roughly 100 SKUs — and ingestion (Milestone 2) is precisely the
 * feature that breaks it.
 *
 * Hybrid = trigram (exact-ish, typos, aliases — search_product_by_text already
 * exists in SQL) fused with pgvector cosine (semantic: "something for a gift
 * shop"), combined by Reciprocal Rank Fusion. No external vector DB: pgvector
 * with an HNSW index carries millions of rows.
 */

export type RetrievedProduct = {
  readonly productId: ProductId;
  readonly sku: string;
  readonly name: string;
  readonly category: string | null;
  readonly moq: number;
  /** fused RRF score, 0..1 normalised — NOT a price. Prices come from CatalogRepo. */
  readonly relevance: number;
  readonly matchedVia: 'trigram' | 'semantic' | 'both';
};

export interface Retriever {
  /** Top-k candidates for a free-text query. Tenant-scoped via RLS. */
  byText(query: string, k?: number): Promise<RetrievedProduct[]>;

  /** Vision pipeline: description produced by the image model. */
  byImageDescription(description: string, k?: number): Promise<RetrievedProduct[]>;

  /** Discovery: "products for my gift shop" — semantic-only, wider net. */
  explore(useCase: string, k?: number): Promise<RetrievedProduct[]>;
}

/** Ingestion side: called by the catalog pipeline after upsert. */
export interface EmbeddingIndexer {
  reindexProduct(productId: ProductId): Promise<void>;
  reindexAll(): Promise<{ indexed: number }>;
}
