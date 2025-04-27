import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { ChatOpenAI } from "@langchain/openai";
import { createOpenAIToolsAgent, RunnableAgentExecutor } from "langchain/agents"; // 👈 Aqui já importamos o novo executor
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
      model: "gpt-4o",
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
    });

    const tools = [
      new SchemaInspector(),
      {
        name: "executarSql",
        description: "Dry-run: retorna apenas o SQL gerado",
        async _call(input) {
          return input;
        },
      },
    ];

    const agent = await createOpenAIToolsAgent({ llm: model, tools });

    executor = RunnableAgentExecutor.fromAgentAndTools({
      agent,
      tools,
      verbose: true,
    });
  }

  const { question } = JSON.parse(event.body);
  const result = await executor.invoke({ input: question });

  return {
    statusCode: 200,
    body: JSON.stringify({ sql: result.output }),
  };
}
