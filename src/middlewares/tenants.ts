// middleware/tenant.ts

import type { Request, Response, NextFunction } from "express";
import db from "../db.js";

export async function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const hospital = req.header("x-hospital-code");

  if (!hospital) {
    return res.status(400).json({ message: "Hospital code required" });
  }

  const db_url = `postgresql://postgres:password@localhost:5432/${hospital}_db`;

  req.db = await db(db_url);
  next();
}
