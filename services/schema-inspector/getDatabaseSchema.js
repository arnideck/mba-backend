import fs from "fs";
import path from "path";

export function getSchema() {
  const schemaPath = path.resolve("./dicionario_dados_negocio.json");
  const raw = fs.readFileSync(schemaPath, { encoding: "utf-8" });
  return JSON.parse(raw);
}
