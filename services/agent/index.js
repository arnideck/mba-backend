import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { ChatOpenAI } from "@langchain/openai";
import { initializeAgentExecutorWithOptions } from "langchain/agents";
import { DynamicTool } from "langchain/tools";
import { PromptTemplate } from "@langchain/core/prompts";
import { getSchema } from "../schema-inspector/getDatabaseSchema.js";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

// Secrets Manager
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

let executor = null;
let credsCache = null;

async function getCredentials() {
  if (!credsCache) {
    const command = new GetSecretValueCommand({ SecretId: process.env.SECRET_NAME });
    const { SecretString } = await secretsClient.send(command);
    credsCache = JSON.parse(SecretString);
  }
  return credsCache;
}

function gerarSchemaContexto() {
  const schema = getSchema();
  let contexto = "Tabelas e colunas disponíveis:\n\n";
  for (const [tabela, dados] of Object.entries(schema)) {
    contexto += `Tabela '${tabela}':\n`;
    for (const [coluna, detalhes] of Object.entries(dados.colunas || {})) {
      contexto += `- ${coluna}: ${detalhes.descricao || "Sem descrição"}\n`;
    }
    contexto += "\n";
  }
  return contexto.trim();
}

function formatarValor(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function extrairValorNumericoJson(json) {
  try {
    const resultado = typeof json === "string" ? JSON.parse(json) : json;
    if (Array.isArray(resultado) && resultado.length > 0) {
      const chave = Object.keys(resultado[0])[0];
      const valor = resultado[0][chave];
      return `Final Answer: O ${chave.replace(/_/g, ' ')} é ${formatarValor(valor)}.`;
    }
  } catch (e) {
    return "Final Answer: Resultado recebido, mas não foi possível interpretar.";
  }
  return "Final Answer:".resultado;
  //return "Final Answer: Resultado desconhecido.";
}

export async function handler(event) {
  try {
    const body = event.body ? JSON.parse(event.body) : event;
    const question = body.question;

    if (!question) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Campo 'question' é obrigatório." }),
      };
    }

    if (!executor) {
      const { OPENAI_API_KEY } = await getCredentials();
      process.env.OPENAI_API_KEY = OPENAI_API_KEY;

      const model = new ChatOpenAI({
        temperature: 0,
        modelName: "gpt-3.5-turbo-1106",
        openAIApiKey: process.env.OPENAI_API_KEY,
        maxTokens: 1000,
      });

      const schemaContext = gerarSchemaContexto();

      const tool = new DynamicTool({
        name: "executar_sql_lambda",
        description: "Executa comandos SQL SELECT contra o banco de dados",
        func: async (input) => {
          const sql = input.replace(/```sql|```/gi, "").trim();
          const response = await lambdaClient.send(new InvokeCommand({
            FunctionName: "mba-backend-dev-executarSql",
            Payload: Buffer.from(JSON.stringify({ sql })),
          }));
          const payload = JSON.parse(Buffer.from(response.Payload).toString("utf-8"));
          return extrairValorNumericoJson(payload);
        }
      });

        executor = await initializeAgentExecutorWithOptions(tools, model, {
        agentType: "zero-shot-react-description",
        verbose: true,
        maxIterations: 3,
        returnIntermediateSteps: true,
        agentArgs: {
          prefix: `
          Você é um assistente SQL rigoroso.
          
          REGRAS OBRIGATÓRIAS (não ignore):
          - Use SOMENTE as tabelas e colunas abaixo.
          - Sempre use 'premioLq' para valores de prêmio.
          - Produto automóvel deve ser filtrado com: produto LIKE '%auto%'.
          - Sempre inclua no WHERE: status != 0 (exceto se o usuário pedir cancelados/recusados).
          - Use datas no formato: 'YYYY-MM-DD'.
          - Responda somente com o SQL em bloco \`\`\`sql ... \`\`\`, sem explicações.
          
          ${SchemaContexto}
              `.trim(),
              suffix: "Pergunta do usuário: {input}"
            },
      });
      
    }

    const result = await executor.invoke({ input: question });

    return {
      statusCode: 200,
      body: JSON.stringify({
        resposta: result.output,
        raciocinio: result.intermediateSteps
      }),
    };
  } catch (err) {
    console.error("Erro no handler:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Erro inesperado", details: err.message }),
    };
  }
};