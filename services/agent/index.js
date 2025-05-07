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

function extrairColunasDoSQL(sql) {
  const selectMatch = sql.match(/select\s+(.+?)\s+from\s/i);
  if (!selectMatch || selectMatch.length < 2) return [];

  const rawCampos = selectMatch[1].split(",").map(campo => campo.trim());

  return rawCampos
    .map(campo => {
      if (campo === "*") return null;

      let semAlias = campo.toLowerCase().split(" as ")[0].trim();
      const funcaoMatch = semAlias.match(/\((.*?)\)/);
      if (funcaoMatch) semAlias = funcaoMatch[1];
      const partes = semAlias.split(".");
      return partes[partes.length - 1];
    })
    .filter(col => col && col !== "*");
}


function validarTabelas(sql) {
  const schema = getSchema();
  const tabelasValidas = Object.keys(schema);

  const matchesFrom = sql.match(/from\s+([\w]+)/gi) || [];
  const matchesJoin = sql.match(/join\s+([\w]+)/gi) || [];

  const tabelasUsadas = [...matchesFrom, ...matchesJoin].map(m =>
    m.replace(/(from|join)\s+/i, '').trim()
  );

  const tabelasInvalidas = tabelasUsadas.filter(t => !tabelasValidas.includes(t));
  return tabelasInvalidas;
}

function validarColunas(sql) {
  const schema = getSchema();
  const colunasValidas = Object.values(schema).flatMap(tabela =>
    Object.keys(tabela.colunas || {}).map(c => c.toLowerCase())
  );

  const colunasUsadas = extrairColunasDoSQL(sql.toLowerCase());
  const colunasInvalidas = colunasUsadas.filter(col => !colunasValidas.includes(col));

  return colunasInvalidas;
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

            // Valida tabelas
            const tabelasInvalidas = validarTabelas(cleanSql);
            if (tabelasInvalidas.length > 0) {
              return `Final Answer: As tabelas inválidas encontradas foram: ${tabelasInvalidas.join(", ")}. Use apenas tabelas definidas no schema_inspector.`;
            }

            // Valida colunas
            const colunasInvalidas = validarColunas(cleanSql);
            if (colunasInvalidas.length > 0) {
              return `Final Answer: As colunas inválidas encontradas foram: ${colunasInvalidas.join(", ")}. Use apenas colunas definidas no schema_inspector.`;
            }

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
          You are a SQL agent.
          Always respond strictly in English using the following format:
          Thought: ...
          Action: ...
          Action Input: ...
          Observation: ...
          Final Answer: ...

          You have access to the following tools:
          - schema_inspector: to inspect table and column metadata.
          - executar_sql_lambda: to execute valid SQL SELECT queries and return JSON.

          Strict rules:
          1) It is strictly forbidden to use any table or column not listed in the schema_inspector.
          2) If you reference a column or table that does not exist, you will be penalized.
          3) Always use premioLq for premium values.
          4) To filter automobiles, use produto LIKE '%auto%'.
          5) Always filter status != 0 unless the question says otherwise.
          6) Dates must be in 'YYYY-MM-DD'.
          7) Return SQL inside one markdown block. No explanations.

          User: {input}

          Agent, what is your plan?          
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