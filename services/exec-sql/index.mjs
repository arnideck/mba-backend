// services/executar-sql/index.js

import AWS from "aws-sdk";
import axios from "axios";

const secretsManager = new AWS.SecretsManager({ region: process.env.AWS_REGION });
let credsCache = null;
async function getCredentials() {
  if (!credsCache) {
    const { SecretString, SecretBinary } = await secretsManager
      .getSecretValue({ SecretId: "credenciaisMba" })
      .promise();
    const raw = SecretString ?? Buffer.from(SecretBinary, "base64").toString();
    credsCache = JSON.parse(raw);
  }
  return credsCache;
}

export async function handler(event) {
  // 1) recupera URL e token
  const { LARAVEL_API_URL, LARAVEL_TOKEN } = await getCredentials();

  // 2) extrai query do payload
  const { input } = JSON.parse(event.body || JSON.stringify(event));

  // 3) chama a API Laravel
  const resposta = await axios.post(
    `${LARAVEL_API_URL}/executar-sql`,
    { query: input },
    { headers: { Authorization: `Bearer ${LARAVEL_TOKEN}` } }
  );

  // 4) devolve resultado
  return {
    statusCode: 200,
    body: JSON.stringify({ result: resposta.data }),
  };
}
