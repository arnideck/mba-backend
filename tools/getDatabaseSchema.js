// tools/getDatabaseSchema.js
const fs = require("fs");

function getSchema() {
  const raw = fs.readFileSync("dicionario_dados_negocio.json");
  return JSON.parse(raw);
}

module.exports = { getSchema };
