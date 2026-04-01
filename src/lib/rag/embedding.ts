import { embed, embedMany } from 'ai';
import { desc, gt, sql, cosineDistance } from 'drizzle-orm';
import { chunk } from 'llm-chunk';

import { db } from '@/lib/db';
import { embeddings } from '@/lib/db/schema/embeddings';
import { nim, nimEmbeddingModelId } from '@/lib/nim';

const EMBEDDING_DIMENSIONS = 768;
const embeddingModel = nim.embeddingModel(nimEmbeddingModelId);

// Keep vectors aligned with the pgvector schema even if the provider dimension differs.
const normalizeEmbeddingDimensions = (values: number[]) => {
  if (values.length === EMBEDDING_DIMENSIONS) {
    return values;
  }

  if (values.length > EMBEDDING_DIMENSIONS) {
    return values.slice(0, EMBEDDING_DIMENSIONS);
  }

  return [...values, ...Array.from({ length: EMBEDDING_DIMENSIONS - values.length }, () => 0)];
};

export const generateEmbeddings = async (value: string): Promise<Array<{ embedding: number[]; content: string }>> => {
  const chunks = chunk(value);
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: chunks,
  });
  return embeddings.map((e, i) => ({ content: chunks[i], embedding: normalizeEmbeddingDimensions(e) }));
};

export const generateEmbedding = async (value: string): Promise<number[]> => {
  const input = value.replaceAll('\\n', ' ');
  const { embedding } = await embed({
    model: embeddingModel,
    value: input,
  });
  return normalizeEmbeddingDimensions(embedding);
};

export const findRelevantContent = async (userQuery: string, limit = 4) => {
  const userQueryEmbedded = await generateEmbedding(userQuery);
  const similarity = sql<number>`1 - (${cosineDistance(embeddings.embedding, userQueryEmbedded)})`;
  const similarGuides = await db
    .select({ content: embeddings.content, similarity, documentId: embeddings.documentId })
    .from(embeddings)
    .where(gt(similarity, 0.5))
    .orderBy((t: any) => desc(t.similarity))
    .limit(limit);
  return similarGuides;
};
