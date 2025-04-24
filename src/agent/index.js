import 'dotenv/config';
import { executarSQL } from '../tools/executarSql.js';
import { SchemaInspector } from '../tools/schemaInspector.js';
import { ChatOpenAI } from "@langchain/openai";
import { initializeAgentExecutorWithOptions } from 'langchain/agents';

let executor = null;

export const handler = async (event) => {
  if (!executor) {
    const model = new ChatOpenAI({ temperature: 0, modelName: 'gpt-4o-mini', openAIApiKey: process.env.OPENAI_API_KEY });
    
    executor = await initializeAgentExecutorWithOptions([executarSQL, new SchemaInspector()], model, {
      agentType: 'openai-functions',
      verbose: true
    });
  }

  const body = JSON.parse(event.body);
  const question = body.question;

  const result = await executor.call({ input: question });

  return {
    statusCode: 200,
    body: JSON.stringify({ resposta: result.output })
  };
};

