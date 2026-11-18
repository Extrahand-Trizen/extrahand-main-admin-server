export async function sendToRecipientsIndividually(
  recipients: string[],
  send: (recipient: string) => Promise<void>,
): Promise<{
  sentRecipients: string[];
  failures: Array<{ recipient: string; error: string }>;
}> {
  const outcomes = await Promise.all(
    recipients.map(async (recipient) => {
      try {
        await send(recipient);
        return { recipient, error: undefined };
      } catch (error: unknown) {
        return {
          recipient,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  return {
    sentRecipients: outcomes.filter((outcome) => outcome.error === undefined).map(({ recipient }) => recipient),
    failures: outcomes.flatMap((outcome) => outcome.error === undefined
      ? []
      : [{ recipient: outcome.recipient, error: outcome.error }]),
  };
}
