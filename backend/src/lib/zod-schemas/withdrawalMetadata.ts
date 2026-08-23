export type WithdrawalMetadata = {
  version: "v1";
  type: "withdrawal";
  details: {
    type: "wise";
    batchName?: string;
    batchGroupId?: string;
    status?: string;
  };
};

export type WithdrawalRefundMetadata = {
  version: "v1";
  type: "withdrawal_refund";
  details: {
    type: "wise";
    status: string;
    transferId?: string;
    batchGroupId?: string;
  };
};

export type WithdrawalCancellationMetadata = {
  version: "v1";
  type: "withdrawal_cancellation";
};

// Admin "return to balance" on a still-queued (requested) withdrawal.
export type WithdrawalReturnMetadata = {
  version: "v1";
  type: "withdrawal_return";
  details: {
    returnedBy: string;
    reason?: string;
  };
};
