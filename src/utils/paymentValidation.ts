export type PaymentSubmissionInput = {
  senderName: string;
  gcashName: string;
  gcashNumber: string;
  referenceNumber: string;
  proofImageUrl: string | null;
};

export type ValidatedPaymentSubmission = {
  senderName: string;
  gcashName: string;
  gcashNumber: string;
  referenceNumber: string;
  proofImageUrl: string;
};

export function normalizePaymentReference(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizePhilippineMobileNumber(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length === 12) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

export function validatePaymentSubmission(
  input: PaymentSubmissionInput
): { value: ValidatedPaymentSubmission | null; message: string | null } {
  const senderName = input.senderName.trim();
  const gcashName = input.gcashName.trim();
  const gcashNumber = normalizePhilippineMobileNumber(input.gcashNumber);
  const referenceNumber = normalizePaymentReference(input.referenceNumber);
  const proofImageUrl = input.proofImageUrl?.trim() || '';

  if (!senderName || !gcashName || !gcashNumber || !referenceNumber) {
    return {
      value: null,
      message: 'Enter the sender name, GCash account name, mobile number, and transaction reference.',
    };
  }
  if (!/^09\d{9}$/.test(gcashNumber)) {
    return {
      value: null,
      message: 'Enter a valid Philippine mobile number, such as 09XX XXX XXXX.',
    };
  }
  if (!/^[A-Z0-9]{6,32}$/.test(referenceNumber)) {
    return {
      value: null,
      message: 'Enter the 6–32 character transaction reference shown on the payment receipt.',
    };
  }
  if (!proofImageUrl) {
    return {
      value: null,
      message: 'Attach a screenshot or photo showing the completed payment.',
    };
  }

  return {
    value: { senderName, gcashName, gcashNumber, referenceNumber, proofImageUrl },
    message: null,
  };
}

export function paymentSubmissionErrorMessage(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  const message = String(candidate?.message || '');
  if (candidate?.code === '23505' || message.toLowerCase().includes('payment reference')) {
    return 'That transaction reference was already submitted. Check the receipt or contact support if this is unexpected.';
  }
  return message || 'Unable to submit the payment details.';
}
