import express from "express";
import { router } from "./routes";
import dotenv from 'dotenv';
dotenv.config();
const app = express();

app.use(express.json());


app.get("/health", (_req, res) => {
    console.log("Health check");
    res.json({ ok: true });
});


app.use(router);

const port = parseInt(process.env.PORT || "4319", 10);
app.listen(port, () => console.log(`X-Ray API listening on :${port}`));
