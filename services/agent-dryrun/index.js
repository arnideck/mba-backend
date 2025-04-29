import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { ChatOpenAI } from "@langchain/openai";
import { LLMChain } from "langchain/chains";
import { PromptTemplate } from "@langchain/core/prompts";

// Inicializa Secrets Manager
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
let credsCache = null;

// Busca segredo
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
  // 1. Tenta extrair bloco ```sql``` se existir
  const sqlCodeBlock = texto.match(/```sql\s*([\s\S]*?)```/i);
  if (sqlCodeBlock && sqlCodeBlock[1]) {
    return sqlCodeBlock[1].trim();
  }

  // 2. Procura comandos SQL básicos
  const comandoSQL = texto.match(/(SELECT|UPDATE|INSERT INTO|DELETE FROM)[\s\S]*?;/i);
  if (comandoSQL && comandoSQL[0]) {
    return comandoSQL[0].trim();
  }

  // 3. Última tentativa: trecho contendo WHERE
  const possivelSQL = texto.match(/[\s\S]*WHERE[\s\S]*;/i);
  if (possivelSQL && possivelSQL[0]) {
    return possivelSQL[0].trim();
  }

  // 4. Fallback: retornar tudo
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

    // Inicializa LLMChain se ainda não inicializado
    if (!executor) {
      const { OPENAI_API_KEY } = await getCredentials();
      process.env.OPENAI_API_KEY = OPENAI_API_KEY;

      const model = new ChatOpenAI({
        temperature: 0,
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4o", // ajuste se necessário
      });

      const prompt = PromptTemplate.fromTemplate(`
            Você é um assistente de banco de dados.  
            Sua tarefa é receber uma pergunta e gerar APENAS o comando SQL correspondente, sem explicações.  
            Responda diretamente com o comando SQL.
            Pergunta: {input}
            SQL:
    `);

      executor = new LLMChain({ llm: model, prompt });
    }

    const result = await executor.call({ input: question });

    // Extraindo apenas o SQL
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
