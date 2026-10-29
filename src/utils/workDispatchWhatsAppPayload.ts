export type WorkDispatchWhatsAppPayloadInput = {
  taskId: string;
  stage: 'preferred' | 'area_rule' | 'all';
  title: string;
  category: string;
  locationLabel: string;
};

export function buildWorkDispatchWhatsAppPayload(
  input: WorkDispatchWhatsAppPayloadInput,
  recipientPhone: string,
  partnerUid: string,
) {
  return {
    eventKey: 'TASK_NEARBY',
    recipientPhone,
    payload: {
      taskTitle: input.title,
      categoryLabel: input.category,
      locationLabel: input.locationLabel,
      taskId: input.taskId,
      workId: input.taskId,
      buttonUrlSuffix: input.taskId,
      dispatchStage: input.stage,
    },
    idempotencyKey: `book_now_offer:${input.taskId}:${partnerUid}:${input.stage}`,
  };
}
