const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;

export function selectRetryRecipients(
  previousAttempt: {
    status: string;
    recipients: string[];
    failedRecipients?: string[];
  } | null,
  configuredRecipients: string[],
): string[] {
  if (!previousAttempt) return configuredRecipients;

  if (previousAttempt.status === 'failed' && !previousAttempt.failedRecipients?.length) {
    return previousAttempt.recipients.length > 0
      ? previousAttempt.recipients
      : configuredRecipients;
  }

  const configured = new Set(configuredRecipients);
  return Array.from(new Set((previousAttempt.failedRecipients || []).filter((recipient) => configured.has(recipient))));
}

export async function sendToRecipientsIndividually(
  recipients: string[],
  send: (recipient: string) => Promise<void>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<{
  sentRecipients: string[];
  failures: Array<{ recipient: string; error: string }>;
}> {
  const sentRecipients: string[] = [];
  const failures: Array<{ recipient: string; error: string }> = [];

  for (const recipient of recipients) {
    let lastError: string | undefined;

    for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
      try {
        await send(recipient);
        lastError = undefined;
        break;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : String(error);
        if (retry < MAX_RETRIES) {
          await wait(INITIAL_RETRY_DELAY_MS * (2 ** retry));
        }
      }
    }

    if (lastError === undefined) {
      sentRecipients.push(recipient);
    } else {
      failures.push({ recipient, error: lastError });
    }
  }

  return { sentRecipients, failures };
}
