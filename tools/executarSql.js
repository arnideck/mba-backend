// tools/executarSQL.js
const axios = require("axios");

async function executarSQL(query) {
  const resposta = await axios.post(process.env.LARAVEL_API_URL + "/executar-sql", {
    query,
  }, {
    headers: {
      Authorization: `Bearer ${process.env.LARAVEL_TOKEN}`
    }
  });
  return resposta.data;
}

module.exports = { executarSQL };
