// @/providers/resend/resend.ts
"use server";

import { Resend } from "resend";

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
    }
  | {
      type: "PASSWORD_CHANGED";
      data: {};
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
  try {
    // Get the email content based on the template
    const { subject, html } = await generateEmailContent(template, data);

    // Send the email using Resend
    const { error } = await resendClient.emails.send({
      from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM_ADDRESS}>`,
      to,
      subject,
      html,
    });

    return error ? { success: false, error: error.toString() } : { success: true };
  } catch (error) {
    console.error(`Failed to send ${template} email:`, error);
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
          <div dir="rtl">
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
          <div dir="rtl">
            <h1>Account Activation</h1>
            <p>Thank you for signing up! Please click the link below to verify your account:</p>
            <a href="${baseUrl}/verify-email/${(data as { token: string }).token}">Verify Account</a>
            <p>The link will expire within 24 hours.</p>
            ${supportFooter(commonData)}
          </div>
        `,
      };

    case "PASSWORD_CHANGED":
      return {
        subject: `Password Changed - ${commonData.appName}`,
        html: `
          <div dir="rtl">
            <h1>Password Successfully Changed</h1>
            <p>Your account password was changed on ${new Date().toLocaleString()}.</p>
            <p>If you did not perform this action, please contact us immediately.</p>
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
export const sendPasswordResetEmail = (email: string, token: string) =>
  sendEmail<{ type: "PASSWORD_RESET"; data: { token: string } }>(
    email,
    "PASSWORD_RESET",
    { token }
  );

  export const sendVerificationEmail = (email: string, token: string) =>
    sendEmail<{ type: "EMAIL_VERIFICATION"; data: { token: string } }>(
      email,
      "EMAIL_VERIFICATION",
      { token }
    );

export const sendPasswordChangedNotification = (email: string) =>
  sendEmail<{ type: "PASSWORD_CHANGED"; data: {} }>(
    email,
    "PASSWORD_CHANGED",
    {}
  );
