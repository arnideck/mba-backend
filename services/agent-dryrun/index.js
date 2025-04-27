import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { ChatOpenAI } from "langchain/chat_models";
import { AgentExecutor, initializeAgentExecutorWithOptions } from "langchain/agents";
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
  if (!executor) {
    const { OPENAI_API_KEY } = await getCredentials();
    process.env.OPENAI_API_KEY = OPENAI_API_KEY;

    const model = new ChatOpenAI({
      temperature: 0,
      openAIApiKey: process.env.OPENAI_API_KEY
    });

    const tools = [
      new SchemaInspector(),
      {
        name: "executarSql",
        description: "Apenas retorna o SQL gerado pelo agente",
        func: async (input) => {
          return input;  // Só devolve o SQL, não executa
        },
      },
    ];

    executor = await initializeAgentExecutorWithOptions(
      tools,
      model,
      {
        agentType: "zero-shot-react-description",
        verbose: true,
      }
    );
  }

  const { question } = JSON.parse(event.body);
  const result = await executor.call({ input: question });

  return {
    statusCode: 200,
    body: JSON.stringify({ sql: result.output }),
  };
}

