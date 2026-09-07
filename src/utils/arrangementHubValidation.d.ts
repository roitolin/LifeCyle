export type ParsedQuoteLine = {
  label: string;
  unitPrice: number;
  quantity: number;
};

export function parseItemizedQuoteLines(value: string): ParsedQuoteLine[];
export function validateMilestoneSubmission(input: {
  payerName?: string | null;
  referenceNumber?: string | null;
  proofImageUrl?: string | null;
}): string | null;
