import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "dicionario_dados_negocio.json");

export function getSchema() {
  const raw = fs.readFileSync(schemaPath, "utf-8");
  return JSON.parse(raw);
}

