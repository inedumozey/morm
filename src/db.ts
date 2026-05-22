// db.ts

import { Morm } from "./morm/morm.js";

const morm = async (db_url: string) => {
  try {
    const morm = await Morm.init(db_url, {
      transaction: { maxWait: 5000, timeout: 10000 },
      generate: {
        output: "./src",
      },
      debug: true,
    });
    console.log("Database connected!");

    morm?.enums([
      { name: "USER_ROLE", values: ["ADMIN", "SUPERADMIN", "STAFF", "MARKED"] },
    ]);

    morm!.model({
      table: "user",
      columns: [
        { name: "id", type: "uuid", primary: true, default: "uuid()" },
        { name: "username", type: "text", sanitize: { trim: true } },
        {
          name: "email",
          type: "text",
          sanitize: { trim: true, case: "lower" },
        },
        { name: "account_number", type: "INT" },
        { name: "state", type: "text" },
        { name: "is_active", type: "BOOLEAN", default: true },
        { name: "role", type: "USER_ROLE", default: "STAFF" },
      ],
      indexes: [
        "state",
        ["username", "email"],
        { columns: "is_active", where: "is_active == true" },
      ],
    });

    morm!.model({
      table: "profile",
      columns: [
        { name: "id", type: "uuid", primary: true, default: "uuid()" },
        { name: "fullname", type: "text", notNull: true },
        { name: "avatar", type: "text" },
        {
          name: "user_id",
          type: "uuid",
          unique: true,
          references: { table: "user", column: "id", relation: "nn" },
        },
      ],
      indexes: ["user_id"],
    });

    morm!.model({
      table: "post",
      columns: [
        { name: "id", type: "uuid", primary: true, default: "uuid()" },
        { name: "title", type: "text", notNull: true },
        { name: "body", type: "text" },
        {
          name: "user_id",
          type: "uuid",
          references: { table: "user", column: "id", relation: "nm" },
        },
        {
          name: "tag_ids",
          type: "uuid[]",
          references: { table: "tag", column: "id", relation: "mm" },
        },
      ],
      indexes: ["user_id", "title"],
    });

    morm!.model({
      table: "tag",
      columns: [
        { name: "id", type: "uuid", primary: true, default: "uuid()" },
        { name: "name", type: "text", notNull: true, unique: true },
      ],
      indexes: ["name"],
    });
    // await morm?.migrate();
    // await morm?.migrate({ reset: true });

    return morm;
  } catch (err) {
    throw new Error(`Database connection error:, ${err}`);
  }
};

export default morm;
