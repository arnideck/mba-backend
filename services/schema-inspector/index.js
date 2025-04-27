// services/schema-inspector/index.js

import { Tool } from "@langchain/core/tools";
import { getSchema } from "./getDatabaseSchema.js";

export class SchemaInspector extends Tool {
  constructor() {
    super();
    this.name = "schema_inspector";
    this.description =
      "Utiliza o dicionário de dados para responder perguntas sobre tabelas, colunas e relacionamentos.";
  }

  async _call(input) {
    const schema = getSchema();
    let output = "";
    const termo = input.toLowerCase();

    for (const [tabela, dados] of Object.entries(schema)) {
      if (
        tabela.toLowerCase().includes(termo) ||
        JSON.stringify(dados).toLowerCase().includes(termo)
      ) {
        output += `Tabela: ${tabela}\nDescrição: ${
          dados.descricao || "sem descrição"
        }\n`;

        for (const [col, def] of Object.entries(dados.colunas || {})) {
          output += `  - ${col} (${def.tipo}): ${
            def.descricao || "sem descrição"
          }\n`;
        }

        if (dados.relacoes) {
          output += `  Relacionamentos:\n`;
          for (const [campo, rel] of Object.entries(dados.relacoes)) {
            output += `    - ${campo} → ${rel.tabela}.${rel.coluna} (${
              rel.descricao || ""
            })\n`;
          }
        }
        output += "\n";
      }
    }

    return output || "Nenhuma informação relevante encontrada no schema.";
  }
}
