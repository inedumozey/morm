import { Router } from "express";

const router = Router();

// GET all DOCS
router.get("/", async (req, res) => {});

// CREATE DOC
router.post("/", async (req, res) => {
  const { title, note, last_modified_by } = req.body;
});

// UPDATE DOC
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { title, note, last_modified_by } = req.body;
});

// DELETE DOC
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const { title, note, last_modified_by, deleted } = req.body;
});

export default router;
