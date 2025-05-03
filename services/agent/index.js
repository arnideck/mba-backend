import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { ChatOpenAI } from "@langchain/openai";
import { initializeAgentExecutorWithOptions } from "langchain/agents";
import { DynamicTool } from "langchain/tools";
import { getSchema } from "../schema-inspector/getDatabaseSchema.js";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

async function getCredentials() {
  const command = new GetSecretValueCommand({ SecretId: process.env.SECRET_NAME });
  const { SecretString } = await secretsClient.send(command);
  return JSON.parse(SecretString);
}

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

const toolExecutarSql = new DynamicTool({
  name: "executar_sql_lambda",
  description: "Executa SQL via Lambda 'executar-sql' e retorna resultado como JSON.",
  func: async (input) => {
    const payload = { sql: input };
    const command = new InvokeCommand({
      FunctionName: "mba-backend-dev-executarSql",
      Payload: Buffer.from(JSON.stringify(payload)),
    });
    const response = await lambdaClient.send(command);
    const payloadString = Buffer.from(response.Payload).toString();
    const lambdaResponse = JSON.parse(payloadString);
    return lambdaResponse.body || "Sem resposta da Lambda.";
  }
});

const toolInterpretarJson = new DynamicTool({
  name: "interpretar_json",
  description: "Recebe JSON da API e resume os dados em uma resposta compreensível.",
  func: async (input) => {
    const dados = JSON.parse(input);
    if (!dados || typeof dados !== "object") return "JSON inválido.";
    return `Resumo dos dados: ${JSON.stringify(dados)}`;
  }
});

export async function handler(event) {
  try {
    const body = event.body ? JSON.parse(event.body) : event;
    const question = body.question;

    if (!question) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Campo 'question' é obrigatório no body." })
      };
    }

    const { OPENAI_API_KEY } = await getCredentials();
    process.env.OPENAI_API_KEY = OPENAI_API_KEY;

    const model = new ChatOpenAI({
      temperature: 0,
      modelName: "gpt-4o",
      openAIApiKey: OPENAI_API_KEY,
    });

    const schemaContexto = gerarSchemaContexto();

    const executor = await initializeAgentExecutorWithOptions(
      [toolExecutarSql, toolInterpretarJson],
      model,
      {
        agentType: "zero-shot-react-description",
        verbose: true,
        agentArgs: {
          prefix: `Você é um agente especialista em SQL e análise de dados. Com base no contexto do schema abaixo, seu trabalho é:

        1. Gerar SQL válido usando apenas as tabelas e colunas fornecidas.
        2. Chamar a ferramenta 'executar_sql_lambda' com a consulta.
        3. Interpretar o resultado da ferramenta usando 'interpretar_json'.
        4. Finalizar com a resposta ao usuário.

        Regras:
        - Sempre use 'premioLq' para prêmios financeiros.
        - Quando filtrar produto automóvel, use produto LIKE '%auto%'.
        - Datas devem estar no formato 'YYYY-MM-DD'.

        Contexto:

        ${schemaContexto}

        Siga os passos com clareza e precisão.`,
                  suffix: "Pergunta do usuário: {input}",
                },
              }
            );

    const result = await executor.invoke({ input: question });

    return {
      statusCode: 200,
      body: JSON.stringify({
        resposta: result.output,
        historico: result.intermediateSteps,
      }),
    };
  } catch (error) {
    console.error("Erro no agente:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Erro interno", details: error.message }),
    };
  }
}