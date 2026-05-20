import type { Morm } from "../morm/morm.js";

export const testCrteate = async (morm: Morm) => {
  try {
    await morm.transaction(async (trx: Morm) => {
      const data = [
        {
          username: "user1",
          email: "user1@gmail.com",
          account_number: 1,
          state: "Lagos",
          tags: ["javascript", "typescript"],
          is_active: true,
          role: "ADMIN",
        },
        {
          username: "user2",
          email: "user2@gmail.com",
          account_number: 2,
          state: "Abuja",
          tags: ["python", "javascript"],
          is_active: false,
          role: "STAFF",
        },
        {
          username: "user3",
          email: "user3@gmail.com",
          account_number: 3,
          state: "Kano",
          tags: ["rust", "typescript"],
          is_active: true,
          role: "SUPERADMIN",
        },
        {
          username: "user4",
          email: "user4@gmail.com",
          account_number: 4,
          state: "Rivers",
          tags: ["python", "rust"],
          is_active: false,
          role: "MARKED",
        },
        {
          username: "user5",
          email: "user5@gmail.com",
          account_number: 5,
          state: "Lagos",
          tags: ["javascript"],
          is_active: true,
          role: "STAFF",
        },
      ];

      const result = await trx.user.create({
        data: {
          username: "testuser",
          email: "test@gmail.com",
          account_number: 1,
          state: "Lagos",
          tags: ["javascript", "typescript"],
          is_active: true,
          role: "ADMIN",
          count: [1, 2, 3],
          ids: ["c868b7bb-ba10-4134-8c9d-61da04723d5a"],
          dates: ["2024-01-01", new Date("2024-06-15")],
          count_: [4, 5, 6],
          countnum_: [true, false],
          ids_: ["c868b7bb-ba10-4134-8c9d-61da04723d5a"],
          dates_: ["2024-01-01"],
          boolean: () => [true, false, true],
          datestz_: ["2024-01-01T00:00:00Z"],
          time: ["08:00:00+01:00", "12:30:00+01:00"],
        },
        skipDuplicates: true,
        include: {},
      });

      console.log(result.id);
    });
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    process.exit(1);
  }
};
