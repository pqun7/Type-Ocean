// lib/errors.ts
export const errorMap: Record<string, string> = {
    // Common errors
    USER_NOT_FOUND: "User not found",
    TOO_MANY_REQUESTS: "Too many requests, please try again later",
    FAILED_TO_SEND_EMAIL: "Failed to send email",
    
    // Email verification
    EMAIL_ALREADY_VERIFIED: "Email already verified",
    USER_CREATED_BUT_EMAIL_NOT_SENT: "User created but email not sent",

    // Password reset
    INVALID_OR_EXPIRED_TOKEN: "Reset link is invalid or has expired",
    EMAIL_REQUIRED: "Please enter your email",
    SOCIAL_AUTH_ACCOUNT: "Account uses external login",
    PASSWORD_SAME_AS_CURRENT: "The new password must be different from the current password.",

    // Default
    DEFAULT: "Something went wrong, please try again",
  };
  
  export function mapErrorToMessage(errorCode: string): string {
    return errorMap[errorCode] || errorMap.DEFAULT;
  }