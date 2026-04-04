import { useId } from 'react';
import { TokenVaultInterrupt } from '@auth0/ai/interrupts';
import type { Auth0InterruptionUI } from '@auth0/ai-vercel';

import { TokenVaultConsentPopup } from '@/components/auth0-ai/TokenVault/popup';

type PossibleInterrupt = Auth0InterruptionUI | Record<string, unknown>;

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

export function TokenVaultInterruptHandler({ interrupt, onFinish }: TokenVaultInterruptHandlerProps) {
  const id = useId();
  if (!interrupt || !TokenVaultInterrupt.isInterrupt(interrupt)) {
    return null;
  }

  const connection =
    typeof (interrupt as { connection?: unknown }).connection === 'string'
      ? ((interrupt as { connection?: string }).connection ?? undefined)
      : undefined;
  const description = normalizeTokenVaultInterruptMessage(interrupt.message, connection);

  return (
    <div key={id} className="whitespace-pre-wrap">
      <TokenVaultConsentPopup
        interrupt={interrupt}
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
