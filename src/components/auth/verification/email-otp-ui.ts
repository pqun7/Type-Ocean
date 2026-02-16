export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  if (local.length <= 2) return `${local[0] || "*"}*@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

export function emailOtpErrorToMessage(code: string): string {
  switch (code) {
    case "NOT_AUTHENTICATED":
      return "Please sign in again.";
    case "TOO_MANY_REQUESTS":
      return "Too many requests. Please try again later.";
    case "OTP_COOLDOWN":
      return "Please wait before requesting a new code.";
    case "NO_ACTIVE_OTP":
      return "No active code. Please request a new code.";
    case "OTP_EXPIRED":
      return "The code expired. Please start the email change again.";
    case "TOO_MANY_ATTEMPTS":
      return "Too many attempts. Please start the email change again.";
    case "EMAIL_ALREADY_IN_USE":
      return "This email is already in use.";
    case "INVALID_CODE":
      return "Invalid code. Please try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}
