// services/schema-inspector/index.js

import { Tool } from "@langchain/core/tools";
import { getSchema } from "./getDatabaseSchema.js";

export class SchemaInspector extends Tool {
  constructor() {
    super();
    this.name = "schemaInspector";
    this.description = "Fornece uma descrição das tabelas e colunas do banco de dados para auxiliar na criação de consultas SQL.";
  }

  async _call(query) {
    const schema = getSchema();

    let resposta = "**Dicionário de Dados Disponível:**\n\n";

    for (const [tabela, dados] of Object.entries(schema)) {
      resposta += `Tabela: ${tabela}\n`;
      if (dados.colunas) {
        resposta += `Campos:\n`;
        for (const [coluna, detalhes] of Object.entries(dados.colunas)) {
          resposta += `- ${coluna}: ${detalhes.descricao || "Sem descrição"}\n`;
        }
      }
      resposta += `\n`;
    }

    console.log("✅ Resposta formatada enviada ao agente:\n", resposta);

    return resposta;
  }
}