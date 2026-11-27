type KycReviewVisibilityRow = {
  aadhaar?: unknown;
  claimedBy?: unknown;
};

const IN_PROGRESS_AADHAAR_STATUSES = new Set(['pending', 'under_review', 'expired']);

export function shouldShowKycReviewRow(
  row: KycReviewVisibilityRow,
  reviewStatus: string,
): boolean {
  const aadhaarStatus = String(row.aadhaar || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const isClaimed = Boolean(row.claimedBy);

  if (reviewStatus === 'all') {
    return /failed|failure|rejected/.test(aadhaarStatus) || isClaimed;
  }

  return !IN_PROGRESS_AADHAAR_STATUSES.has(aadhaarStatus) || isClaimed;
}
