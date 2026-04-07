'use client';

import { useState, useEffect } from 'react';

import UserInfoCard from './user-info-card';
import ConnectedAccountsCard from './connected-accounts-card';
import { ConnectedAccount, fetchConnectedAccounts } from '@/lib/actions/profile';

interface KeyValueMap {
  [key: string]: any;
}

type WorkspaceContext = {
  organizationId?: string | null;
  organizationName?: string | null;
  role?: string | null;
  avatarUrl?: string | null;
};

type AccountContextResponse = {
  workspace?: WorkspaceContext;
};

export default function ProfileContent({ user }: { user: KeyValueMap }) {
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceContext | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfileData();
  }, []);

  const loadProfileData = async () => {
    try {
      const [accounts, contextResponse] = await Promise.all([
        fetchConnectedAccounts(),
        fetch('/api/account/context', {
          method: 'GET',
          credentials: 'include',
        }),
      ]);

      console.log('Fetched Linked Accounts:', accounts);
      setConnectedAccounts(accounts);

      if (contextResponse.ok) {
        const payload = (await contextResponse.json()) as AccountContextResponse;
        setWorkspace(payload.workspace ?? null);
      }
    } catch (error) {
      console.error('Error fetching linked accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-2 gap-6">
      {/* User Info Card */}
      <div className="lg:col-span-1">
        <UserInfoCard
          user={{
            ...user,
            picture: workspace?.avatarUrl ?? user.picture,
          }}
          workspace={workspace}
        />
      </div>

      {/* Linked Accounts Card */}
      <div className="lg:col-span-1">
        <ConnectedAccountsCard
          connectedAccounts={connectedAccounts}
          loading={loading}
          onAccountDeleted={loadProfileData}
        />
      </div>
    </div>
  );
}
