"use server";

import { Resend } from "resend";
import { logging } from "@/log/ServerLogger";
import prisma from "@/features/auth/lib/db";
import { randomBytes, createHash } from "crypto";

// Configure the Resend library using the API Key
const resendClient = new Resend(process.env.RESEND_API_KEY);

type EmailTemplateType =
  | {
      type: "PASSWORD_RESET";
      data: { token: string };
    }
  | {
      type: "EMAIL_VERIFICATION";
      data: { token: string };
    };

// Safe logging utilities for email operations
const logEmailOperation = {
  start: (operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Email operation started: ${operation}`, metadata || {});
  },
  
  success: (operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Email operation completed: ${operation}`, metadata || {});
  },
  
  error: (operation: string, error: unknown, metadata?: Record<string, unknown>) => {
    logging.error(`Email operation failed: ${operation}`, error, metadata);
  }
};

/**
 * Send a general email with template support
 * @param to - Recipient email address
 * @param template - Type of the template used
 * @param data - Data required for the template
 */
async function sendEmail<T extends EmailTemplateType>(
  to: string,
  template: T["type"],
  data: T["data"]
): Promise<{ success: boolean; error?: string }> {
  const requestId = `email-${template}-${Date.now()}`;
  
  try {
    logEmailOperation.start("send_email", {
      requestId,
      template,
      to
    });

    // Get the email content based on the template
    const { subject, html } = await generateEmailContent(template, data);

    // Send the email using Resend
    const { error } = await resendClient.emails.send({
      from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM_ADDRESS}>`,
      to,
      subject,
      html,
    });

    if (error) {
      logEmailOperation.error("send_email", new Error("Resend API error"), {
        requestId,
        template,
        to,
        resendError: error.toString()
      });
      return { success: false, error: error.toString() };
    }

    logEmailOperation.success("send_email", {
      requestId,
      template,
      to,
      status: "email_sent_successfully"
    });

    // Production-safe logging
    logging.info("Email sent successfully", {
      requestId,
      template,
      to: "redacted" // Don't log email in production
    });

    return { success: true };
  } catch (error) {
    logEmailOperation.error("send_email", error, {
      requestId,
      template,
      to
    });
    return { success: false, error: "EMAIL_SEND_FAILED" };
  }
}

/**
 * Generate email content based on the template
 */
async function generateEmailContent(
  type: EmailTemplateType["type"],
  data: EmailTemplateType["data"]
): Promise<{ subject: string; html: string }> {
  const baseUrl = process.env.NEXTAUTH_URL;
  const commonData = {
    appName: process.env.APP_NAME || "Our App",
    supportEmail: process.env.EMAIL_SUPPORT,
  };

  switch (type) {
    case "PASSWORD_RESET":
      return {
        subject: `Password Reset - ${commonData.appName}`,
        html: `
          <div dir="ltr">
            <h1>Password Reset</h1>
            <p>To reset your password, please click the link below:</p>
            <a href="${baseUrl}/reset-password/${(data as { token: string }).token}">Reset Password</a>
            <p>The link will expire within one hour.</p>
            ${supportFooter(commonData)}
          </div>
        `,
      };

    case "EMAIL_VERIFICATION":
      return {
        subject: `Email Verification - ${commonData.appName}`,
        html: `
          <div dir="ltr">
            <h1>Account Activation</h1>
            <p>Thank you for signing up! Please click the link below to verify your account:</p>
            <a href="${baseUrl}/verify-email/${(data as { token: string }).token}">Verify Account</a>
            <p>The link will expire within 24 hours.</p>
            ${supportFooter(commonData)}
          </div>
        `,
      };

    default:
      throw new Error("UNSUPPORTED_EMAIL_TEMPLATE");
  }
}

/**
 * Common email footer
 */
function supportFooter(data: {
  appName?: string;
  supportEmail?: string;
}): string {
  return `
    <footer style="margin-top: 2rem; color: #666;">
      <p>Best regards, ${data.appName} Team</p>
      ${data.supportEmail && `<p>For inquiries: <a href="mailto:${data.supportEmail}">${data.supportEmail}</a></p>`}
    </footer>
  `;
}

// Specific email interfaces
export const sendPasswordResetEmail = async (email: string, token: string) => 
  await sendEmail<{ type: "PASSWORD_RESET"; data: { token: string } }>(
    email,
    "PASSWORD_RESET",
    { token }
  );

export const sendVerificationEmail = async (email: string, token: string) => 
  await sendEmail<{ type: "EMAIL_VERIFICATION"; data: { token: string } }>(
    email,
    "EMAIL_VERIFICATION",
    { token }
  );

export async function generateResetToken(email: string) {
  const requestId = `generate-reset-token-${Date.now()}`;
  
  if (!email || typeof email !== "string") {
    logEmailOperation.error("generate_reset_token", new Error("Invalid email"), {
      requestId,
      email
    });
    throw new Error("INVALID_EMAIL");
  }
  
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    logEmailOperation.error("generate_reset_token", new Error("User not found"), {
      requestId,
      email
    });
    throw new Error("USER_NOT_FOUND");
  }
  
  if (!user.passwordHash) {
    logEmailOperation.error("generate_reset_token", new Error("Social auth account"), {
      requestId,
      userId: user.id,
      email
    });
    throw new Error("SOCIAL_AUTH_ACCOUNT");
  }

  const rawToken = randomBytes(32).toString("hex");
  const hashedToken = createHash("sha256").update(rawToken).digest("hex");

  const resetTokenExpiry = new Date(Date.now() + 3600000);

  await prisma.user.update({
    where: { email },
    data: {
      resetToken: hashedToken,
      resetTokenExpiry,
      passwordResetRequests: { increment: 1 },
    },
  });

  logEmailOperation.success("generate_reset_token", {
    requestId,
    userId: user.id,
    email,
    status: "reset_token_generated"
  });

  return rawToken;
}

export async function validateResetToken(token: string) {
  const requestId = `validate-reset-token-${Date.now()}`;
  
  const hashedToken = createHash("sha256").update(token).digest("hex");
  
  logEmailOperation.start("validate_reset_token", {
    requestId,
    hasToken: !!token
  });

  const user = await prisma.user.findFirst({
    where: {
      resetToken: hashedToken,
      resetTokenExpiry: { gt: new Date() },
    },
  });

  if (!user) {
    logEmailOperation.error("validate_reset_token", new Error("Invalid or expired token"), {
      requestId
    });
    throw new Error("INVALID_OR_EXPIRED_TOKEN");
  }

  logEmailOperation.success("validate_reset_token", {
    requestId,
    userId: user.id,
    status: "reset_token_validated"
  });

  return user;
}

export async function generateEmailVerificationToken(email: string): Promise<string> {
  const requestId = `generate-email-token-${Date.now()}`;
  
  logEmailOperation.start("generate_email_verification_token", {
    requestId,
    email
  });

  const user = await prisma.user.findUnique({ where: { email } });
  
  if (!user) {
    logEmailOperation.error("generate_email_verification_token", new Error("User not found"), {
      requestId,
      email
    });
    throw new Error("USER_NOT_FOUND");
  }
  
  if (user.emailVerified) {
    logEmailOperation.error("generate_email_verification_token", new Error("Email already verified"), {
      requestId,
      userId: user.id,
      email
    });
    throw new Error("EMAIL_ALREADY_VERIFIED");
  }

  const rawToken = randomBytes(32).toString("hex");
  const hashedToken = createHash("sha256").update(rawToken).digest("hex");

  const tokenExpiry = new Date(Date.now() + 24 * 3600 * 1000);

  await prisma.user.update({
    where: { email },
    data: {
      emailVerifyToken: hashedToken,
      emailVerifyTokenExpiry: tokenExpiry,
      emailVerificationAttempts: { increment: 1 },
    },
  });

  logEmailOperation.success("generate_email_verification_token", {
    requestId,
    userId: user.id,
    email,
    status: "email_verification_token_generated"
  });

  return rawToken;
}

export async function validateEmailToken(token: string) {
  const requestId = `validate-email-token-${Date.now()}`;
  
  logEmailOperation.start("validate_email_token", {
    requestId,
    hasToken: !!token
  });

  const hashedToken = createHash("sha256").update(token).digest("hex");
  
  const user = await prisma.user.findFirst({
    where: {
      emailVerifyToken: hashedToken,
      emailVerifyTokenExpiry: { gt: new Date() }
    }
  });

  if (!user) {
    logEmailOperation.error("validate_email_token", new Error("Invalid or expired token"), {
      requestId
    });
    throw new Error("INVALID_OR_EXPIRED_TOKEN");
  }

  logEmailOperation.success("validate_email_token", {
    requestId,
    userId: user.id,
    status: "email_token_validated"
  });

  return user;
}