/** @jest-environment node */

import { signUp } from "@/features/auth/lib/actions";
import { saltAndHashPassword } from "@/features/auth/utils/password";
import { checkRateLimit } from "@/lib/rate-limiter";

// Jest hoists mock factories above lexical declarations, so these shared mock
// handles intentionally use `var`.
// eslint-disable-next-line no-var
var mockDb: {
  select: jest.Mock;
  selectFrom: jest.Mock;
  selectWhere: jest.Mock;
  selectLimit: jest.Mock;
};

// eslint-disable-next-line no-var
var mockTransaction: jest.Mock;
// eslint-disable-next-line no-var
var mockBatchTransaction: jest.Mock;

jest.mock("@/db", () => ({
  __esModule: true,
  db: (() => {
    mockDb = {
      select: jest.fn(),
      selectFrom: jest.fn(),
      selectWhere: jest.fn(),
      selectLimit: jest.fn(),
    };

    mockDb.selectWhere.mockReturnValue({ limit: mockDb.selectLimit });
    mockDb.selectFrom.mockReturnValue({ where: mockDb.selectWhere });
    mockDb.select.mockReturnValue({ from: mockDb.selectFrom });

    mockBatchTransaction = jest.fn().mockResolvedValue(undefined);

    const values = jest.fn().mockReturnValue({});
    const where = jest.fn().mockReturnValue({});

    return {
      select: mockDb.select,
      insert: jest.fn(() => ({ values })),
      delete: jest.fn(() => ({ where })),
      batch: (...args: unknown[]) => mockBatchTransaction(...args),
    };
  })(),
  isLocalDatabase: false,
  transactionDb: {
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

jest.mock("@/features/auth/utils/password", () => ({
  saltAndHashPassword: jest.fn(),
}));

jest.mock("@/lib/rate-limiter", () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => (key.toLowerCase() === "x-forwarded-for" ? "203.0.113.10" : null),
  }),
}));

jest.mock("@/log/ServerLogger", () => ({
  logging: {
    debugSensitive: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

describe("signUp", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.selectLimit.mockResolvedValue([]);
    (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true, headers: {} });
    (saltAndHashPassword as jest.Mock).mockResolvedValue("hashed-password");

    mockTransaction = jest.fn(async (callback) => {
      const returning = jest.fn().mockResolvedValue([{ id: "user-1", username: "new_user" }]);
      const insert = jest
        .fn()
        .mockReturnValueOnce({ values: jest.fn(() => ({ returning })) })
        .mockReturnValueOnce({ values: jest.fn().mockResolvedValue(undefined) });
      const deleteWhere = jest.fn().mockResolvedValue(undefined);
      const deleteFrom = jest.fn(() => ({ where: deleteWhere }));

      return callback({ insert, delete: deleteFrom });
    });
  });

  it("creates the user and profile through a Neon batch transaction", async () => {
    const formData = new FormData();
    formData.set("email", "new@example.com");
    formData.set("username", "New_User");
    formData.set("password", "Password1");
    formData.set("confirmPassword", "Password1");

    await expect(signUp(formData)).resolves.toEqual({ success: true });

    expect(mockBatchTransaction).toHaveBeenCalledTimes(1);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(saltAndHashPassword).toHaveBeenCalledWith("Password1");
  });
});
