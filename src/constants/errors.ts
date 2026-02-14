// constants/errors.ts
export const errorMap: Record<string, string> = {
  // Authentication errors
  InvalidCredentials: "Invalid credentials, please try again",
  OAuthAccountNotLinked: "Account not linked, please use the original sign-in method",
  AccessDenied: "Access denied, you don't have the necessary permissions",
  AdapterError: "Database error, please try again later",
  Verification: "Verification link is invalid or has expired",
  CredentialsSignin: "Invalid credentials",
  AccountNotLinked: "Account not linked, please use the original sign-in method",
  EmailSignInError: "Failed to send sign-in link",
  InvalidProvider: "Sign-in method not supported",
  SessionTokenError: "User session error, please sign in again",

  // Common errors
  USER_NOT_FOUND: "User not found",
  TOO_MANY_REQUESTS: "Too many requests, please try again later",
  FAILED_TO_SEND_EMAIL: "Failed to send email",
  
  // Email verification
  EMAIL_ALREADY_VERIFIED: "Email already verified",
  USER_CREATED_BUT_EMAIL_NOT_SENT: "User created but email not sent",

  // Password reset
  INVALID_TOKEN: "Reset link is invalid or has expired",
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