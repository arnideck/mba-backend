import jwt from "jsonwebtoken";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

let jwtSecretCache = null;

// Carrega a chave secreta do Secrets Manager
async function getJwtSecret() {
  if (jwtSecretCache) return jwtSecretCache;

  const client = new SecretsManagerClient({ region: "us-east-1" });
  const command = new GetSecretValueCommand({
    SecretId: "JWT_SECRET_MBA", // Nome do segredo
  });

  const response = await client.send(command);
  const secret = JSON.parse(response.SecretString);
  jwtSecretCache = secret.JWT_SECRET;

  return jwtSecretCache;
}

export async function gerarToken(payload) {
  const secret = await getJwtSecret();
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

export async function verificarToken(token) {
  try {
    const secret = await getJwtSecret();
    return jwt.verify(token, secret);
  } catch (e) {
    console.error("Erro ao verificar token:", e.message);
    return null;
  }
}

