import axios from 'axios';
import { Tool } from 'langchain/tools';

export const executarSQL = new Tool({
  name: 'executarSQL',
  description: 'Usado para enviar comandos SQL ao sistema Laravel e retornar dados',
  func: async (sql) => {
    const response = await axios.post(process.env.LARAVEL_API_URL, { sql }, {
      headers: { Authorization: `Bearer ${process.env.LARAVEL_API_TOKEN}` }
    });
    return JSON.stringify(response.data);
  }
});
