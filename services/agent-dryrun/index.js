import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { ChatOpenAI } from "@langchain/openai";
import { initializeAgentExecutorWithOptions } from "langchain/agents";
import { getSchema } from "../schema-inspector/getDatabaseSchema.js";
import { SchemaInspector } from "../schema-inspector/index.js";

// Inicializa acesso ao Secrets Manager
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
let credsCache = null;

// Função para buscar segredo
async function getCredentials() {
  if (!credsCache) {
    const command = new GetSecretValueCommand({ SecretId: process.env.SECRET_NAME });
    const { SecretString } = await secretsClient.send(command);
    credsCache = JSON.parse(SecretString);
  }
  return credsCache;
}

// Função para extrair SQL puro da resposta
function extrairSQL(texto) {
  // 1. Tenta extrair entre blocos ```sql
  const sqlCodeBlock = texto.match(/```sql\s*([\s\S]*?)```/i);
  if (sqlCodeBlock && sqlCodeBlock[1]) {
    return sqlCodeBlock[1].trim();
  }

  // 2. Tenta extrair comandos SQL diretos
  const comandoSQL = texto.match(/(SELECT|UPDATE|INSERT INTO|DELETE FROM)[\s\S]*?;/i);
  if (comandoSQL && comandoSQL[0]) {
    return comandoSQL[0].trim();
  }

  // 3. Última tentativa: trecho com WHERE
  const possivelSQL = texto.match(/[\s\S]*WHERE[\s\S]*;/i);
  if (possivelSQL && possivelSQL[0]) {
    return possivelSQL[0].trim();
  }

  // 4. Se nada, retorna texto mesmo
  return texto.trim();
}

// Executor guardado em memória
let executor = null;

// Lambda Handler
export async function handler(event) {
  try {
    console.log("Evento recebido:", JSON.stringify(event));

    let question = undefined;

    // Tratamento para receber a pergunta
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

    // Inicializa agente se ainda não estiver inicializado
    if (!executor) {
      const { OPENAI_API_KEY } = await getCredentials();
      process.env.OPENAI_API_KEY = OPENAI_API_KEY;

      const model = new ChatOpenAI({
        temperature: 0,
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4o", // ajuste se quiser
      });

      const tools = [
        new SchemaInspector(), // sua ferramenta que fornece o dicionário
      ];

      executor = await initializeAgentExecutorWithOptions(
        tools,
        model,
        {
          agentType: "zero-shot-react-description",
          verbose: true,
          agentArgs: {
            prefix: "Você é um assistente de SQL. Gere APENAS o comando SQL, e nada mais, com base na pergunta do usuário.",
            suffix: "Pergunta: {input}\nSQL:",
            inputVariables: ["input"]
          }
        }
      );
    }

    const result = await executor.invoke({ input: question });

    // Extraindo apenas o SQL limpo
    const sqlExtraido = extrairSQL(result.output);

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
