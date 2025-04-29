import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { OpenAI } from "@langchain/openai";
import { ChatOpenAI } from "@langchain/openai";
import { initializeAgentExecutorWithOptions } from "langchain/agents";
import { SchemaInspector } from "../schema-inspector/index.js";

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
let credsCache = null;

async function getCredentials() {
  if (!credsCache) {
    const command = new GetSecretValueCommand({ SecretId: process.env.SECRET_NAME });
    const { SecretString } = await secretsClient.send(command);
    credsCache = JSON.parse(SecretString);
  }
  return credsCache;
}

let executor = null;

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
        body: JSON.stringify({ error: "Campo 'question' é obrigatório no body." }),
      };
    }

    if (!executor) {
      const { OPENAI_API_KEY } = await getCredentials();
      process.env.OPENAI_API_KEY = OPENAI_API_KEY;

      const model = new ChatOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        model: "gpt-4o",
        temperature: 0,
        
      });
      

      const tools = [
        new SchemaInspector(),
        {
          name: "executarSql",
          description: "Apenas retorna o SQL gerado",
          func: async (input) => {
            return input;
          },
        },
      ];

    
      executor = await initializeAgentExecutorWithOptions(
        tools,
        model,
        {
          agentType: "zero-shot-react-description",
          verbose: true,
          agentArgs: {
            prefix: "Você é um assistente de SQL. Você deve gerar consultas SQL com base na pergunta do usuário.Você deve gerar diretamente apenas o comando SQL, e nada mais. Sem explicações.",
            suffix: "Apenas retorne o SQL gerado.",
            inputVariables: ["input"],
          },
        }
      );
    }

    if (!executor) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Erro interno ao inicializar agente.", }),
      };
    }

    const result = await executor.call({ input: question });

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

function extrairSQL(texto) {
  // 1. Tenta extrair trechos entre ```sql ... ```
  const sqlCodeBlock = texto.match(/```sql\s*([\s\S]*?)```/i);
  if (sqlCodeBlock && sqlCodeBlock[1]) {
    return sqlCodeBlock[1].trim();
  }

  // 2. Tenta extrair comandos SQL comuns direto do texto
  const comandoSQL = texto.match(/(SELECT|UPDATE|INSERT INTO|DELETE FROM)[\s\S]*?;/i);
  if (comandoSQL && comandoSQL[0]) {
    return comandoSQL[0].trim();
  }

  // 3. Última tentativa: procurar padrões com WHERE/AND/OR
  const possivelSQL = texto.match(/[\s\S]*WHERE[\s\S]*;/i);
  if (possivelSQL && possivelSQL[0]) {
    return possivelSQL[0].trim();
  }

  // 4. Se nada for detectado, devolve tudo como fallback
  return texto.trim();
}
