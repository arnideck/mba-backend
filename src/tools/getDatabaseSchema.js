import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getSchema() {
  const schemaPath = path.join(__dirname, "dicionario_dados_negocio.json");
  const raw = fs.readFileSync(schemaPath, { encoding: "utf-8" });
  return JSON.parse(raw);
}
