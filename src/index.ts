// index.ts

import express from "express";
import cors from "cors";
import router from "./routes/index.js";
import { HttpError, HttpStatus } from "./HttpError.js";
import "dotenv/config";
import db from "./db.js";
import { testCrteate } from "./test/create.js";
import { testFine } from "./test/find.js";
import { testFineOne } from "./test/findone.js";

const app = express();
app.use(cors());
app.use(express.json());

// create the database
const db_name = "new_db";
const db_url = `postgresql://postgres:postgre@localhost:5432/${db_name}`;
const morm = await db(db_url);

// testCrteate(morm);
// testFine(morm);
// testFineOnxe(morm);

app.listen(4000, () => console.log("Server running on port 4000"));
