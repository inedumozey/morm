// db.ts

import { Morm } from "./morm/morm.js";

const morm = async (db_url: string) => {
  try {
    const morm = await Morm.init(db_url, {
      transaction: { maxWait: 5000, timeout: 10000 },
      generate: {
        output: "./src",
        module: "./morm/morm.js",
      },
    });
    console.log("Database connected!");

    morm?.enums([
      { name: "USER_ROLE", values: ["ADMIN", "SUPERADMIN", "STAFF", "MARKED"] },
    ]);

    morm!.model({
      table: "user",
      columns: [
        { name: "id", type: "uuid", primary: true, default: "uuid()" },
        { name: "name", type: "text" },
        {
          name: "account_number",
          type: "INT",
          unique: true,
          notNull: true,
        },
        { name: "class", type: "text", unique: true },
        { name: "initials", type: "VARCHAR(4)", notNull: true, default: "er" },
        {
          name: "friends",
          type: "uuid[]",
          references: {
            table: "user",
            column: "id",
            relation: "mm",
            onDelete: "RESTRICT",
            onUpdate: "NO ACTION",
          },
        },
      ],
    });

    morm!.model({
      table: "profile",
      columns: [
        { name: "id", type: "uuid", primary: true, default: "uuid()" },
        { name: "fullname", type: "text", notNull: true },
        {
          name: "profile_image",
          type: "text",
        },
      ],
    });

    await morm?.migrate();
    // await morm?.migrate({ reset: true });

    return morm;
  } catch (err) {
    throw new Error(`Database connection error:, ${err}`);
  }
};

export default morm;
