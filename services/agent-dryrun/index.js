import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { ChatOpenAI } from "@langchain/openai"; // ✅ Novo: correto agora
import { AgentExecutor, initializeAgentExecutor } from "langchain/agents";
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
  console.log("Evento recebido:", JSON.stringify(event)); // 👈 LOG pra ver exatamente o que chega

  let question = undefined;

  // Se for API Gateway HTTP v2
  if (event.body) {
    const body = JSON.parse(event.body);
    question = body.question;
  } else if (event.question) {
    // Se for invocação direta tipo Lambda test
    question = event.question;
  }

  if (!question) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Campo 'question' é obrigatório no body." }),
    };
  }

  // Aí segue a chamada normal
  const result = await executor.call({ input: question });

  return {
    statusCode: 200,
    body: JSON.stringify({ sql: result.output }),
  };
}

