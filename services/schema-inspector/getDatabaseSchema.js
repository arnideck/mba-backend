import schema from "./dicionario_dados_negocio.json" assert { type: "json" };

let printed = false; // guarda se já imprimiu

export function getSchema() {
  if (!printed) {
    console.log("🚀 Conteúdo do JSON carregado:", JSON.stringify(schema, null, 2));
    printed = true;
  }
  return schema;
}

