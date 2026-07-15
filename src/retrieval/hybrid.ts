import { sql } from 'kysely';
import type { Tx } from '../db/client.js';
import type { BusinessId, ProductId } from '../core/types/ids.js';
import type { RetrievedProduct, Retriever } from './ports.js';

/**
 * Hybrid retriever over migrations/0007's retrieve_products().
 *
 * Trigram works today with zero external dependencies. The embedding provider
 * is a port: when a key exists (Voyage is the Anthropic-adjacent default), the
 * same SQL function fuses both rankings with RRF. Until then embed() returns
 * null and retrieval is trigram-only — degraded recall on vague queries, never
 * an error.
 */

export interface EmbeddingProvider {
  /** null = provider not configured; retrieval degrades gracefully. */
  embed(text: string): Promise<number[] | null>;
}

export const noEmbeddings: EmbeddingProvider = { embed: async () => null };

type Row = {
  product_id: string;
  sku: string;
  name: string;
  category: string | null;
  moq: number;
  relevance: number;
  matched_via: string;
};

export function hybridRetriever(
  tx: Tx,
  businessId: BusinessId,
  embeddings: EmbeddingProvider = noEmbeddings,
): Retriever {
  async function query(text: string, k: number, semanticOnly = false): Promise<RetrievedProduct[]> {
    const vec = await embeddings.embed(text);
    const literal = vec ? `[${vec.join(',')}]` : null;

    const res = await sql<Row>`
      select * from retrieve_products(
        ${businessId}::uuid,
        ${semanticOnly ? '' : text},
        ${literal},
        ${k}
      )`.execute(tx);

    return res.rows.map((r) => ({
      productId: r.product_id as ProductId,
      sku: r.sku,
      name: r.name,
      category: r.category,
      moq: r.moq,
      relevance: Number(r.relevance),
      matchedVia: (r.matched_via === 'both' ? 'both'
        : r.matched_via === 'semantic' ? 'semantic' : 'trigram'),
    }));
  }

  return {
    byText: (text, k = 20) => query(text, k),
    byImageDescription: (description, k = 20) => query(description, k),
    // Discovery queries lean on semantics; with no embedding provider this
    // falls back to trigram over the use-case words — weak but non-empty.
    explore: (useCase, k = 30) => query(useCase, k),
  };
}
