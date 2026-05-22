export type AiErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "PAYLOAD_TOO_LARGE"
  | "UPSTREAM_ERROR";

export type AiErrorDetail = {
  code: AiErrorCode;
  message: string;
  retryable: boolean;
};

export type AiFallback = {
  overview: string;
  suggestedNextActions: string[];
};

export type AiErrorEnvelope = {
  error: AiErrorDetail;
  fallback: AiFallback | null;
};
