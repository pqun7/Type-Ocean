/**
 * Mock data generators for testing
 */

export const mockUsers = [
  {
    id: "user_1",
    username: "testuser1",
    email: "test1@example.com",
    passwordHash: "$2b$12$mockHashValue1",
    isEmailVerified: true,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01")
  },
  {
    id: "user_2", 
    username: "testuser2",
    email: "test2@example.com",
    passwordHash: "$2b$12$mockHashValue2",
    isEmailVerified: false,
    createdAt: new Date("2024-01-02"),
    updatedAt: new Date("2024-01-02")
  }
];

export const mockTypingTests = [
  {
    id: "test_1",
    userId: "user_1",
    text: "The quick brown fox jumps over the lazy dog",
    wpm: 45,
    accuracy: 98,
    completedAt: new Date("2024-01-01"),
    duration: 60
  },
  {
    id: "test_2",
    userId: "user_2", 
    text: "Lorem ipsum dolor sit amet consectetur",
    wpm: 52,
    accuracy: 95,
    completedAt: new Date("2024-01-02"),
    duration: 45
  }
];

export const mockPlayerProfiles = [
  {
    id: "profile_1",
    userId: "user_1",
    level: 5,
    totalXp: 1250,
    currentXp: 250,
    xpToNextLevel: 250,
    averageWpm: 45,
    bestWpm: 60,
    totalTestsCompleted: 25,
    totalTimeTyped: 3600
  }
];

export const mockChallenges = [
  {
    id: "challenge_1",
    title: "Speed Demon",
    description: "Type at 60+ WPM",
    type: "wpm",
    target: 60,
    reward: 100,
    isActive: true
  },
  {
    id: "challenge_2",
    title: "Accuracy Master", 
    description: "Achieve 98% accuracy",
    type: "accuracy",
    target: 98,
    reward: 150,
    isActive: true
  }
];

export const mockTypingTexts = [
  "The quick brown fox jumps over the lazy dog. This pangram contains every letter of the alphabet at least once.",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "To be or not to be, that is the question. Whether 'tis nobler in the mind to suffer the slings and arrows of outrageous fortune.",
  "In a hole in the ground there lived a hobbit. Not a nasty, dirty, wet hole filled with the ends of worms and an oozy smell."
];

export function generateMockUser(overrides: Partial<typeof mockUsers[0]> = {}) {
  return {
    id: `user_${Date.now()}`,
    username: `testuser_${Date.now()}`,
    email: `test_${Date.now()}@example.com`,
    passwordHash: "$2b$12$mockHashValue",
    isEmailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

export function generateMockTypingTest(overrides: Partial<typeof mockTypingTests[0]> = {}) {
  return {
    id: `test_${Date.now()}`,
    userId: "user_1",
    text: mockTypingTexts[Math.floor(Math.random() * mockTypingTexts.length)],
    wpm: Math.floor(Math.random() * 60) + 20,
    accuracy: Math.floor(Math.random() * 20) + 80,
    completedAt: new Date(),
    duration: Math.floor(Math.random() * 60) + 30,
    ...overrides
  };
}

export function generateMockPlayerProfile(overrides: Partial<typeof mockPlayerProfiles[0]> = {}) {
  const level = Math.floor(Math.random() * 10) + 1;
  const totalXp = level * 500 + Math.floor(Math.random() * 500);
  
  return {
    id: `profile_${Date.now()}`,
    userId: "user_1",
    level,
    totalXp,
    currentXp: totalXp % 500,
    xpToNextLevel: 500 - (totalXp % 500),
    averageWpm: Math.floor(Math.random() * 40) + 30,
    bestWpm: Math.floor(Math.random() * 50) + 50,
    totalTestsCompleted: Math.floor(Math.random() * 100) + 10,
    totalTimeTyped: Math.floor(Math.random() * 10000) + 1000,
    ...overrides
  };
}