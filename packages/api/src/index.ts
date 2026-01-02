import express from "express";
import { router } from "./routes";

const app = express();

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use(router);

const port = parseInt(process.env.PORT || "4319", 10);
app.listen(port, () => console.log(`X-Ray API listening on :${port}`));
