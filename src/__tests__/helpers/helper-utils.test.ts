/**
 * Tests for helper utility functions
 */

import { 
  generateId,
  validateEmail,
  sanitizeInput,
  formatDate,
  calculateWpm,
  calculateAccuracy,
  hashPassword,
  verifyPassword,
  generateSecureToken,
  rateLimitKey,
  isValidUrl,
  truncateText,
  normalizeString,
  debounce,
  throttle,
  retryWithBackoff
} from "@/__tests__/helpers/test-utils";
import bcrypt from "bcrypt";

// Mock bcrypt
jest.mock("bcrypt");
const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe("Helper Utilities", () => {
  describe("generateId", () => {
    it("should generate unique IDs", () => {
      const id1 = generateId();
      const id2 = generateId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(id1.length).toBeGreaterThan(10);
    });

    it("should generate IDs with custom prefix", () => {
      const id = generateId("user");
      expect(id).toMatch(/^user_[a-zA-Z0-9_-]+$/);
    });
  });

  describe("validateEmail", () => {
    it("should validate correct email formats", () => {
      expect(validateEmail("test@example.com")).toBe(true);
      expect(validateEmail("user.name+tag@domain.co.uk")).toBe(true);
      expect(validateEmail("test123@test-domain.org")).toBe(true);
    });

    it("should reject invalid email formats", () => {
      expect(validateEmail("invalid-email")).toBe(false);
      expect(validateEmail("@domain.com")).toBe(false);
      expect(validateEmail("test@")).toBe(false);
      expect(validateEmail("")).toBe(false);
      expect(validateEmail("test..test@domain.com")).toBe(false);
    });
  });

  describe("sanitizeInput", () => {
    it("should remove HTML tags", () => {
      const input = "<script>alert('xss')</script>Hello World";
      const sanitized = sanitizeInput(input);
      expect(sanitized).toBe("Hello World");
    });

    it("should handle special characters", () => {
      const input = "Hello & Goodbye < > \"quotes\"";
      const sanitized = sanitizeInput(input);
      expect(sanitized).not.toContain("<");
      expect(sanitized).not.toContain(">");
    });

    it("should preserve normal text", () => {
      const input = "This is normal text with numbers 123";
      const sanitized = sanitizeInput(input);
      expect(sanitized).toBe(input);
    });
  });

  describe("formatDate", () => {
    it("should format dates correctly", () => {
      const date = new Date("2024-01-15T10:30:00Z");
      const formatted = formatDate(date, "YYYY-MM-DD");
      expect(formatted).toBe("2024-01-15");
    });

    it("should handle different formats", () => {
      const date = new Date("2024-01-15T10:30:00Z");
      const formatted = formatDate(date, "DD/MM/YYYY");
      expect(formatted).toBe("15/01/2024");
    });

    it("should handle invalid dates", () => {
      const invalidDate = new Date("invalid");
      expect(() => formatDate(invalidDate)).toThrow();
    });
  });

  describe("calculateWpm", () => {
    it("should calculate WPM correctly", () => {
      const text = "Hello world this is a test";
      const timeInSeconds = 60; // 1 minute
      const wpm = calculateWpm(text, timeInSeconds);
      
      // 6 words in 1 minute = 6 WPM
      expect(wpm).toBe(6);
    });

    it("should handle different time durations", () => {
      const text = "Hello world this is a test";
      const timeInSeconds = 30; // 30 seconds
      const wpm = calculateWpm(text, timeInSeconds);
      
      // 6 words in 0.5 minutes = 12 WPM
      expect(wpm).toBe(12);
    });

    it("should handle edge cases", () => {
      expect(calculateWpm("", 60)).toBe(0);
      expect(calculateWpm("Hello", 0)).toBe(0);
    });
  });

  describe("calculateAccuracy", () => {
    it("should calculate accuracy correctly", () => {
      const originalText = "Hello world";
      const typedText = "Hello world";
      const accuracy = calculateAccuracy(originalText, typedText);
      expect(accuracy).toBe(100);
    });

    it("should handle typos", () => {
      const originalText = "Hello world";
      const typedText = "Helo world"; // Missing 'l'
      const accuracy = calculateAccuracy(originalText, typedText);
      expect(accuracy).toBeLessThan(100);
      expect(accuracy).toBeGreaterThan(80);
    });

    it("should handle completely wrong text", () => {
      const originalText = "Hello world";
      const typedText = "xyz abc";
      const accuracy = calculateAccuracy(originalText, typedText);
      expect(accuracy).toBeLessThan(50);
    });
  });

  describe("Password Utilities", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    describe("hashPassword", () => {
      it("should hash password correctly", async () => {
        mockBcrypt.hash.mockResolvedValue("hashed_password");
        
        const password = "mySecurePassword123";
        const hashed = await hashPassword(password);
        
        expect(hashed).toBe("hashed_password");
        expect(mockBcrypt.hash).toHaveBeenCalledWith(password, 12);
      });

      it("should handle empty passwords", async () => {
        await expect(hashPassword("")).rejects.toThrow();
      });
    });

    describe("verifyPassword", () => {
      it("should verify correct password", async () => {
        mockBcrypt.compare.mockResolvedValue(true);
        
        const result = await verifyPassword("password", "hashed_password");
        
        expect(result).toBe(true);
        expect(mockBcrypt.compare).toHaveBeenCalledWith("password", "hashed_password");
      });

      it("should reject incorrect password", async () => {
        mockBcrypt.compare.mockResolvedValue(false);
        
        const result = await verifyPassword("wrong_password", "hashed_password");
        
        expect(result).toBe(false);
      });
    });
  });

  describe("generateSecureToken", () => {
    it("should generate secure tokens", () => {
      const token1 = generateSecureToken();
      const token2 = generateSecureToken();
      
      expect(token1).not.toBe(token2);
      expect(token1.length).toBeGreaterThan(20);
      expect(token1).toMatch(/^[a-zA-Z0-9]+$/);
    });

    it("should generate tokens of specified length", () => {
      const token = generateSecureToken(32);
      expect(token.length).toBe(32);
    });
  });

  describe("rateLimitKey", () => {
    it("should generate consistent keys", () => {
      const key1 = rateLimitKey("user123", "login");
      const key2 = rateLimitKey("user123", "login");
      expect(key1).toBe(key2);
    });

    it("should generate different keys for different inputs", () => {
      const key1 = rateLimitKey("user123", "login");
      const key2 = rateLimitKey("user456", "login");
      const key3 = rateLimitKey("user123", "signup");
      
      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
    });
  });

  describe("isValidUrl", () => {
    it("should validate correct URLs", () => {
      expect(isValidUrl("https://example.com")).toBe(true);
      expect(isValidUrl("http://localhost:3000")).toBe(true);
      expect(isValidUrl("https://sub.domain.com/path?query=value")).toBe(true);
    });

    it("should reject invalid URLs", () => {
      expect(isValidUrl("not-a-url")).toBe(false);
      expect(isValidUrl("ftp://example.com")).toBe(false);
      expect(isValidUrl("")).toBe(false);
    });
  });

  describe("truncateText", () => {
    it("should truncate long text", () => {
      const longText = "This is a very long text that should be truncated";
      const truncated = truncateText(longText, 20);
      
      expect(truncated.length).toBeLessThanOrEqual(23); // 20 + "..."
      expect(truncated).toContain("...");
    });

    it("should not truncate short text", () => {
      const shortText = "Short text";
      const result = truncateText(shortText, 20);
      expect(result).toBe(shortText);
    });
  });

  describe("normalizeString", () => {
    it("should normalize whitespace", () => {
      const input = "  Hello    world  ";
      const normalized = normalizeString(input);
      expect(normalized).toBe("hello world");
    });

    it("should handle different cases", () => {
      const input = "Hello WORLD";
      const normalized = normalizeString(input);
      expect(normalized).toBe("hello world");
    });
  });

  describe("Function Utilities", () => {
    describe("debounce", () => {
      it("should debounce function calls", (done) => {
        let callCount = 0;
        const fn = debounce(() => {
          callCount++;
        }, 100);

        fn();
        fn();
        fn();

        setTimeout(() => {
          expect(callCount).toBe(1);
          done();
        }, 150);
      });
    });

    describe("throttle", () => {
      it("should throttle function calls", (done) => {
        let callCount = 0;
        const fn = throttle(() => {
          callCount++;
        }, 100);

        fn();
        fn();
        fn();

        setTimeout(() => {
          expect(callCount).toBe(1);
          done();
        }, 50);
      });
    });
  });

  describe("retryWithBackoff", () => {
    it("should retry failed operations", async () => {
      let attempts = 0;
      const failingFunction = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Temporary failure");
        }
        return "success";
      };

      const result = await retryWithBackoff(failingFunction, 3, 10);
      
      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });

    it("should give up after max retries", async () => {
      const alwaysFailingFunction = async () => {
        throw new Error("Permanent failure");
      };

      await expect(
        retryWithBackoff(alwaysFailingFunction, 2, 10)
      ).rejects.toThrow("Permanent failure");
    });
  });
});