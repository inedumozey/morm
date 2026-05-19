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
          username: "user98",
          email: "user98@gmail.com",
          account_number: 98,
          state: "Plateau",
          tags: ["javascript"],
          is_active: true,
          role: "SUPERADMIN",
        },
        skipDuplicates: true,
      });

      console.log(result);
    });
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    process.exit(1);
  }
};
