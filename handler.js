import 'dotenv/config';
import { executarSQL } from './tools/executarSql.js';
import { SchemaInspector } from './tools/schemaInspector.js';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { initializeAgentExecutorWithOptions } from 'langchain/agents';

const model = new ChatOpenAI({
  temperature: 0,
  modelName: 'gpt-4',
  openAIApiKey: process.env.OPENAI_API_KEY
});

const tools = [
  executarSQL,
  new SchemaInspector() // NOVO!
];

const executor = await initializeAgentExecutorWithOptions(tools, model, {
  agentType: 'openai-functions',
  verbose: true
});

export const handler = async (event) => {
  const body = JSON.parse(event.body);
  const question = body.question;

  const result = await executor.call({ input: question });

  return {
    statusCode: 200,
    body: JSON.stringify({
      resposta: result.output
    })
  };
};
