import express from "express";
import cors from "cors";
import router from "./routes/index.js";
import { HttpError, HttpStatus } from "./HttpError.js";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

// create the database
app.post("/", async (req, res) => {
  const { app_id } = req.body;
  try {
    if (!app_id) {
      throw new HttpError("App ID is missing", HttpStatus.NOT_FOUND);
    }
    // create new database
    res.status(HttpStatus.OK).json({ message: "App created successfully" });
  } catch (err: any) {
    return res.status(500).json({
      message: err.message,
      status_code: err.status,
    });
  }
});

/**
 * MORM STORAGE
 * model-types.ts
 * sql/buildColumnSQL.ts
 * utils/canonicalType.ts
 * utils/relationValidator.ts
 * utils/junctionBuilder.ts
 * utils/validateColumnType.ts
 * utils/sanitize.ts
 * utils/checkParser.ts
 * migrations/alterColumn.ts
 * migrations/alterColumnCheck.ts
 * migrations/alterColumnNullity.ts
 * migrations/alterColumnTypes.ts
 * migrations/alterColumnUnique.ts
 * migrations/enumRegistry.ts
 * migrations/indexMigrations.ts
 * migrations/resetDatabase.ts
 */
app.use("/docs", router.docsRouter);

// usage
import { Morm } from "./morm/morm.js";
const db = async (db_name: string) => {
  const db_url = `postgresql://postgres:postgres@localhost:5432/${db_name}`;

  const morm = Morm.init(
    db_url,
    { transaction: { maxWait: 5000, timeout: 10000 } },
    (err: any, res: any) => {
      if (err) {
        console.log(err);
      } else {
        console.log("Database connected");
      }
    },
  );
  return morm;
};

const morm = await db("drhmo");
await morm?.transaction(async (tx) => {
  // console.log({ tx });
});

morm?.enums([
  { name: "USER_ROLE", values: ["ADMIN", "SUPERADMIN", "STAFF", "MARKED"] },
]);

const CountryLanguage = morm!.model({
  table: "country_language",
  primaryKey: ["country_codes", "currency_cod", "language_code"],
  columns: [
    { name: "country_codes", type: "text" },
    { name: "language_code", type: "text" },
    { name: "currency_cod", type: "text" },
    { name: "is_official", type: "boolean", default: false },
  ],
});

const Post = morm!.model({
  table: "post",
  columns: [
    { name: "id", type: "uuid", primary: true, default: "uuid()" },
    { name: "title", type: "text" },
    {
      name: "tag_ids",
      type: "uuid[]",
      references: { table: "tag", column: "id", relation: "mm" },
    },
  ],
});

const Tag = morm!.model({
  table: "tag",
  columns: [
    { name: "id", type: "uuid", primary: true, default: "uuid()" },
    { name: "name", type: "text" },
  ],
});

await morm?.migrate();
// await morm?.migrate({ reset: true });

app.listen(4000, () => console.log("Server running on port 4000"));
