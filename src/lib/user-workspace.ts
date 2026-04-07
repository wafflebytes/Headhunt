import { eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema/organizations';
import { userWorkspaces } from '@/lib/db/schema/user-workspaces';

export type UserWorkspaceContext = {
  userId: string;
  organizationId: string | null;
  organizationName: string | null;
  role: string | null;
  avatarUrl: string | null;
};

const normalizeOptionalString = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export async function getUserWorkspaceContext(userId: string): Promise<UserWorkspaceContext | null> {
  const [workspace] = await db
    .select({
      userId: userWorkspaces.userId,
      organizationId: userWorkspaces.organizationId,
      role: userWorkspaces.role,
      avatarUrl: userWorkspaces.avatarUrl,
    })
    .from(userWorkspaces)
    .where(eq(userWorkspaces.userId, userId))
    .limit(1);

  if (!workspace) {
    return null;
  }

  const organizationName = workspace.organizationId
    ? (
        await db
          .select({
            name: organizations.name,
          })
          .from(organizations)
          .where(inArray(organizations.id, [workspace.organizationId]))
          .limit(1)
      )[0]?.name ?? null
    : null;

  return {
    userId: workspace.userId,
    organizationId: workspace.organizationId,
    organizationName,
    role: workspace.role,
    avatarUrl: workspace.avatarUrl,
  };
}

export async function upsertUserWorkspaceContext(input: {
  userId: string;
  organizationId?: string | null;
  role?: string | null;
  avatarUrl?: string | null;
}) {
  const normalizedOrganizationId =
    input.organizationId === undefined ? undefined : normalizeOptionalString(input.organizationId);
  const normalizedRole = input.role === undefined ? undefined : normalizeOptionalString(input.role);
  const normalizedAvatarUrl = input.avatarUrl === undefined ? undefined : normalizeOptionalString(input.avatarUrl);

  const now = new Date();

  const insertValues = {
    userId: input.userId,
    organizationId: normalizedOrganizationId ?? null,
    role: normalizedRole ?? null,
    avatarUrl: normalizedAvatarUrl ?? null,
    updatedAt: now,
  };

  const setValues: Partial<typeof insertValues> = {
    updatedAt: now,
  };

  if (normalizedOrganizationId !== undefined) {
    setValues.organizationId = normalizedOrganizationId;
  }

  if (normalizedRole !== undefined) {
    setValues.role = normalizedRole;
  }

  if (normalizedAvatarUrl !== undefined) {
    setValues.avatarUrl = normalizedAvatarUrl;
  }

  await db.insert(userWorkspaces).values(insertValues).onConflictDoUpdate({
    target: userWorkspaces.userId,
    set: setValues,
  });
}

export async function resolveUserOrganizationId(params: {
  userId: string;
  explicitOrganizationId?: string | null;
  createIfMissing?: boolean;
}): Promise<string | null> {
  const explicitOrganizationId = normalizeOptionalString(params.explicitOrganizationId ?? null);

  if (explicitOrganizationId) {
    const [explicitOrganization] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(inArray(organizations.id, [explicitOrganizationId]))
      .limit(1);

    if (explicitOrganization?.id) {
      await upsertUserWorkspaceContext({
        userId: params.userId,
        organizationId: explicitOrganization.id,
      });

      return explicitOrganization.id;
    }
  }

  const workspace = await getUserWorkspaceContext(params.userId);
  if (workspace?.organizationId) {
    return workspace.organizationId;
  }

  if (!params.createIfMissing) {
    return null;
  }

  const [createdOrganization] = await db
    .insert(organizations)
    .values({
      name: 'Headhunt Demo Organization',
    })
    .returning({ id: organizations.id });

  if (!createdOrganization?.id) {
    return null;
  }

  await upsertUserWorkspaceContext({
    userId: params.userId,
    organizationId: createdOrganization.id,
  });

  return createdOrganization.id;
}
