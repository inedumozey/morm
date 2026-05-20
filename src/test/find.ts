import type { Morm } from "../morm/morm.js";

export const testFine = async (morm: Morm) => {
  try {
    await morm.transaction(async (trx) => {
      const users = await trx.user.find({
        where: { account_number: ".56" },
        // take: ()=>5,
        after: {},
        count: true,
        sum: "account_number",
        // after: { id: "00dbe0d1-fbfd-4fec-9898-abebf839fff0" },
        // include: { role: true, is_active: true, account_number: true },
      });

      console.log(users);
    });
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    process.exit(1);
  }
};
