"use server";

import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import { createHash } from "crypto";
import { logging } from "@/log/ServerLogger";
import { checkRateLimit } from "@/lib/rate-limiter";

type EmailTemplateType =
  | {
      type: "PASSWORD_RESET";
      data: { token: string };
    }
  | {
      type: "EMAIL_VERIFICATION";
      data: { token: string };
    };

const logEmailOperation = {
  start: (operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Email operation started: ${operation}`, metadata || {});
  },

  success: (operation: string, metadata?: Record<string, unknown>) => {
    logging.debugSensitive(`Email operation completed: ${operation}`, metadata || {});
  },

  error: (operation: string, error: unknown, metadata?: Record<string, unknown>) => {
    logging.error(`Email operation failed: ${operation}`, error, metadata);
  },
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashIdentifier(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}

function getFromAddress(): string | undefined {
  return process.env.EMAIL_ADDRESS?.trim();
}

function getFromName(): string {
  return (
    process.env.EMAIL_FROM_NAME?.trim() ||
    process.env.APP_NAME?.trim() ||
    "Type Ocean"
  );
}

function getDailyCap(): number {
  const n = Number(process.env.EMAIL_DAILY_LIMIT || "500");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}

function getSmtpConfig() {
  const user = (process.env.SMTP_USER || process.env.EMAIL_ADDRESS || "").trim();
  const pass = (process.env.SMTP_PASS || process.env.EMAIL_PASSWORD || "").trim();

  const host = (process.env.SMTP_HOST || "smtp.gmail.com").trim();
  const port = Number(process.env.SMTP_PORT || "465");
  const secure = (process.env.SMTP_SECURE || (port === 465 ? "true" : "false")) === "true";

  return { host, port, secure, user, pass };
}

let transporterSingleton: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporterSingleton) return transporterSingleton;

  const { host, port, secure, user, pass } = getSmtpConfig();

  if (!user || !pass) {
    throw new Error("SMTP_CONFIG_MISSING");
  }

  // Pooling + gentle pacing to reduce Gmail throttling.
  transporterSingleton = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },

    pool: true,
    maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS || "2"),
    maxMessages: Number(process.env.SMTP_MAX_MESSAGES || "50"),

    // Nodemailer built-in rate limiting for pooled connections
    rateDelta: Number(process.env.SMTP_RATE_DELTA_MS || "1000"),
    rateLimit: Number(process.env.SMTP_RATE_LIMIT || "5"),

    tls: {
      // Keep default verification; allow override for rare corporate proxies.
      rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED === "false" ? false : true,
    },
  });

  return transporterSingleton;
}

function isTransientSmtpError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const anyErr = error as {
    code?: string;
    responseCode?: number;
    message?: string;
  };

  const code = anyErr.code || "";
  const responseCode = anyErr.responseCode;
  const message = (anyErr.message || "").toLowerCase();

  if (["ETIMEDOUT", "ECONNECTION", "ECONNRESET", "EPIPE"].includes(code)) return true;

  // Typical SMTP transient response codes
  if (responseCode && [421, 450, 451, 452, 454].includes(responseCode)) return true;

  // Heuristic for transient Gmail throttling
  if (message.includes("try again later")) return true;
  if (message.includes("rate")) return true;
  if (message.includes("temporarily")) return true;

  return false;
}

async function sendMailWithRetry(options: {
  to: string;
  subject: string;
  html: string;
  requestId: string;
  template: EmailTemplateType["type"];
}): Promise<{ success: boolean; error?: string }> {
  const maxAttempts = Number(process.env.EMAIL_SEND_MAX_ATTEMPTS || "3");
  const baseDelayMs = Number(process.env.EMAIL_SEND_RETRY_BASE_DELAY_MS || "250");

  const fromAddress = getFromAddress();
  if (!fromAddress) {
    return { success: false, error: "EMAIL_ADDRESS_MISSING" };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const transporter = getTransporter();

      await transporter.sendMail({
        from: `${getFromName()} <${fromAddress}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        replyTo: process.env.EMAIL_SUPPORT?.trim() || undefined,
        headers: {
          "X-Request-Id": options.requestId,
          "X-Email-Template": options.template,
        },
      });

      return { success: true };
    } catch (error) {
      const transient = isTransientSmtpError(error);

      logEmailOperation.error("send_email_attempt", error, {
        requestId: options.requestId,
        template: options.template,
        to: options.to,
        attempt,
        maxAttempts,
        transient,
      });

      if (!transient || attempt === maxAttempts) {
        return { success: false, error: "EMAIL_SEND_FAILED" };
      }

      const jitter = Math.floor(Math.random() * 125);
      const delayMs = Math.min(30_000, baseDelayMs * 2 ** (attempt - 1) + jitter);
      await sleep(delayMs);
    }
  }

  return { success: false, error: "EMAIL_SEND_FAILED" };
}

