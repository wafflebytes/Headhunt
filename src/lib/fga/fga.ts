import { buildOpenFgaClient } from '@auth0/ai';

export const fgaClient = buildOpenFgaClient();

const asUserObject = (userId: string) => `user:${userId}`;
const asDocObject = (documentId: string) => `doc:${documentId}`;
const asCandidateObject = (candidateId: string) => `candidate:${candidateId}`;

type CandidateRelation = 'owner' | 'viewer';

export const addRelation = async (userEmail: string, documentId: string, relation = 'owner') =>
  fgaClient.write({
    writes: [{ user: asUserObject(userEmail), relation, object: asDocObject(documentId) }],
  });

export const deleteRelation = async (userEmail: string, documentId: string, relation = 'owner') =>
  fgaClient.write({
    deletes: [{ user: asUserObject(userEmail), relation, object: asDocObject(documentId) }],
  });

export async function checkRelation(userId: string, relation: string, object: string): Promise<boolean> {
  try {
    const { allowed } = await fgaClient.check({
      user: asUserObject(userId),
      relation,
      object,
    });

    return Boolean(allowed);
  } catch (error) {
    console.error('FGA check failed', {
      userId,
      relation,
      object,
      error,
    });
    return false;
  }
}

export const addCandidateRelation = async (userId: string, candidateId: string, relation: CandidateRelation = 'owner') =>
  fgaClient.write({
    writes: [{ user: asUserObject(userId), relation, object: asCandidateObject(candidateId) }],
  });

export const deleteCandidateRelation = async (
  userId: string,
  candidateId: string,
  relation: CandidateRelation = 'owner',
) =>
  fgaClient.write({
    deletes: [{ user: asUserObject(userId), relation, object: asCandidateObject(candidateId) }],
  });

export const canViewCandidate = async (userId: string, candidateId: string) =>
  checkRelation(userId, 'can_view', asCandidateObject(candidateId));
