import AWS from "aws-sdk";
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIToolsAgent } from "langchain/agents";
import { SchemaInspector } from "../schema-inspector/index.js";

const secretsManager = new AWS.SecretsManager({ region: process.env.AWS_REGION });
let credsCache = null;
async function getCredentials() {
  if (!credsCache) {
    const { SecretString } = await secretsManager
      .getSecretValue({ SecretId: process.env.SECRET_NAME })
      .promise();
    credsCache = JSON.parse(SecretString);
  }
  return credsCache;
}

let executor = null;
export async function handler(event) {
  if (!executor) {
    // 1) carrega OPENAI_API_KEY do Secret Manager
    const { OPENAI_API_KEY } = await getCredentials();
    process.env.OPENAI_API_KEY = OPENAI_API_KEY;

    // 2) instancia o modelo
    const model = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
    });

    // 3) define ferramentas: só schemaInspector + stub de SQL
    const tools = [
      new SchemaInspector(),
      {
        name: "executarSql",
        description: "Dry-run: retorna apenas o SQL gerado",
        async _call(input) {
          return input; // aqui, input é o SQL montado pelo agente
        },
      },
    ];

    const agent = await createOpenAIToolsAgent({ llm: model, tools });
    executor = AgentExecutor.fromAgentAndTools({ agent, tools, verbose: true });
  }

  // 4) recebe a pergunta e invoca
  const { question } = JSON.parse(event.body);
  const result = await executor.invoke({ input: question });

  // 5) devolve o SQL em JSON
  return {
    statusCode: 200,
    body: JSON.stringify({ sql: result.output }),
  };
}
