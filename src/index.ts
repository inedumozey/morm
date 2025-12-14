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

// Mount notes router
app.use("/docs", router.docsRouter);

// usage
import { Morm } from "./morm/morm.js";
const db = async (db_name: string) => {
  const db_url = `postgresql://postgres:postgres@localhost:5432/${db_name}`;

  const morm = Morm.init(db_url, {}, (err: any, res: any) => {
    if (err) {
      console.log(err);
    } else {
      console.log("Database connected");
    }
  });
  return morm;
};

const morm = await db("drhmo");

const Profile = morm?.model({
  table: "profile",
  enums: [
    { name: "PROFILE_ROLES", values: ["ADMIN", "SUPERADMIN", "STUDENT"] },
  ],
  columns: [
    {
      name: "id",
      type: "UUID",
      primary: true,
      default: "uuid()",
    },
    {
      name: "user_id",
      type: "uuid",
      references: {
        table: "users",
        column: "id",
        relation: "nn",
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
    },
  ],
});

const User = morm?.model({
  table: "users",
  enums: [{ name: "USER_ROLES", values: ["ADMIN", "STUDENT"] }],
  columns: [
    { name: "id", type: "uuid", primary: true, default: "uuid()" },
    {
      name: "referrer_id",
      type: "uuid",
      references: {
        table: "users",
        column: "id",
        relation: "nm", // ONE-TO-MANY
      },
    },
    {
      name: "position_id",
      type: "UUID[]",
      references: {
        table: "position",
        column: "id",
        relation: "mm",
      },
    },
  ],
});
const Position = morm?.model({
  table: "position",
  columns: [
    { name: "id", type: "uuid", primary: true, default: "uuid()" },
    { name: "title", type: "text", notNull: true },
  ],
});

// await morm?.migrate({ clean: true });
await morm?.migrate({ clean: true, reset: true });

app.listen(4000, () => console.log("Server running on port 4000"));
