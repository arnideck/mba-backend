import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { ChatOpenAI } from "@langchain/openai";
import { initializeAgentExecutorWithOptions } from "langchain/agents";
import { DynamicTool } from "langchain/tools";
import { getSchema } from "../schema-inspector/getDatabaseSchema.js";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { verificarToken } from "./auth.js";

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
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'OPTIONS,POST',
        },
        body: '',
      };
    }


    const body = event.body ? JSON.parse(event.body) : event;
    const question = body.question;

    if (!question) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
        body: JSON.stringify({ error: "Campo 'question' é obrigatório." }),
      };
    }

    const authHeader = event.headers?.Authorization || event.headers?.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
        body: JSON.stringify({ error: "Não autorizado" }),
      };
    }

    const token = authHeader.split(" ")[1];
    const payload = await verificarToken(token);
    console.log("Payload do token:", payload);
    const { JWT_SECRET } = await getCredentials();
    process.env.JWT_SECRET = JWT_SECRET;

   /* if (!payload) {
      return {
        statusCode: 403,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
        body: JSON.stringify({ token: token, error: process.env.JWT_SECRET }),
      };
    }*/

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

      const tools = [
        new DynamicTool({
          name: "executar_sql_lambda",
          description: "Executa comandos SQL SELECT contra o banco de dados",
          func: async (sql) => {
            const cleanSql = sql.replace(/```sql|```/gi, "").trim();
            const command = new InvokeCommand({
              FunctionName: "mba-backend-dev-executarSql",
              InvocationType: "RequestResponse",
              Payload: Buffer.from(JSON.stringify({ sql: cleanSql })),
            });
          
            const response = await lambdaClient.send(command);
            const result = JSON.parse(Buffer.from(response.Payload).toString("utf-8"));
          
            let raw = [];
          
            if (result.body && typeof result.body === "string") {
              try {
                raw = JSON.parse(result.body);
              } catch (e) {
                console.error("Erro ao fazer parse do body:", result.body);
                return "Final Answer: Erro ao processar o resultado da consulta SQL.";
              }
            }
          
            // ✅ Múltiplas linhas (tabela)
            if (Array.isArray(raw) && raw.length > 1) {
              const colunas = Object.keys(raw[0]);
              const cabecalho = colunas.join(" | ");
              const separador = colunas.map(() => "---").join(" | ");
              const linhas = raw.map((linha, i) => {
                const valores = colunas.map(col => {
                  const valor = linha[col];
                  return typeof valor === "number" ? formatarValor(valor) : valor;
                });
                return `${i + 1}. ${valores.join(" | ")}`;
              });
          
              return `Final Answer:\n${cabecalho}\n${separador}\n${linhas.join("\n")}`;
            }
          
            // ✅ Valor único com formatação
            if (Array.isArray(raw) && raw.length === 1) {
              return extrairValorNumericoJson(raw);
            }
          
            if (typeof result.body === "string" && result.body.includes("Final Answer")) {
              return result.body;
            }
          
            return "Final Answer: Nenhum dado encontrado.";
          }
          
        }),
      ];

        executor = await initializeAgentExecutorWithOptions(tools, model, {
        agentType: "zero-shot-react-description",
        verbose: true,
        maxIterations: 5,
        returnIntermediateSteps: true,
        agentArgs: {
          prefix: `
          Você é um agente SQL.  
            Você tem à disposição duas ferramentas:
            - schema_inspector: para ver tabelas e colunas (ex: "schema_inspector: colunas de producoes?")
            - executar_sql_lambda: para executar SELECTs válidos e retornar JSON.

            Regras de negócio:
            1) Nunca use tabelas/colunas fora do schema_inspector.
            2) Use sempre campo premioLq para prêmios.
            3) Ao filtrar automóvel, use produto LIKE '%auto%'.
            4) Sempre filtre status != 0, a menos que digam o contrário.
            5) Datas em 'YYYY-MM-DD'.
            6) Gere apenas um bloco markdown com SQL; sem explicações.

            Usuário: {input}

            Agente, qual sequência de chamadas de ferramenta você fará (não responda com SQL direto aqui)?
            Após pensar, invoque as ferramentas conforme necessário.
          
          ${schemaContext}
              `.trim(),
              suffix: "Pergunta do usuário: {input}"
            },
      });
      
    }

    const result = await executor.invoke({ input: question });

    // Se algum dos passos intermediários tiver um observation com "Final Answer", usamos ele
    let respostaFinal = result.output;

    // Percorre de trás pra frente até encontrar um passo com "Final Answer" válido
    for (const step of result.intermediateSteps.reverse()) {
      if (
        typeof step.observation === 'string' &&
        step.observation.includes("Final Answer") &&
        !step.observation.includes("NaN")
      ) {
        respostaFinal = step.observation;
        break;
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      },
      body: JSON.stringify({
        resposta: respostaFinal,
        raciocinio: result.intermediateSteps
      }),
    };
  } catch (err) {
    console.error("Erro no handler:", err);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      },
      body: JSON.stringify({ error: "Erro inesperado", details: err.message }),
    };
  }
};