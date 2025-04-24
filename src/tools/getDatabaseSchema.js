import fs from "fs";

export function getSchema() {
  const raw = fs.readFileSync("dicionario_dados_negocio.json", "utf-8");
  return JSON.parse(raw);
}
