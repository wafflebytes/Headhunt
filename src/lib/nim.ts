import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const nimApiKey = process.env.NIM_API_KEY ?? process.env.NVIDIA_NIM_API_KEY;
const nimBaseURL = process.env.NVIDIA_NIM_BASE_URL ?? process.env.NIM_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';

export const nim = createOpenAICompatible({
  name: 'nvidia-nim',
  baseURL: nimBaseURL,
  headers: {
    Authorization: `Bearer ${nimApiKey ?? ''}`,
  },
});

export const nimChatModelId =
  process.env.NVIDIA_NIM_CHAT_MODEL ?? process.env.NIM_CHAT_MODEL ?? 'moonshotai/kimi-k2-instruct';
export const nimEmbeddingModelId =
  process.env.NVIDIA_NIM_EMBEDDING_MODEL ?? process.env.NIM_EMBEDDING_MODEL ?? 'nvidia/nv-embedqa-e5-v5';
