// services/agent/index.js

import AWS from "aws-sdk";
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIToolsAgent } from "langchain/agents";

const lambda = new AWS.Lambda({ region: process.env.AWS_REGION });
const secretsManager = new AWS.SecretsManager({ region: process.env.AWS_REGION });

let credsCache = null;
async function getCredentials() {
  if (!credsCache) {
    const { SecretString, SecretBinary } = await secretsManager
      .getSecretValue({ SecretId: "credenciaisMba" })
      .promise();
    const raw = SecretString ?? Buffer.from(SecretBinary, "base64").toString();
    credsCache = JSON.parse(raw);
  }
  return credsCache;
}

async function invokeLambda(suffix, payload) {
  const base = process.env.AWS_LAMBDA_FUNCTION_NAME.replace(/-agent$/, "");
  const fn = `${base}-${process.env.STAGE}-${suffix}`;
  const { Payload } = await lambda
    .invoke({ FunctionName: fn, Payload: JSON.stringify(payload) })
    .promise();
  return JSON.parse(Payload);
}

let executor = null;
export async function handler(event) {
  if (!executor) {
    // 1) carrega e injeta credenciais
    const { OPENAI_API_KEY, LARAVEL_API_URL, LARAVEL_TOKEN } =
      await getCredentials();
    process.env.OPENAI_API_KEY = OPENAI_API_KEY;
    process.env.LARAVEL_API_URL  = LARAVEL_API_URL;
    process.env.LARAVEL_TOKEN    = LARAVEL_TOKEN;

    // 2) instancia LLM
    const model = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
    });

    // 3) define as tools que chamam outras Lambdas
    const tools = [
      {
        name: "schemaInspector",
        description:
          "Consulta o dicionário de dados via Lambda schema-inspector",
        async _call(input) {
          const { result } = await invokeLambda("schemaInspector", { input });
          return result;
        },
      },
      {
        name: "executarSql",
        description: "Executa SQL via Lambda executar-sql",
        async _call(input) {
          const { result } = await invokeLambda("executarSql", { input });
          return result;
        },
      },
    ];

    const agent = await createOpenAIToolsAgent({ llm: model, tools });
    executor = AgentExecutor.fromAgentAndTools({
      agent,
      tools,
      verbose: true,
    });
  }

  // 4) recebe e interpreta a pergunta
  const { question } = JSON.parse(event.body);
  const result = await executor.invoke({ input: question });

  // 5) retorna a resposta
  return {
    statusCode: 200,
    body: JSON.stringify({ resposta: result.output }),
  };
}
