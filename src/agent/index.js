import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIToolsAgent } from "@langchain/core/agents";
import { executarSQL } from "../tools/executarSql.js";
import { SchemaInspector } from "../tools/schemaInspector.js";

let executor = null;

export const handler = async (event) => {
  if (!executor) {
    const model = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
    });

    const tools = [executarSQL, new SchemaInspector()];

    const agent = await createOpenAIToolsAgent({
      llm: model,
      tools,
    });

    executor = AgentExecutor.fromAgentAndTools({
      agent,
      tools,
      verbose: true,
    });
  }

  const body = JSON.parse(event.body);
  const question = body.question;

  const result = await executor.invoke({ input: question });

  return {
    statusCode: 200,
    body: JSON.stringify({ resposta: result.output }),
  };
};

