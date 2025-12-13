import { Router } from "express";

const router = Router();

// GET all notes
router.get("/", async (req, res) => {});

// CREATE note
router.post("/", async (req, res) => {
  const { patient_id, note, last_modified_by } = req.body;
});

// UPDATE note
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { note, last_modified_by, deleted } = req.body;
});

// DELETE note
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const { note, last_modified_by, deleted } = req.body;
});

export default router;
