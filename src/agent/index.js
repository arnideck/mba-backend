import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor } from "@langchain/core/agents/executor";
import { OpenAIToolsAgent } from "@langchain/core/agents/openai";
import { executarSQL } from "../tools/executarSql.js";
import { SchemaInspector } from "../tools/schemaInspector.js";


let executor = null;

export async function handler(event) {
  if (!executor) {
    const model = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
    });

    const tools = [executarSQL, new SchemaInspector()];

    const agent = new OpenAIToolsAgent({ llm: model, tools });

    executor = new AgentExecutor({ agent, tools, verbose: true });
  }

  const body = JSON.parse(event.body);
  const question = body.question;

  const result = await executor.invoke({ input: question });

  return {
    statusCode: 200,
    body: JSON.stringify({ resposta: result.output }),
  };
}


