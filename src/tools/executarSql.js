import axios from "axios";

export async function executarSQL({ input }) {
  const resposta = await axios.post(process.env.LARAVEL_API_URL + "/executar-sql", {
    query: input,
  }, {
    headers: {
      Authorization: `Bearer ${process.env.LARAVEL_TOKEN}`
    }
  });
  return resposta.data;
}

