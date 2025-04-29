import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { ChatOpenAI } from "@langchain/openai";
import { LLMChain } from "langchain/chains";
import { PromptTemplate } from "@langchain/core/prompts";
import { getSchema } from "../schema-inspector/getDatabaseSchema.js";

// 🔥 NOVO: Gera o contexto dinâmico a partir do dicionário
function gerarSchemaContexto() {
  const schema = getSchema();
  let contexto = "Tabelas e colunas disponíveis:\n\n";

  for (const [tabela, dados] of Object.entries(schema)) {
    contexto += `Tabela '${tabela}':\n`;
    if (dados.colunas) {
      for (const [coluna, detalhes] of Object.entries(dados.colunas)) {
        contexto += `- ${coluna}: ${detalhes.descricao || "Sem descrição"}\n`;
      }
    }
    contexto += "\n";
  }

  return contexto.trim();
}

// Cliente SecretsManager
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
let credsCache = null;

// Busca segredo (OPENAI_API_KEY)
async function getCredentials() {
  if (!credsCache) {
    const command = new GetSecretValueCommand({ SecretId: process.env.SECRET_NAME });
    const { SecretString } = await secretsClient.send(command);
    credsCache = JSON.parse(SecretString);
  }
  return credsCache;
}

// Função para extrair apenas o SQL limpo
function extrairSQL(texto) {
  const sqlCodeBlock = texto.match(/```sql\s*([\s\S]*?)```/i);
  if (sqlCodeBlock && sqlCodeBlock[1]) {
    return sqlCodeBlock[1].trim();
  }

  const comandoSQL = texto.match(/(SELECT|UPDATE|INSERT INTO|DELETE FROM)[\s\S]*?;/i);
  if (comandoSQL && comandoSQL[0]) {
    return comandoSQL[0].trim();
  }

  const possivelSQL = texto.match(/[\s\S]*WHERE[\s\S]*;/i);
  if (possivelSQL && possivelSQL[0]) {
    return possivelSQL[0].trim();
  }

  return texto.trim();
}

// Variável global para o executor
let executor = null;

// Lambda Handler
export async function handler(event) {
  try {
    console.log("Evento recebido:", JSON.stringify(event));

    let question = undefined;

    if (event.body) {
      const body = JSON.parse(event.body);
      question = body.question;
    } else if (event.question) {
      question = event.question;
    }

    if (!question) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Campo 'question' é obrigatório." }),
      };
    }

    console.log("Pergunta recebida:", question);

    // Inicializar chain se ainda não existir
    if (!executor) {
      const { OPENAI_API_KEY } = await getCredentials();
      process.env.OPENAI_API_KEY = OPENAI_API_KEY;

      const model = new ChatOpenAI({
        temperature: 0,
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4o",
      });

      const schemaContext = gerarSchemaContexto();

      const prompt = PromptTemplate.fromTemplate(`
        Você é um assistente de banco de dados SQL.

        Utilize APENAS as tabelas e colunas fornecidas abaixo para gerar as consultas:

        ${schemaContext}

        Regras:
        - Sempre use 'premioLq' para prêmios financeiros.
        - Quando filtrar produto automóvel, use produto LIKE '%auto%'.
        - Datas devem estar no formato 'YYYY-MM-DD'.
        - Responda apenas com o comando SQL correto, sem explicações.

        Pergunta: {input}

        SQL:
        `);

      executor = new LLMChain({ llm: model, prompt });
    }

    const result = await executor.call({ input: question });

    const sqlExtraido = extrairSQL(result.text);

    return {
      statusCode: 200,
      body: JSON.stringify({ sql: sqlExtraido }),
    };

  } catch (error) {
    console.error("Erro no handler:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Erro inesperado", details: error.message }),
    };
  }
}
