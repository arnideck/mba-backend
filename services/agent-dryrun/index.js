import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIToolsAgent } from "langchain/agents";
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
    // 1) Carrega OPENAI_API_KEY do Secret Manager
    const { OPENAI_API_KEY } = await getCredentials();
    process.env.OPENAI_API_KEY = OPENAI_API_KEY;

    // 2) Instancia o modelo
    const model = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
    });

    // 3) Define ferramentas: schemaInspector + dry-run do SQL
    const tools = [
      new SchemaInspector(),
      {
        name: "executarSql",
        description: "Dry-run: retorna apenas o SQL gerado",
        async _call(input) {
          return input; // Aqui, input é o SQL montado pelo agente
        },
      },
    ];

    const agent = await createOpenAIToolsAgent({ llm: model, tools });
    executor = AgentExecutor.fromAgentAndTools({ agent, tools, verbose: true });
  }

  // 4) Recebe a pergunta e invoca
  const { question } = JSON.parse(event.body);
  const result = await executor.invoke({ input: question });

  // 5) Retorna o SQL montado como JSON
  return {
    statusCode: 200,
    body: JSON.stringify({ sql: result.output }),
  };
}

