// db.ts

import { Morm } from "./morm/morm.js";
type UserType = {
  name?: string;
  id?: string;
  account_number?: number;
  class?: string;
  initials?: string;
  friends?: any;
};

const morm = async (db_url: string) => {
  try {
    const morm = await Morm.init(db_url, {
      transaction: { maxWait: 5000, timeout: 10000 },
    });
    console.log("Database connected!");

    morm?.enums([
      { name: "USER_ROLE", values: ["ADMIN", "SUPERADMIN", "STAFF", "MARKED"] },
    ]);

    morm!.model({
      table: "country_language",
      primaryKey: ["country_codes", "currency_cod", "language_code"],
      columns: [
        { name: "country_codes", type: "text" },
        { name: "language_code", type: "text" },
        { name: "currency_cod", type: "text" },
        { name: "is_official", type: "boolean", default: false },
      ],
    });

    morm!.model({
      table: "post",
      sanitize: { case: "upper", trim: true, clean: "basic" },
      columns: [
        { name: "id", type: "uuid", primary: true, default: "uuid()" },
        {
          name: "title",
          type: "text",
          sanitize: { case: "upper", trim: true, clean: "basic" },
        },
        {
          name: "tag_ids",
          type: "uuid[]",
          references: { table: "tag", column: "id", relation: "mm" },
        },
      ],
    });

    morm!.model({
      table: "tag",
      columns: [
        { name: "id", type: "uuid", primary: true, default: "uuid()" },
        { name: "name", type: "text" },
      ],
    });

    const User = morm!.model({
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

    return morm;
  } catch (err) {
    throw new Error(`Database connection error:, ${err}`);
  }
};

export default morm;