async function generateEmailContent(
  type: EmailTemplateType["type"],
  data: EmailTemplateType["data"]
): Promise<{ subject: string; html: string }> {
  const baseUrl = process.env.NEXTAUTH_URL;
  const appName = process.env.APP_NAME || "Our App";
  const supportEmail = process.env.EMAIL_SUPPORT;

  if (!baseUrl) {
    throw new Error("NEXTAUTH_URL_MISSING");
  }

  switch (type) {
    case "PASSWORD_RESET":
      return {
        subject: `Password Reset - ${appName}`,
        html: `
          <div dir="ltr">
            <h1>Password Reset</h1>
            <p>To reset your password, please click the link below:</p>
            <a href="${baseUrl}/reset-password/${(data as { token: string }).token}">Reset Password</a>
            <p>The link will expire within one hour.</p>
            ${supportFooter({ appName, supportEmail })}
          </div>
        `,
      };

    case "EMAIL_VERIFICATION":
      return {
        subject: `Email Verification - ${appName}`,
        html: `
          <div dir="ltr">
            <h1>Account Activation</h1>
            <p>Thank you for signing up! Please click the link below to verify your account:</p>
            <a href="${baseUrl}/verify-email/${(data as { token: string }).token}">Verify Account</a>
            <p>The link will expire within 24 hours.</p>
            ${supportFooter({ appName, supportEmail })}
          </div>
        `,
      };

    default:
      throw new Error("UNSUPPORTED_EMAIL_TEMPLATE");
  }
}

function supportFooter(data: { appName?: string; supportEmail?: string }): string {
  return `
    <footer style="margin-top: 2rem; color: #666;">
      <p>Best regards, ${data.appName} Team</p>
      ${data.supportEmail && `<p>For inquiries: <a href="mailto:${data.supportEmail}">${data.supportEmail}</a></p>`}
    </footer>
  `;
}

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
      to,
    });

    // Global (sender-based) throttle to avoid SMTP bans.
    const senderKey = `sender:${hashIdentifier(getFromAddress() || "unknown")}`;

    // Daily sender cap (~500/day). Log when exceeded.
    const daily = await checkRateLimit("/internal/email/daily", senderKey);
    if (!daily.allowed) {
      logging.warn("Daily email cap exceeded", {
        requestId,
        template,
        sender: senderKey,
        dailyCap: getDailyCap(),
      });
      return { success: false, error: "EMAIL_DAILY_CAP_EXCEEDED" };
    }

    const global = await checkRateLimit("/internal/email/send", senderKey);
    if (!global.allowed) {
      return { success: false, error: "EMAIL_RATE_LIMITED" };
    }

    // Recipient throttle to avoid hammering a single mailbox.
    const recipientKey = `to:${hashIdentifier(to)}`;
    const perRecipient = await checkRateLimit("/internal/email/to", recipientKey);
    if (!perRecipient.allowed) {
      return { success: false, error: "EMAIL_RECIPIENT_RATE_LIMITED" };
    }

    const { subject, html } = await generateEmailContent(template, data);

    const result = await sendMailWithRetry({
      to,
      subject,
      html,
      requestId,
      template,
    });

    if (!result.success) {
      logEmailOperation.error("send_email", new Error(result.error || "EMAIL_SEND_FAILED"), {
        requestId,
        template,
      });
      return { success: false, error: result.error };
    }

    logEmailOperation.success("send_email", {
      requestId,
      template,
      status: "email_sent_successfully",
    });

    logging.info("Email sent successfully", {
      requestId,
      template,
      to: "redacted",
    });

    return { success: true };
  } catch (error) {
    logEmailOperation.error("send_email", error, {
      requestId,
      template,
    });
    return { success: false, error: "EMAIL_SEND_FAILED" };
  }
}

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
