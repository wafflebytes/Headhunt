import { useId } from 'react';
import { TokenVaultInterrupt } from '@auth0/ai/interrupts';
import type { Auth0InterruptionUI } from '@auth0/ai-vercel';

import { TokenVaultConsentPopup } from '@/components/auth0-ai/TokenVault/popup';

type PossibleInterrupt = Auth0InterruptionUI | Record<string, unknown>;

type TokenVaultInterruptLike = {
  connection: string;
  requiredScopes: string[];
  authorizationParams?: Record<string, string>;
  resume?: () => void;
  message?: string;
};

interface TokenVaultInterruptHandlerProps {
  interrupt: PossibleInterrupt | undefined | null;
  onFinish?: () => void;
}

function normalizeTokenVaultInterruptMessage(message: string, connection?: string): string {
  const connectionLabel = connection?.trim() || 'this connection';

  if (/not supported jwt type in subject token/i.test(message)) {
    return `Authorization failed for ${connectionLabel}. The subject token used for access-token exchange is not supported by the tenant. Reconnect and retry, or switch this provider to refresh-token exchange mode.`;
  }

  if (
    /cannot read properties of undefined \(reading ['\"]access_token['\"]\)/i.test(message) ||
    /invalid_request.*access_token/i.test(message)
  ) {
    return `Authorization failed for ${connectionLabel}. Auth0 could not finish provider token exchange for this account. Reconnect the account and retry.`;
  }

  return message;
}

function isTokenVaultInterruptLike(interrupt: PossibleInterrupt): interrupt is TokenVaultInterruptLike {
  if (TokenVaultInterrupt.isInterrupt(interrupt)) {
    return true;
  }

  if (!interrupt || typeof interrupt !== 'object') {
    return false;
  }

  const candidate = interrupt as Partial<TokenVaultInterruptLike>;
  if (typeof candidate.connection !== 'string' || candidate.connection.trim().length === 0) {
    return false;
  }

  if (!Array.isArray(candidate.requiredScopes)) {
    return false;
  }

  return candidate.requiredScopes.every((scope) => typeof scope === 'string');
}

export function TokenVaultInterruptHandler({ interrupt, onFinish }: TokenVaultInterruptHandlerProps) {
  const id = useId();
  if (!interrupt || !isTokenVaultInterruptLike(interrupt)) {
    return null;
  }

  const tokenVaultInterrupt = interrupt as TokenVaultInterruptLike;

  const connection =
    typeof tokenVaultInterrupt.connection === 'string'
      ? tokenVaultInterrupt.connection
      : undefined;
  const message = typeof tokenVaultInterrupt.message === 'string'
    ? tokenVaultInterrupt.message
    : `Authorization required to access the Token Vault: ${connection ?? 'this connection'}`;
  const description = normalizeTokenVaultInterruptMessage(message, connection);

  return (
    <div key={id} className="whitespace-pre-wrap">
      <TokenVaultConsentPopup
        interrupt={tokenVaultInterrupt}
        connectWidget={{
          title: 'Authorization Required.',
          description,
          action: { label: 'Authorize' },
        }}
        onFinish={onFinish}
      />
    </div>
  );
}
