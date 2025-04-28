// src/actions/reset-password.ts
"use server";

import { headers } from "next/headers";
import { SecureUniqueForge } from "unique-forge";
import { prisma } from "@/lib/db";
import { saltAndHashPassword } from "@/utils/password";
import { resetPasswordSchema } from "@/lib/schema";
import { Resend } from "resend";
import { cacheRequest } from "@/lib/cache";
import { randomBytes } from 'crypto';


export type PasswordState = {
  success: boolean;
  error?: string | null;
};

const resend = new Resend(process.env.RESEND_API_KEY);

const errorMessages: Record<string, string> = {
  USER_NOT_FOUND: "Email is not registered",
  INVALID_OR_EXPIRED_TOKEN: "Reset link is invalid or has expired",
  EMAIL_REQUIRED: "Please enter your email",
  SOCIAL_AUTH_ACCOUNT: "Account uses external login",
  TOO_MANY_REQUESTS: "Too many requests, try again later",
  DEFAULT: "Something went wrong, please try again",
};

// src/actions/reset-password.ts
export async function generateResetToken(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) throw new Error("USER_NOT_FOUND");
  if (!user.passwordHash) throw new Error("SOCIAL_AUTH_ACCOUNT");

  // const forge = new SecureUniqueForge();

  // const resetToken = await forge.generate();
  const resetToken = randomBytes(32).toString('hex');

  
  const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

  await prisma.user.update({
    where: { email },
    data: { resetToken, resetTokenExpiry },
  });

  return resetToken;
}

const RATE_LIMIT = {
  REQUESTS_PER_PERIOD: 3,
  PERIOD_MS: 60 * 1000, // 1 دقيقة
};

async function checkRateLimit(ip: string): Promise<boolean> {
  if (!cacheRequest(ip)) {
    console.warn(`Cache request check failed for IP: ${ip}`);
    return false;
  }

  try {
    console.log(`Checking rate limit for IP: ${ip}`);

    // Using UPSERT to optimize performance
    const result = await prisma.rateLimit.upsert({
      where: { ip },
      update: {
        count: { increment: 1 },
        lastUpdated: new Date(),
      },
      create: {
        ip,
        count: 1,
        lastUpdated: new Date(),
      },
    });

    console.log(`Fetched or created rate limit record for IP: ${ip}. Current count: ${result.count}`);

    // Reset the counter if the period has passed
    if (Date.now() - result.lastUpdated.getTime() > RATE_LIMIT.PERIOD_MS) {
      console.log(`Rate limit period expired for IP: ${ip}. Resetting count.`);

      await prisma.rateLimit.update({
        where: { ip },
        data: {
          count: 1,
          lastUpdated: new Date(),
        },
      });
      return true;
    }

    const allowed = result.count <= RATE_LIMIT.REQUESTS_PER_PERIOD;
    console.log(`IP: ${ip} is ${allowed ? "within" : "over"} the rate limit.`);

    return allowed;
  } catch (error) {
    console.error(`Rate limit check failed for IP: ${ip}`, error);
    return true; // Allowing the request in case of error
  }
}


export async function resetPassword(
  prevState: PasswordState,
  formData: FormData
): Promise<PasswordState> {
  console.log("\n===== Starting Password Reset =====");
  console.log("Form Data:", Object.fromEntries(formData.entries()));

  const headersInstance = await headers();
  const ip = headersInstance.get("x-forwarded-for") ?? "anonymous";
  console.log("IP Address:", ip);

  // Rate Limit Check
  console.log("Checking Rate Limit...");
  const allowed = await checkRateLimit(ip);
  console.log("Rate Limit Allowed:", allowed);

  // if (!allowed) {
  //   console.log("Rate Limit Exceeded!");
  //   return { success: false, error: errorMessages["TOO_MANY_REQUESTS"] };
  // }

  

  try {
    const email = formData.get("email") as string;
    console.log("Processing Email:", email);

    if (!email) {
      console.log("Email is required!");
      throw new Error("EMAIL_REQUIRED");
    }

    console.log("Generating Reset Token...");
    const token = await generateResetToken(email);
    console.log("Generated Token:", token);

    const resetLink = `${process.env.NEXTAUTH_URL}/reset-password/${token}`;
    console.log("Reset Link:", resetLink);

    console.log("Sending Email...");

    const { error } = await resend.emails.send({
      from: "onboarding@resend.dev",
      to: email,
      subject: "Reset Password",
      html: `
        <div>
          <h1>Reset Password</h1>
          <p>To reset your password, please click the following link:</p>
          <a href="${resetLink}">${resetLink}</a>
          <p>This link will expire in one hour.</p>
        </div>
      `,
    });

    if (error) {
      console.error("Email Send Error:", error);
      throw new Error("FAILED_TO_SEND_EMAIL");
    }

    console.log("===== Password Reset Completed Successfully =====\n");
    return { success: true };
  } catch (error) {
    console.error("Error during password reset:", error);
    const errorKey = (error as Error).message;
    return {
      success: false,
      error: errorMessages[errorKey] || errorMessages.DEFAULT,
    };
  }
}

export async function updatePassword(
  prevState: PasswordState,
  formData: FormData
): Promise<PasswordState> {
  try {
    const token = formData.get("token") as string;

    // تحقق من وجود التوكن قبل كل شيء
    if (!token) throw new Error("INVALID_OR_EXPIRED_TOKEN");

    const result = resetPasswordSchema.safeParse({
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
      token: token,
    });

    if (!result.success) {
      const errors = result.error.flatten();
      return {
        success: false,
        error: errors.formErrors.join(", ") || errorMessages.DEFAULT,
      };
    }

    const { password, confirmPassword } = result.data;

    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: { gt: new Date() },
      },
    });

    if (!user) throw new Error("INVALID_OR_EXPIRED_TOKEN");
    if (!user.passwordHash) throw new Error("SOCIAL_AUTH_ACCOUNT");

    const hashedPassword = await saltAndHashPassword(password);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Password reset error:", error);
    const errorKey = (error as Error).message;
    return {
      success: false,
      error: errorMessages[errorKey] || errorMessages.DEFAULT,
    };
  }
}
